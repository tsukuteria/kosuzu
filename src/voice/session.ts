import type { Logger } from 'pino';
import type { Character, SessionCredits } from './credits.js';

export interface Utterance {
  text: string;
  styleId: number;
  speedScale?: number;
  pitchScale?: number;
  character?: Character;
}
export interface SessionPlayer {
  play(pcm: Buffer): void;
  stop(): void;
  onIdle(listener: () => void): void;
  onError(listener: (error: Error) => void): void;
}
interface Item {
  utterance: Utterance;
  credit?: Promise<void>;
  started?: boolean;
  ready?: boolean;
  pcm?: Buffer;
}

export class GuildVoiceSession {
  lastSpeakerId?: string;
  private readChannelIds = new Set<string>();
  private queue: Item[] = [];
  private current?: Item;
  private destroyed = false;
  private synthesizing = 0;

  constructor(
    public channelId: string,
    textChannelIds: Iterable<string>,
    private readonly player: SessionPlayer,
    private readonly connection: { destroy(): void },
    private readonly synthesize: (utterance: Utterance) => Promise<Buffer>,
    private readonly maxQueueLength: number,
    private readonly logger: Pick<Logger, 'warn'>,
    private readonly onDestroy: () => void = () => {},
    public readonly credits?: SessionCredits,
  ) {
    this.setReadChannels(textChannelIds);
    player.onIdle(() => {
      this.current = undefined;
      this.pump();
    });
    player.onError((error) => {
      this.logger.warn({ err: error }, '音声の再生に失敗しました');
      this.skip();
    });
  }

  setReadChannels(ids: Iterable<string>): void {
    this.readChannelIds = new Set([this.channelId, ...ids]);
  }

  readsChannel(id: string): boolean {
    return this.readChannelIds.has(id);
  }

  move(channelId: string): void {
    this.readChannelIds.delete(this.channelId);
    this.channelId = channelId;
    this.readChannelIds.add(channelId);
  }

  enqueue(utterance: Utterance): boolean {
    if (this.destroyed) return false;
    if (this.queue.length >= this.maxQueueLength) {
      this.logger.warn('読み上げキューが満杯のため新しい発話を破棄します');
      return false;
    }
    const credit = this.credits?.use(utterance);
    this.queue.push({ utterance, credit });
    this.pump();
    return true;
  }

  skip(): void {
    if (this.destroyed) return;
    if (this.current) {
      this.current = undefined;
      this.player.stop();
    } else {
      this.queue.shift();
    }
    this.pump();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.queue = [];
    this.current = undefined;
    this.player.stop();
    this.connection.destroy();
    this.onDestroy();
  }

  private pump(): void {
    if (this.destroyed) return;
    while (!this.current && this.queue[0]?.ready) {
      const item = this.queue.shift()!;
      if (!item.pcm) continue;
      this.current = item;
      try {
        this.player.play(item.pcm);
      } catch (error) {
        this.logger.warn({ err: error }, '音声の再生に失敗しました');
        this.current = undefined;
      }
    }
    for (const item of this.queue.slice(0, 2)) {
      if (item.started || this.synthesizing >= 2) continue;
      item.started = true;
      this.synthesizing++;
      void Promise.resolve()
        .then(() => item.credit)
        .then(() => this.synthesize(item.utterance))
        .then(
          (pcm) => {
            if (!this.destroyed) item.pcm = pcm;
          },
          (error: unknown) =>
            this.logger.warn({ err: error }, '音声合成に失敗した発話をスキップします'),
        )
        .finally(() => {
          this.synthesizing--;
          item.ready = true;
          this.pump();
        });
    }
  }
}
