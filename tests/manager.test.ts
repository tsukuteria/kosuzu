import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceBasedChannel } from 'discord.js';
import type { Logger } from 'pino';
import { VoiceSessionManager } from '../src/voice/manager.js';
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
function setup() {
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
  const manager = new VoiceSessionManager(engine, logger as unknown as Logger, 20);
  const channel = (id = 'vc') =>
    ({ id, guild: { id: 'guild', voiceAdapterCreator: vi.fn() } }) as unknown as VoiceBasedChannel;
  return { manager, connections, channel, logger, engine };
}
beforeEach(() => vi.resetAllMocks());
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
describe('VoiceSessionManager', () => {
  it('Ready を待ち、同じ VC なら対象テキストだけ更新する', async () => {
    const s = setup();
    const session = await s.manager.join(s.channel(), 'text');
    expect(joinVoiceChannel).toHaveBeenCalledWith(expect.objectContaining({ selfDeaf: true }));
    expect(entersState).toHaveBeenCalledWith(s.connections[0], 'ready', 15000);
    expect(await s.manager.join(s.channel(), 'next')).toBe(session);
    expect(session.textChannelId).toBe('next');
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
  });
  it('別 VC へは古い接続を破棄して移動する', async () => {
    const s = setup();
    await s.manager.join(s.channel(), 'text');
    const next = await s.manager.join(s.channel('next'), 'other');
    expect(s.connections[0].destroy).toHaveBeenCalledTimes(1);
    expect(s.manager.get('guild')).toBe(next);
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
});
