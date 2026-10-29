import { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  StreamType,
} from '@discordjs/voice';
import { PermissionFlagsBits, type VoiceBasedChannel } from 'discord.js';
import type { SettingsStore } from '../store/settings.js';
import type { Logger } from 'pino';
import type { TtsEngine } from '../tts/voicevox.js';
import { wavToPcm } from '../tts/wav.js';
import { GuildVoiceSession } from './session.js';

export const JOIN_ANNOUNCEMENT = '接続しました';

export class VoiceSessionManager {
  private readonly sessions = new Map<string, GuildVoiceSession>();
  private readonly pending = new Map<string, Promise<GuildVoiceSession>>();
  private generation = 0;
  readonly onChange = new Set<(guildId: string) => void>();
  readonly onShutdown = new Set<() => void>();

  updateVoiceState(
    guildId: string,
    channelId: string | null,
    previousChannelId?: string | null,
  ): void {
    const session = this.get(guildId);
    if (!session) return;
    if (
      previousChannelId !== undefined &&
      previousChannelId !== session.channelId &&
      channelId !== session.channelId
    )
      return;
    if (channelId === null) session.destroy();
    else session.move(channelId);
    for (const listener of this.onChange) listener(guildId);
  }

  constructor(
    private readonly engine: Pick<TtsEngine, 'synthesize'>,
    private readonly logger: Logger,
    private readonly maxQueueLength: number,
    private readonly store?: Pick<SettingsStore, 'guild'>,
  ) {}

  get(guildId: string): GuildVoiceSession | undefined {
    return this.sessions.get(guildId);
  }

  async readTargets(
    channel: VoiceBasedChannel,
    textChannelId: string | 'auto',
  ): Promise<Set<string>> {
    const targets = new Set([channel.id]);
    if (textChannelId !== 'auto') targets.add(textChannelId);
    else {
      const last = this.store?.guild(channel.guild.id)?.lastTextChannelId;
      if (last) {
        const text = await channel.guild.channels.fetch(last).catch(() => null);
        const me = channel.guild.members.me;
        if (
          text &&
          me &&
          text.isTextBased() &&
          text
            .permissionsFor(me)
            ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
        )
          targets.add(last);
      }
    }
    return targets;
  }

  async join(
    channel: VoiceBasedChannel,
    textChannelId: string | 'auto',
  ): Promise<GuildVoiceSession> {
    const prior = this.pending.get(channel.guild.id);
    const generation = this.generation;
    const operation = (async () => {
      if (prior) await prior.catch(() => {});
      if (generation !== this.generation) throw new Error('終了処理中です');
      if (textChannelId === 'auto' && this.get(channel.guild.id))
        return this.get(channel.guild.id)!;
      const targets = await this.readTargets(channel, textChannelId);
      if (generation !== this.generation) throw new Error('終了処理中です');
      const existing = this.get(channel.guild.id);
      if (existing?.channelId === channel.id) {
        existing.setReadChannels(targets);
        return existing;
      }
      this.leave(channel.guild.id);
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
      });
      const player = createAudioPlayer();
      const session = new GuildVoiceSession(
        channel.id,
        targets,
        {
          play: (pcm) =>
            player.play(createAudioResource(Readable.from([pcm]), { inputType: StreamType.Raw })),
          stop: () => {
            player.stop(true);
          },
          onIdle: (listener) => {
            player.on(AudioPlayerStatus.Idle, listener);
          },
          onError: (listener) => {
            player.on('error', listener);
          },
        },
        {
          destroy: () => {
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
          },
        },
        async ({ text, styleId, ...overrides }) =>
          wavToPcm(
            await this.engine.synthesize(text, styleId, {
              ...overrides,
              outputSamplingRate: 48000,
              outputStereo: true,
            }),
          ),
        this.maxQueueLength,
        this.logger,
        () => {
          if (this.get(channel.guild.id) === session) this.sessions.delete(channel.guild.id);
          for (const listener of this.onChange) listener(channel.guild.id);
        },
      );
      this.sessions.set(channel.guild.id, session);
      connection.subscribe(player);
      connection.on('error', (error) =>
        this.logger.warn({ err: error }, '音声接続でエラーが発生しました'),
      );
      connection.on(VoiceConnectionStatus.Destroyed, () => session.destroy());
      connection.on(VoiceConnectionStatus.Disconnected, () => {
        if (this.get(channel.guild.id) !== session) return;
        void Promise.any([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ])
          .then(() => {
            if (this.get(channel.guild.id) === session)
              return entersState(connection, VoiceConnectionStatus.Ready, 15000);
          })
          .catch((error: unknown) => {
            if (this.get(channel.guild.id) !== session) return;
            this.logger.warn({ err: error }, '音声接続の復旧に失敗しました');
            session.destroy();
          });
      });
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
      } catch (error) {
        session.destroy();
        throw error;
      }
      if (this.get(channel.guild.id) !== session) throw new Error('音声接続が切断されました');
      for (const listener of this.onChange) listener(channel.guild.id);
      return session;
    })();
    this.pending.set(channel.guild.id, operation);
    try {
      return await operation;
    } catch (error) {
      this.logger.warn({ err: error, guildId: channel.guild.id }, 'VC への接続に失敗しました');
      throw error;
    } finally {
      if (this.pending.get(channel.guild.id) === operation) this.pending.delete(channel.guild.id);
    }
  }

  leave(guildId: string): boolean {
    const session = this.get(guildId);
    session?.destroy();
    return !!session;
  }

  destroyAll(): void {
    this.generation++;
    for (const listener of this.onShutdown) listener();
    for (const session of this.sessions.values()) session.destroy();
  }
}
