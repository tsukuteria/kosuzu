import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flattenStyles,
  VoicevoxClient,
  VoicevoxError,
  type AudioQuery,
  type Speaker,
  type VoicevoxClientOptions,
} from '../src/tts/voicevox.js';

const query: AudioQuery = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  accent_phrases: [],
  outputSamplingRate: 24000,
  outputStereo: false,
  kana: 'テスト',
};
const speakers: Speaker[] = [
  {
    name: 'ずんだもん',
    speaker_uuid: 'speaker-uuid',
    version: '1.0',
    styles: [
      { name: 'ノーマル', id: 3, type: 'talk' },
      { name: 'あまあま', id: 1 },
    ],
  },
];
const wav = Buffer.from('RIFF\x04\x00\x00\x00WAVE');
const library = {
  name: 'テスト',
  uuid: 'library-uuid',
  version: '1.0',
  download_url: 'https://example.com/library.zip',
};

function setup(options: Partial<VoicevoxClientOptions> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new VoicevoxClient({ baseUrl: 'http://localhost:50021/', ...options, fetch });
  return { client, fetch };
}

afterEach(() => vi.useRealTimers());

describe('VoicevoxClient', () => {
  it('audio_query のテキストとスタイルをクエリに入れる', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(Response.json(query));
    expect(await client.audioQuery('こんにちは & + ? #', 3)).toEqual(query);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      'http://localhost:50021/audio_query?text=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF+%26+%2B+%3F+%23&speaker=3',
    );
    expect(init).toMatchObject({ method: 'POST', signal: expect.any(AbortSignal) });
    expect(init?.body).toBeUndefined();
  });

  it('synthesis はクエリを JSON 本体に入れ、WAV を Buffer で返す', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response(wav));
    const result = await client.synthesis(query, 3);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(wav);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('http://localhost:50021/synthesis?speaker=3');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(init!.body as string)).toEqual(query);
  });

  it('synthesize は未知のフィールドを保ち、指定された調整だけを適用する', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json(query)).mockResolvedValueOnce(new Response(wav));
    const overrides = {
      speedScale: 1.2,
      pitchScale: -0.1,
      intonationScale: 0.8,
      volumeScale: 0.5,
      prePhonemeLength: 0,
      postPhonemeLength: 0.2,
    };
    expect(await client.synthesize('テスト', 3, overrides)).toEqual(wav);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ ...query, ...overrides });
    expect(query.speedScale).toBe(1);
  });

  it('synthesize は調整なしでも使える', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json(query)).mockResolvedValueOnce(new Response(wav));
    await client.synthesize('テスト', 3);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual(query);
  });

  it.each([true, false])(
    'initialize_speaker の skip_reinit=%s をクエリに入れる',
    async (skipReinit) => {
      const { client, fetch } = setup();
      fetch.mockResolvedValue(new Response(null, { status: 204 }));
      await client.initializeSpeaker(3, { skipReinit });
      const [url, init] = fetch.mock.calls[0];
      expect(String(url)).toBe(
        `http://localhost:50021/initialize_speaker?speaker=3&skip_reinit=${skipReinit}`,
      );
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
    },
  );

  it('メタデータとライブラリを正しい GET エンドポイントから取得する', async () => {
    const { client, fetch } = setup();
    const manifest = {
      name: 'VOICEVOX ENGINE',
      brand_name: 'VOICEVOX',
      supported_features: { manage_library: false },
    };
    const installed = { [library.uuid]: { ...library, uninstallable: true } };
    fetch
      .mockResolvedValueOnce(Response.json('0.26.0'))
      .mockResolvedValueOnce(Response.json(manifest))
      .mockResolvedValueOnce(Response.json(false))
      .mockResolvedValueOnce(Response.json([library]))
      .mockResolvedValueOnce(Response.json(installed));
    expect(await client.version()).toBe('0.26.0');
    expect(await client.engineManifest()).toEqual(manifest);
    expect(await client.isInitializedSpeaker(3)).toBe(false);
    expect(await client.downloadableLibraries()).toEqual([library]);
    expect(await client.installedLibraries()).toEqual(installed);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'http://localhost:50021/version',
      'http://localhost:50021/engine_manifest',
      'http://localhost:50021/is_initialized_speaker?speaker=3',
      'http://localhost:50021/downloadable_libraries',
      'http://localhost:50021/installed_libraries',
    ]);
    expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('install_library は ZIP をそのまま送り、成功時にカタログを無効化する', async () => {
    const { client, fetch } = setup();
    fetch
      .mockResolvedValueOnce(Response.json(speakers))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json([]));
    await client.speakers();
    const archive = new Blob(['zip'], { type: 'application/zip' });
    await client.installLibrary('uuid/encoded', archive);
    expect(String(fetch.mock.calls[1][0])).toBe(
      'http://localhost:50021/install_library/uuid%2Fencoded',
    );
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: archive,
      headers: { 'Content-Type': 'application/zip' },
    });
    expect(await client.speakers()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('HTTP エラーはステータスと最大 512 文字の応答を持ち、再試行しない', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response('x'.repeat(1000), { status: 503 }));
    const error = await client.version().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(VoicevoxError);
    expect(error).toMatchObject({ kind: 'http', status: 503, responseBody: 'x'.repeat(512) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('HTTP エラー本文の読み取りに失敗してもステータスを保持し、再試行しない', async () => {
    const { client, fetch } = setup();
    const cause = new TypeError('connection closed');
    fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(cause);
          },
        }),
        { status: 503 },
      ),
    );
    await expect(client.version()).rejects.toMatchObject({
      kind: 'http',
      status: 503,
      responseBody: '',
      cause,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('GET の通信失敗は 2 回再試行して unavailable を返す', async () => {
    const { client, fetch } = setup();
    const cause = new TypeError('fetch failed');
    fetch.mockRejectedValue(cause);
    await expect(client.version()).rejects.toMatchObject({ kind: 'unavailable', cause });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Set(fetch.mock.calls.map(([, init]) => init?.signal)).size).toBe(3);
  });

  it('GET は一時的な通信失敗から回復できる', async () => {
    const { client, fetch } = setup();
    fetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json('1.0'));
    expect(await client.version()).toBe('1.0');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['audioQuery', 'synthesis', 'initializeSpeaker', 'installLibrary'] as const)(
    'POST %s の通信失敗は再試行しない',
    async (method) => {
      const { client, fetch } = setup();
      fetch.mockRejectedValue(new TypeError('fetch failed'));
      const requests = {
        audioQuery: () => client.audioQuery('テスト', 3),
        synthesis: () => client.synthesis(query, 3),
        initializeSpeaker: () => client.initializeSpeaker(3, { skipReinit: true }),
        installLibrary: () => client.installLibrary('uuid', new Blob(['zip'])),
      };
      await expect(requests[method]()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['GET', 'POST'])('%s の実タイムアウトを unavailable にする', async (method) => {
    const { client, fetch } = setup({ timeoutMs: 5 });
    fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init!.signal!;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const request = method === 'GET' ? client.version() : client.synthesis(query, 3);
    await expect(request).rejects.toMatchObject({
      kind: 'unavailable',
      cause: { name: 'TimeoutError' },
    });
    expect(fetch).toHaveBeenCalledTimes(method === 'GET' ? 3 : 1);
  });

  it('メタデータと POST でタイムアウトを使い分ける', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const { client, fetch } = setup();
      fetch.mockResolvedValueOnce(Response.json('1.0')).mockResolvedValueOnce(new Response(wav));
      await client.version();
      await client.synthesis(query, 3);
      expect(timeout.mock.calls).toEqual([[5000], [15000]]);
      const custom = setup({ timeoutMs: 30000, metadataTimeoutMs: 7000 });
      custom.fetch
        .mockResolvedValueOnce(Response.json('1.0'))
        .mockResolvedValueOnce(new Response(wav));
      await custom.client.version();
      await custom.client.synthesis(query, 3);
      expect(timeout.mock.calls.slice(2)).toEqual([[7000], [30000]]);
    } finally {
      timeout.mockRestore();
    }
  });

  it.each(['not json', '{}', 'null', '3'])('不正な JSON / 型 (%s) は再試行しない', async (body) => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(new Response(body));
    await expect(client.version()).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('不正なカタログをキャッシュしない', async () => {
    const { client, fetch } = setup();
    fetch
      .mockResolvedValueOnce(Response.json([{ ...speakers[0], styles: [{ id: '3' }] }]))
      .mockResolvedValueOnce(Response.json(speakers));
    await expect(client.speakers()).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(await client.speakers()).toEqual(speakers);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('不正な AudioQuery / WAV を拒否する', async () => {
    const { client, fetch } = setup();
    fetch
      .mockResolvedValueOnce(Response.json({ speedScale: 1 }))
      .mockResolvedValueOnce(new Response('not wav'));
    await expect(client.audioQuery('テスト', 3)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
    await expect(client.synthesis(query, 3)).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('読み取り中の通信失敗も unavailable として GET のみ再試行する', async () => {
    const { client, fetch } = setup();
    fetch.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('connection closed'));
            },
          }),
        ),
    );
    await expect(client.version()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('話者キャッシュは TTL の境界で期限切れになる', async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ speakerCacheTtlMs: 1000 });
    fetch.mockImplementation(async () => Response.json(speakers));
    const first = await client.speakers();
    first[0].name = '変更';
    vi.advanceTimersByTime(999);
    expect(await client.speakers()).toEqual(speakers);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await client.speakers();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('既定 TTL は 5 分で、無効化と明示更新が使える', async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup();
    fetch.mockImplementation(async () => Response.json(speakers));
    await client.speakers();
    vi.advanceTimersByTime(299999);
    await client.speakers();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await client.speakers();
    client.invalidateSpeakers();
    await client.speakers();
    expect(await client.refreshSpeakers()).toEqual(speakers);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('同時の話者取得はリクエストを共有する', async () => {
    const { client, fetch } = setup();
    let resolve!: (response: Response) => void;
    fetch.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const first = client.speakers();
    const second = client.speakers();
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(Response.json(speakers));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(speakers);
    expect(b).toEqual(speakers);
    expect(a).not.toBe(b);
  });

  it('取得失敗後は再取得できる', async () => {
    const { client, fetch } = setup();
    fetch
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(Response.json(speakers));
    const first = client.speakers();
    const second = client.speakers();
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(await client.speakers()).toEqual(speakers);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('取得中に無効化したカタログをキャッシュに戻さない', async () => {
    const { client, fetch } = setup();
    let resolve!: (response: Response) => void;
    fetch
      .mockReturnValueOnce(
        new Promise<Response>((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(Response.json([]));
    const pending = client.speakers();
    client.invalidateSpeakers();
    resolve(Response.json(speakers));
    await pending;
    expect(await client.speakers()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('スタイルを平坦化し、ID で検索する', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(Response.json(speakers));
    const expected = [
      { styleId: 3, speakerName: 'ずんだもん', styleName: 'ノーマル', speakerUuid: 'speaker-uuid' },
      { styleId: 1, speakerName: 'ずんだもん', styleName: 'あまあま', speakerUuid: 'speaker-uuid' },
    ];
    expect(flattenStyles(speakers)).toEqual(expected);
    expect(flattenStyles([])).toEqual([]);
    expect(await client.styles()).toEqual(expected);
    expect(await client.findStyle(3)).toEqual(expected[0]);
    expect(await client.findStyle(999)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
