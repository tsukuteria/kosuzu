export interface ShutdownResources {
  stopSessions(): void;
  drainAutoJoin(): Promise<void>;
  destroyClient(): Promise<void>;
  closeDatabase(): void;
}

/** 新しい処理を止め、DB を使う実行中の処理が終わってから閉じる。 */
export class RuntimeLifecycle {
  private stopping = false;
  private readonly pending = new Set<Promise<void>>();
  private shutdown: Promise<void> | undefined;

  async run(operation: () => void | Promise<void>): Promise<void> {
    if (this.stopping) return;
    const task = Promise.resolve().then(operation);
    this.pending.add(task);
    try {
      await task;
    } finally {
      this.pending.delete(task);
    }
  }

  stop(resources: ShutdownResources): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    this.shutdown = Promise.resolve().then(async () => {
      resources.stopSessions();
      await Promise.allSettled([...this.pending, resources.drainAutoJoin()]);
      // client.destroy() までに既存 collector の DB 利用も run() 経由で完了済み。
      try {
        await resources.destroyClient();
      } finally {
        resources.closeDatabase();
      }
    });
    return this.shutdown;
  }
}
