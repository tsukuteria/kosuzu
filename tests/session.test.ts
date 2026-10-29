import { describe, expect, it, vi } from 'vitest';
import { GuildVoiceSession, type SessionPlayer, type Utterance } from '../src/voice/session.js';

const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function setup(max = 20) {
  let idle!: () => void;
  let error!: (error: Error) => void;
  const player: SessionPlayer = {
    play: vi.fn(),
    stop: vi.fn(() => idle()),
    onIdle: (fn) => {
      idle = fn;
    },
    onError: (fn) => {
      error = fn;
    },
  };
  const pending = new Map<string, { resolve(value: Buffer): void; reject(error: Error): void }>();
  const synthesize = vi.fn(
    ({ text }: Utterance) =>
      new Promise<Buffer>((resolve, reject) => pending.set(text, { resolve, reject })),
  );
  const connection = { destroy: vi.fn() };
  const logger = { warn: vi.fn() };
  const removed = vi.fn();
  const session = new GuildVoiceSession(
    'vc',
    'text',
    player,
    connection,
    synthesize,
    max,
    logger,
    removed,
  );
  const enqueue = (text: string) => session.enqueue({ text, styleId: 3 });
  const resolve = async (text: string) => {
    pending.get(text)!.resolve(Buffer.from(text));
    await flush();
  };
  return {
    session,
    player,
    connection,
    synthesize,
    pending,
    logger,
    removed,
    enqueue,
    resolve,
    idle: () => idle(),
    error: () => error(new Error('player')),
  };
}
describe('GuildVoiceSession', () => {
  it('合成の完了順によらず FIFO、再生中は次の 2 件を先読みする', async () => {
    const s = setup();
    ['a', 'b', 'c', 'd'].forEach(s.enqueue);
    await flush();
    expect(s.synthesize.mock.calls.map(([u]) => u.text)).toEqual(['a', 'b']);
    await s.resolve('b');
    expect(s.player.play).not.toHaveBeenCalled();
    await s.resolve('a');
    expect(s.player.play).toHaveBeenLastCalledWith(Buffer.from('a'));
    expect(s.synthesize.mock.calls.map(([u]) => u.text)).toEqual(['a', 'b', 'c']);
    s.idle();
    await flush();
    expect(s.player.play).toHaveBeenLastCalledWith(Buffer.from('b'));
    await s.resolve('d');
    s.idle();
    expect(s.player.play).toHaveBeenCalledTimes(2);
    await s.resolve('c');
    s.idle();
    expect(vi.mocked(s.player.play).mock.calls.map(([pcm]) => pcm.toString())).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
  it('合成失敗はその項目だけスキップする', async () => {
    const s = setup();
    s.enqueue('a');
    s.enqueue('b');
    await flush();
    s.pending.get('a')!.reject(new Error('engine'));
    await s.resolve('b');
    expect(s.logger.warn).toHaveBeenCalled();
    expect(s.player.play).toHaveBeenCalledWith(Buffer.from('b'));
  });
  it('skip とプレイヤーエラーで次へ進む', async () => {
    const s = setup();
    ['a', 'b', 'c'].forEach(s.enqueue);
    await flush();
    await s.resolve('a');
    await s.resolve('b');
    await s.resolve('c');
    s.session.skip();
    expect(s.player.play).toHaveBeenLastCalledWith(Buffer.from('b'));
    s.error();
    expect(s.player.play).toHaveBeenLastCalledWith(Buffer.from('c'));
  });
  it('合成待ちもスキップでき、遅い完了で再生しない', async () => {
    const s = setup();
    s.enqueue('a');
    s.enqueue('b');
    await flush();
    s.session.skip();
    await s.resolve('b');
    await s.resolve('a');
    expect(s.player.play).toHaveBeenCalledTimes(1);
    expect(s.player.play).toHaveBeenCalledWith(Buffer.from('b'));
  });
  it('上限は未再生件数で、新しい項目を拒否する', async () => {
    const s = setup(2);
    expect(s.enqueue('a')).toBe(true);
    expect(s.enqueue('b')).toBe(true);
    expect(s.enqueue('c')).toBe(false);
    await flush();
    await s.resolve('a');
    expect(s.enqueue('d')).toBe(true);
    expect(s.logger.warn).toHaveBeenCalled();
  });
  it('destroy は冪等で、合成中・待機中の項目も再生しない', async () => {
    const s = setup();
    ['a', 'b', 'c'].forEach(s.enqueue);
    await flush();
    await s.resolve('a');
    s.session.destroy();
    s.session.destroy();
    await s.resolve('b');
    s.idle();
    expect(s.enqueue('d')).toBe(false);
    expect(s.player.play).toHaveBeenCalledTimes(1);
    expect(s.connection.destroy).toHaveBeenCalledTimes(1);
    expect(s.removed).toHaveBeenCalledTimes(1);
  });
});
