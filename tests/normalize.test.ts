import { describe, expect, it, vi } from 'vitest';
import { normalizeText } from '../src/tts/normalize.js';

describe('normalizeText', () => {
  it.each([
    ['https://example.com/a?b=1 http://x.test', 'URL省略 URL省略'],
    ['```ts\nsecret()\n``` hello', 'コードブロック省略 hello'],
    ['```unfinished', 'コードブロック省略'],
    ['`hello` ||secret\ntext||', 'hello 伏せ字'],
    ['<:smile:123> <a:dance:456>', 'smile dance'],
    ['😀 日本語 🎉', '😀 日本語 🎉'],
    ['ｗｗｗｗ wwwwwwwwwww', 'わらわら わらわら'],
    ['  a\n\t b  ', 'a b'],
    [' \n ', ''],
    ['<@123> <@&456> <#789>', 'ユーザー ロール チャンネル'],
  ])('%s を正規化する', (input, output) => expect(normalizeText(input)).toBe(output));
  it('メンションを表示名で解決する', () => {
    const resolve = vi.fn((kind: string, id: string) => `${kind}${id}`);
    expect(normalizeText('<@1> <@!2> <@&3> <#4>', { resolve })).toBe('user1 user2 role3 channel4');
  });
  it('添付だけなら代替テキストを使う', () => {
    expect(normalizeText('', { hasAttachments: true })).toBe('添付ファイル');
    expect(normalizeText('本文', { hasAttachments: true })).toBe('本文');
  });
  it('Unicode を壊さず切り詰め、上限ちょうどなら接尾辞を付けない', () => {
    expect(normalizeText('😀あいう', { maxLength: 2 })).toBe('😀あ以下略');
    expect(normalizeText('あ'.repeat(101))).toBe('あ'.repeat(100) + '以下略');
    expect(normalizeText('あ'.repeat(100))).toBe('あ'.repeat(100));
  });
});
