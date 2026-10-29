import { describe, expect, it, vi } from 'vitest';
import { VoicevoxClient } from '../src/tts/voicevox.js';
import { termsUrl, policyExcerpt } from '../src/tts/policy.js';

describe('speakerInfo / policy', () => {
  it('URL形式で取得し、policy だけを保持して同時取得もキャッシュする', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json({ policy: '規約', portrait: 'large' }));
    const client = new VoicevoxClient({ baseUrl: 'http://unused', fetch });
    const [a, b] = await Promise.all([client.speakerInfo('a/b'), client.speakerInfo('a/b')]);
    a.policy = '変更';
    expect(b).toEqual({ policy: '規約' });
    expect(await client.speakerInfo('a/b')).toEqual({ policy: '規約' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe(
      'http://unused/speaker_info?speaker_uuid=a%2Fb&resource_format=url',
    );
  });
  it.each([null, {}, { policy: 1 }, []])('不正な応答 %j をキャッシュしない', async (body) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(Response.json({ policy: '規約' }));
    const client = new VoicevoxClient({ baseUrl: 'http://unused', fetch });
    await expect(client.speakerInfo('uuid')).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(await client.speakerInfo('uuid')).toEqual({ policy: '規約' });
  });
  it('最初の規約URLをmarkdown・括弧・HTMLから抽出する', () => {
    for (const policy of [
      '[規約](https://example.com/terms) https://second.com',
      '<https://example.com/terms>',
      '<a href="https://example.com/terms">規約</a>',
    ])
      expect(termsUrl(policy)).toBe('https://example.com/terms');
    expect(termsUrl('規約のみ')).toBeUndefined();
    expect(termsUrl('javascript:alert(1)')).toBeUndefined();
  });
  it('抜粋は最初の8行・600文字以内に収め、メンションとmarkdownを抑える', () => {
    const excerpt = policyExcerpt(
      '@everyone **規約**\n' + Array(15).fill('あ'.repeat(100)).join('\n'),
    );
    expect(excerpt.length).toBeLessThanOrEqual(600);
    expect(excerpt.split('\n').length).toBeLessThanOrEqual(8);
    expect(excerpt).not.toContain('@everyone');
    expect(excerpt).toContain('\\*');
  });
});
