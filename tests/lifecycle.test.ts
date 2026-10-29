import { describe, expect, it, vi } from 'vitest';
import { RuntimeLifecycle } from '../src/lifecycle.js';

describe('RuntimeLifecycle', () => {
  it('実行中の DB 利用を待ち、新規処理を拒否し、重複終了でも一度だけ閉じる', async () => {
    const runtime = new RuntimeLifecycle();
    const order: string[] = [];
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    let finishAutoJoin!: () => void;
    const autoJoin = new Promise<void>((done) => {
      finishAutoJoin = done;
    });
    const task = runtime.run(async () => {
      await promise;
      order.push('write');
    });
    const resources = {
      stopSessions: vi.fn(() => {
        order.push('sessions');
      }),
      drainAutoJoin: () => autoJoin,
      destroyClient: vi.fn(async () => {
        order.push('client');
      }),
      closeDatabase: vi.fn(() => {
        order.push('db');
      }),
    };
    const stopped = runtime.stop(resources);
    expect(runtime.stop(resources)).toBe(stopped);
    const late = vi.fn();
    await runtime.run(late);
    expect(late).not.toHaveBeenCalled();
    expect(order).toEqual(['sessions']);
    resolve();
    await task;
    expect(resources.closeDatabase).not.toHaveBeenCalled();
    order.push('auto-write');
    finishAutoJoin();
    await stopped;
    expect(order).toEqual(['sessions', 'write', 'auto-write', 'client', 'db']);
    expect(resources.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it('処理の失敗や client の終了失敗でも DB を一度閉じる', async () => {
    const runtime = new RuntimeLifecycle();
    const task = runtime.run(async () => {
      throw new Error('command');
    });
    const closeDatabase = vi.fn();
    const stopped = runtime.stop({
      stopSessions: vi.fn(),
      drainAutoJoin: async () => {},
      destroyClient: async () => {
        throw new Error('client');
      },
      closeDatabase,
    });
    await expect(task).rejects.toThrow('command');
    await expect(stopped).rejects.toThrow('client');
    expect(closeDatabase).toHaveBeenCalledTimes(1);
  });
});
