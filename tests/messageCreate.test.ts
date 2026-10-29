import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { SpeakerCatalog } from '../src/tts/speakers.js';
import { Collection, type Message } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../src/commands/types.js';
import { handleMessage } from '../src/events/messageCreate.js';
import { VoicevoxClient } from '../src/tts/voicevox.js';
import { createVoiceResolver } from '../src/voice/resolver.js';
import type { GuildVoiceSession } from '../src/voice/session.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function createStore() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return new SqliteSettings(db);
}

function setup() {
  const enqueue = vi.fn();
  const session = {
    readsChannel: (id: string) => ['text', 'vc'].includes(id),
    enqueue,
  } as unknown as GuildVoiceSession;
  const get = vi.fn((): GuildVoiceSession | undefined => session);
  const context: CommandContext = {
    sessions: { get, join: vi.fn(), leave: vi.fn() },
    store: createStore(),
    catalog: new SpeakerCatalog({ styles: async () => [] }, { enabledSpeakers: () => [] }),
    resolveVoice: vi.fn(async () => ({ styleId: 8, speedScale: 1, pitchScale: 0 })),
  };
  const logger = { error: vi.fn() };
  const message = {
    guildId: 'guild',
    channelId: 'text',
    author: { id: 'user', bot: false },
    system: false,
    content: 'こんにちは',
    attachments: new Collection(),
    mentions: {
      members: new Collection([['1', { displayName: '名前' }]]),
      users: new Collection(),
      roles: new Collection(),
      channels: new Collection(),
    },
  };
  const options = { readSkipPrefix: ';', readMaxLength: 100 };
  const run = () => handleMessage(message as unknown as Message, context, options, logger);
  return { message, options, run, enqueue, context, get, logger };
}
describe('handleMessage', () => {
  it('非同期カタログ取得中のメッセージを到着順に追加する', async () => {
    const s = setup();
    let resolve!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const engine = new VoicevoxClient({ baseUrl: 'http://localhost:50021', fetch });
    s.context.catalog = new SpeakerCatalog(engine, s.context.store);
    s.context.resolveVoice = createVoiceResolver(s.context.store, s.context.catalog, 8, {
      debug: vi.fn(),
    });
    const first = handleMessage(
      { ...s.message, content: 'first' } as unknown as Message,
      s.context,
      s.options,
      s.logger,
    );
    const second = handleMessage(
      {
        ...s.message,
        author: { id: 'other', bot: false },
        content: 'second',
      } as unknown as Message,
      s.context,
      s.options,
      s.logger,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(
      Response.json([
        {
          name: 'test',
          speaker_uuid: '7ffcb7ce-00ec-4bdc-82cd-45a8889e43ff',
          version: '1',
          styles: [{ name: 'normal', id: 8 }],
        },
      ]),
    );
    await Promise.all([first, second]);
    expect(s.enqueue.mock.calls.map(([item]) => item.text)).toEqual(['first', 'second']);
  });
  it('対象チャンネルの本文を正規化して話者を解決する', async () => {
    const s = setup();
    s.message.content = '<@1> www';
    await s.run();
    expect(s.enqueue).toHaveBeenCalledWith({
      text: '名前 わらわら',
      styleId: 8,
      speedScale: 1,
      pitchScale: 0,
    });
    expect(s.context.resolveVoice).toHaveBeenCalledWith('guild', 'user');
  });
  it.each(['bot', 'system', 'channel', 'guild', 'session', 'prefix', 'empty'])(
    '%s を無視する',
    async (kind) => {
      const s = setup();
      if (kind === 'bot') s.message.author.bot = true;
      if (kind === 'system') s.message.system = true;
      if (kind === 'channel') s.message.channelId = 'other';
      if (kind === 'guild') s.message.guildId = '';
      if (kind === 'session') s.get.mockReturnValue(undefined);
      if (kind === 'prefix') s.message.content = ';skip';
      if (kind === 'empty') s.message.content = ' \n ';
      await s.run();
      expect(s.enqueue).not.toHaveBeenCalled();
    },
  );
  it('除外接頭辞を変更・無効化できる', async () => {
    const s = setup();
    s.options.readSkipPrefix = '!';
    s.message.content = '!skip';
    await s.run();
    expect(s.enqueue).not.toHaveBeenCalled();
    s.options.readSkipPrefix = '';
    await s.run();
    expect(s.enqueue).toHaveBeenCalled();
  });
  it('VC チャットも読み上げる', async () => {
    const s = setup();
    s.message.channelId = 'vc';
    await s.run();
    expect(s.enqueue).toHaveBeenCalled();
  });
  it('例外を捕捉する', async () => {
    const s = setup();
    s.enqueue.mockImplementation(() => {
      throw new Error('failure');
    });
    await expect(s.run()).resolves.toBeUndefined();
    expect(s.logger.error).toHaveBeenCalled();
  });
});
