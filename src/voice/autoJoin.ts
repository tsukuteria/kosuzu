import { ChannelType, PermissionFlagsBits, type Guild, type VoiceState } from 'discord.js';
import type { Logger } from 'pino';
import type { SettingsStore } from '../store/settings.js';
import type { ResolvedVoice } from './resolver.js';
import { JOIN_ANNOUNCEMENT, type VoiceSessionManager } from './manager.js';

export interface VoiceCandidate {
  id: string;
  position: number;
  humans: number;
  eligible: boolean;
}

export function countHumans(members: Iterable<{ user: { bot: boolean } }>): number {
  return [...members].filter((member) => !member.user.bot).length;
}

export function selectChannel(channels: readonly VoiceCandidate[]): VoiceCandidate | undefined {
  return channels
    .filter((c) => c.eligible && c.humans > 0)
    .sort(
      (a, b) =>
        b.humans - a.humans || a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
}

export function sessionStarted(
  before: number,
  after: number,
  connected: boolean,
  enabled: boolean,
  eligible: boolean,
): boolean {
  return before === 0 && after > 0 && !connected && enabled && eligible;
}

export function voiceCandidates(guild: Guild, excluded: readonly string[]): VoiceCandidate[] {
  const me = guild.members.me;
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildVoice)
    .map((c) => ({
      id: c.id,
      position: c.position,
      humans: countHumans(c.members.values()),
      eligible:
        c.id !== guild.afkChannelId &&
        !excluded.includes(c.id) &&
        !!me &&
        !!c.permissionsFor(me)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]),
    }));
}

export class AutoJoin {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly guilds = new Map<string, Guild>();
  private stopped = false;

  constructor(
    private readonly sessions: Pick<
      VoiceSessionManager,
      'get' | 'join' | 'leave' | 'updateVoiceState' | 'onChange' | 'onShutdown'
    >,
    private readonly store: Pick<SettingsStore, 'guild'>,
    private readonly resolveVoice: (guildId: string) => Promise<ResolvedVoice>,
    private readonly graceMs: number,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {
    sessions.onChange.add((id) => {
      const guild = this.guilds.get(id);
      if (guild && !this.stopped) this.refresh(guild);
    });
    sessions.onShutdown.add(() => this.destroy());
  }

  async update(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guild = newState.guild;
    if (this.stopped || oldState.channelId === newState.channelId) return Promise.resolve();
    this.guilds.set(guild.id, guild);
    if (newState.id === guild.client.user.id) {
      clearTimeout(this.timers.get(guild.id));
      this.timers.delete(guild.id);
      this.sessions.updateVoiceState(guild.id, newState.channelId, oldState.channelId);
      this.refresh(guild);
      return Promise.resolve();
    }
    const candidate = this.candidates(guild).find((c) => c.id === newState.channelId);
    const started =
      !!candidate &&
      !newState.member?.user.bot &&
      sessionStarted(
        candidate.humans - 1,
        candidate.humans,
        !!this.sessions.get(guild.id),
        this.enabled(guild),
        candidate.eligible,
      );
    // 猶予の取消は待機中の非同期処理より先に反映する。
    this.refresh(guild);
    return this.serialize(guild.id, async () => {
      if (started && candidate) await this.join(guild, candidate.id);
      this.refresh(guild);
    });
  }

  async scan(guilds: Iterable<Guild>): Promise<void> {
    await Promise.all(
      [...guilds].map((guild) => {
        this.guilds.set(guild.id, guild);
        return this.serialize(guild.id, async () => {
          const channel = selectChannel(this.candidates(guild));
          if (channel) await this.join(guild, channel.id);
          this.refresh(guild);
        });
      }),
    );
  }

  destroy(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.guilds.clear();
  }

  private enabled(guild: Guild): boolean {
    return this.store.guild(guild.id)?.autojoin ?? true;
  }
  private candidates(guild: Guild): VoiceCandidate[] {
    return voiceCandidates(guild, this.store.guild(guild.id)?.excludedVoiceChannels ?? []);
  }

  private refresh(guild: Guild): void {
    const session = this.sessions.get(guild.id);
    const channel = session && guild.channels.cache.get(session.channelId);
    const empty = channel?.isVoiceBased() && countHumans(channel.members.values()) === 0;
    if (!session || !empty) {
      clearTimeout(this.timers.get(guild.id));
      this.timers.delete(guild.id);
    } else if (!this.timers.has(guild.id)) {
      const timer = setTimeout(() => {
        void this.serialize(guild.id, async () => {
          if (this.timers.get(guild.id) !== timer) return;
          this.timers.delete(guild.id);
          if (this.sessions.get(guild.id) !== session) return;
          const current = guild.channels.cache.get(session.channelId);
          if (!current?.isVoiceBased() || countHumans(current.members.values()) > 0) return;
          this.sessions.leave(guild.id);
          const next = selectChannel(this.candidates(guild));
          if (next) await this.join(guild, next.id);
          this.refresh(guild);
        });
      }, this.graceMs);
      this.timers.set(guild.id, timer);
    }
  }

  private async join(guild: Guild, id: string): Promise<void> {
    if (this.stopped || !this.enabled(guild) || this.sessions.get(guild.id)) return;
    if (!this.candidates(guild).some((c) => c.id === id && c.eligible && c.humans > 0)) return;
    const channel = guild.channels.cache.get(id);
    if (channel?.type !== ChannelType.GuildVoice) return;
    const session = await this.sessions.join(channel, 'auto');
    this.refresh(guild);
    if (session.channelId !== id) return;
    if (this.store.guild(guild.id)?.announceJoin === false) return;
    try {
      const voice = await this.resolveVoice(guild.id);
      if (!this.stopped && this.sessions.get(guild.id) === session)
        session.enqueue({ text: JOIN_ANNOUNCEMENT, ...voice });
    } catch (error) {
      this.logger.warn({ err: error, guildId: guild.id }, '接続アナウンスに失敗しました');
    }
  }

  private serialize(id: string, operation: () => Promise<void>): Promise<void> {
    const task = (this.pending.get(id) ?? Promise.resolve())
      .then(async () => {
        if (!this.stopped) await operation();
      })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, guildId: id }, '自動入退室に失敗しました');
      })
      .finally(() => {
        if (this.pending.get(id) === task) this.pending.delete(id);
      });
    this.pending.set(id, task);
    return task;
  }
}
