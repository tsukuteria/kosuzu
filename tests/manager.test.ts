import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceBasedChannel } from 'discord.js';
import type { Logger } from 'pino';
import { VoiceSessionManager } from '../src/voice/manager.js';
import type { CreditOptions } from '../src/voice/credits.js';
import {
  entersState,
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
} from '@discordjs/voice';

vi.mock('@discordjs/voice', () => ({
  VoiceConnectionStatus: {
    Ready: 'ready',
    Destroyed: 'destroyed',
    Disconnected: 'disconnected',
    Signalling: 'signalling',
    Connecting: 'connecting',
  },
  AudioPlayerStatus: { Idle: 'idle' },
  StreamType: { Raw: 'raw' },
  joinVoiceChannel: vi.fn(),
  createAudioPlayer: vi.fn(),
  createAudioResource: vi.fn(() => ({})),
  entersState: vi.fn(),
}));
function setup(creditOptions?: CreditOptions) {
  const connections: ReturnType<typeof connection>[] = [];
  function connection() {
    const c = Object.assign(new EventEmitter(), {
      state: { status: 'ready' },
      subscribe: vi.fn(),
      destroy: vi.fn(() => {
        c.state.status = 'destroyed';
        c.emit('destroyed');
      }),
    });
    return c;
  }
  const player = Object.assign(new EventEmitter(), { play: vi.fn(), stop: vi.fn() });
  vi.mocked(joinVoiceChannel).mockImplementation(() => {
    const c = connection();
    connections.push(c);
    return c as unknown as ReturnType<typeof joinVoiceChannel>;
  });
  vi.mocked(createAudioPlayer).mockReturnValue(
    player as unknown as ReturnType<typeof createAudioPlayer>,
  );
  vi.mocked(entersState).mockResolvedValue({} as never);
  const engine = { synthesize: vi.fn().mockResolvedValue(Buffer.from('invalid')) };
  const logger = { warn: vi.fn() };
  const manager = new VoiceSessionManager(
    engine,
    logger as unknown as Logger,
    20,
    undefined,
    creditOptions,
  );
  const send = vi.fn().mockResolvedValue(undefined);
  const channel = (id = 'vc') =>
    ({
      id,
      members: new Map([['u', { id: 'u', user: { bot: false } }]]),
      isSendable: () => true,
      send,
      permissionsFor: () => ({ has: () => true }),
      guild: { id: 'guild', members: { me: {} }, voiceAdapterCreator: vi.fn() },
    }) as unknown as VoiceBasedChannel;
  return { manager, connections, channel, logger, engine, send };
}
beforeEach(() => vi.resetAllMocks());
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
describe('VoiceSessionManager', () => {
  it('自動接続で公開通知し、手動移動・外部移動では集合を引き継ぎ退出後は初期化する', async () => {
    const style = {
      styleId: 3,
      styleName: 'ノーマル',
      speakerUuid: 'z',
      speakerName: 'ずんだもん',
    };
    const s = setup({
      catalog: { list: async () => [style], find: async () => style },
      resolveVoice: async () => ({ styleId: 3, speedScale: 1, pitchScale: 0 }),
    });
    const first = await s.manager.join(s.channel(), 'auto');
    expect(s.send).toHaveBeenCalledWith(
      '接続しました。\n現在設定されているキャラクター：VOICEVOX:ずんだもん',
    );
    expect(first.credits?.credited).toEqual(new Set(['z']));
    s.manager.updateVoiceState('guild', 'external');
    expect(first.credits?.announceChannelId).toBe('vc');
    const moved = await s.manager.join(s.channel('next'), 'text');
    expect(moved.credits).toBe(first.credits);
    expect(moved.credits?.credited).toEqual(new Set(['z']));
    s.manager.leave('guild');
    const next = await s.manager.join(s.channel('new'), 'text');
    expect(next.credits).not.toBe(first.credits);
    expect(next.credits?.credited.size).toBe(0);
    s.manager.destroyAll();
  });
  it('移動前の遅延退出イベントで新しい接続を破棄しない', async () => {
    const s = setup();
    await s.manager.join(s.channel(), 'text');
    const next = await s.manager.join(s.channel('next'), 'text');
    s.manager.updateVoiceState('guild', null, 'vc');
    expect(s.manager.get('guild')).toBe(next);
    s.manager.updateVoiceState('guild', 'next', null);
    s.manager.updateVoiceState('guild', null, 'next');
    expect(s.manager.get('guild')).toBeUndefined();
  });
  it('キックを即座に破棄し、後続 Disconnected で復旧待機しない', async () => {
    const s = setup();
    const session = await s.manager.join(s.channel(), 'text');
    s.manager.updateVoiceState('guild', 'moved');
    expect(session.channelId).toBe('moved');
    expect(session.readsChannel('text')).toBe(true);
    expect(session.readsChannel('vc')).toBe(false);
    vi.mocked(entersState).mockClear();
    s.manager.updateVoiceState('guild', null);
    s.connections[0].emit('disconnected');
    await flush();
    expect(s.manager.get('guild')).toBeUndefined();
    expect(entersState).not.toHaveBeenCalled();
  });
  it('復旧待機中のキックも後続 Ready 待機を抑止する', async () => {
    const s = setup();
    await s.manager.join(s.channel(), 'text');
    vi.mocked(entersState).mockClear();
    s.connections[0].emit('disconnected');
    s.manager.updateVoiceState('guild', null);
    await flush();
    expect(vi.mocked(entersState).mock.calls.some(([, status]) => String(status) === 'ready')).toBe(
      false,
    );
  });
  it('手動 join と auto の競合では既存の手動接続を維持する', async () => {
    const s = setup();
    const manual = s.manager.join(s.channel(), 'text');
    const auto = s.manager.join(s.channel('other'), 'auto');
    expect(await auto).toBe(await manual);
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
  });
  it('Ready を待ち、同じ VC なら対象テキストだけ更新する', async () => {
    const s = setup();
    const session = await s.manager.join(s.channel(), 'text');
    expect(joinVoiceChannel).toHaveBeenCalledWith(expect.objectContaining({ selfDeaf: true }));
    expect(entersState).toHaveBeenCalledWith(s.connections[0], 'ready', 15000);
    expect(await s.manager.join(s.channel(), 'next')).toBe(session);
    expect(session.readsChannel('next')).toBe(true);
    expect(session.readsChannel('vc')).toBe(true);
    expect(session.readsChannel('text')).toBe(false);
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
  });
  it('別 VC へは古い接続を破棄して移動する', async () => {
    const s = setup();
    await s.manager.join(s.channel(), 'text');
    const next = await s.manager.join(s.channel('next'), 'other');
    expect(s.connections[0].destroy).toHaveBeenCalledTimes(1);
    expect(s.manager.get('guild')).toBe(next);
    expect(next.readsChannel('next')).toBe(true);
    expect(next.readsChannel('vc')).toBe(false);
    expect(next.readsChannel('other')).toBe(true);
    s.manager.destroyAll();
    expect(s.manager.get('guild')).toBeUndefined();
    expect(s.connections[1].destroy).toHaveBeenCalledTimes(1);
  });
  it('Ready タイムアウトで接続を破棄して登録解除する', async () => {
    const s = setup();
    vi.mocked(entersState).mockRejectedValue(new Error('timeout'));
    await expect(s.manager.join(s.channel(), 'text')).rejects.toThrow('timeout');
    expect(s.manager.get('guild')).toBeUndefined();
    expect(s.connections[0].destroy).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('切断の復旧成否に応じて維持・破棄する (%s)', async (recover) => {
    const s = setup();
    await s.manager.join(s.channel(), 'text');
    if (!recover) vi.mocked(entersState).mockRejectedValue(new Error('timeout'));
    s.connections[0].emit('disconnected');
    await flush();
    expect(entersState).toHaveBeenCalledWith(s.connections[0], 'signalling', 5000);
    expect(entersState).toHaveBeenCalledWith(s.connections[0], 'connecting', 5000);
    expect(!!s.manager.get('guild')).toBe(recover);
  });
  it('外部から破棄されても登録解除する', async () => {
    const s = setup();
    await s.manager.join(s.channel(), 'text');
    s.connections[0].destroy();
    expect(s.manager.get('guild')).toBeUndefined();
    expect(s.manager.leave('guild')).toBe(false);
  });
  it('合成は Raw 用の形式を要求し、不正な WAV を再生しない', async () => {
    const s = setup();
    const session = await s.manager.join(s.channel(), 'text');
    session.enqueue({ text: 'hello', styleId: 3 });
    await flush();
    expect(s.engine.synthesize).toHaveBeenCalledWith('hello', 3, {
      outputSamplingRate: 48000,
      outputStereo: true,
    });
    expect(s.logger.warn).toHaveBeenCalled();
    expect(createAudioResource).not.toHaveBeenCalled();
  });
  it.each(['allowed', 'denied', 'deleted', 'fetchError'])(
    'auto は閲覧・送信できる最後の join チャンネルだけ追加する (%s)',
    async (kind) => {
      const s = setup();
      const db = openDatabase(':memory:');
      try {
        const store = new SqliteSettings(db);
        store.setLastTextChannel('guild', 'last');
        const manager = new VoiceSessionManager(s.engine, s.logger as unknown as Logger, 20, store);
        const fetch = vi.fn().mockResolvedValue(
          kind === 'deleted'
            ? null
            : {
                isTextBased: () => true,
                permissionsFor: () => ({ has: () => kind === 'allowed' }),
              },
        );
        if (kind === 'fetchError') fetch.mockRejectedValue(new Error('missing'));
        const channel = {
          id: 'vc',
          guild: { id: 'guild', members: { me: {} }, channels: { fetch } },
        } as unknown as VoiceBasedChannel;
        expect(await manager.readTargets(channel, 'auto')).toEqual(
          new Set(kind === 'allowed' ? ['vc', 'last'] : ['vc']),
        );
        const session = await manager.join(channel, 'auto');
        expect(session.readsChannel('vc')).toBe(true);
        expect(session.readsChannel('last')).toBe(kind === 'allowed');
        expect(store.guild('guild')?.lastTextChannelId).toBe('last');
        manager.destroyAll();
      } finally {
        db.close();
      }
    },
  );
  it('ユーザーの速度・ピッチを合成に渡す', async () => {
    const s = setup();
    const session = await s.manager.join(s.channel(), 'text');
    session.enqueue({ text: 'hello', styleId: 8, speedScale: 1.5, pitchScale: -0.1 });
    await flush();
    expect(s.engine.synthesize).toHaveBeenCalledWith('hello', 8, {
      speedScale: 1.5,
      pitchScale: -0.1,
      outputSamplingRate: 48000,
      outputStereo: true,
    });
  });
  it('最後の join がない auto 参加は VC チャットだけを読む', async () => {
    const s = setup();
    expect(await s.manager.readTargets(s.channel(), 'auto')).toEqual(new Set(['vc']));
  });
});
