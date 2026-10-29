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
import type { VoiceBasedChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { TtsEngine } from '../tts/voicevox.js';
import { wavToPcm } from '../tts/wav.js';
import { GuildVoiceSession } from './session.js';

export const JOIN_ANNOUNCEMENT = '接続しました';

export class VoiceSessionManager {
  private readonly sessions = new Map<string, GuildVoiceSession>();
  private readonly pending = new Map<string, Promise<GuildVoiceSession>>();
  private generation = 0;

  constructor(
    private readonly engine: Pick<TtsEngine, 'synthesize'>,
    private readonly logger: Logger,
    private readonly maxQueueLength: number,
  ) {}

  get(guildId: string): GuildVoiceSession | undefined {
    return this.sessions.get(guildId);
  }

  async join(channel: VoiceBasedChannel, textChannelId: string): Promise<GuildVoiceSession> {
    const prior = this.pending.get(channel.guild.id);
    const generation = this.generation;
    const operation = (async () => {
      if (prior) await prior.catch(() => {});
      if (generation !== this.generation) throw new Error('終了処理中です');
      const existing = this.get(channel.guild.id);
      if (existing?.channelId === channel.id) {
        existing.textChannelId = textChannelId;
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
        textChannelId,
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
        async ({ text, styleId }) =>
          wavToPcm(
            await this.engine.synthesize(text, styleId, {
              outputSamplingRate: 48000,
              outputStereo: true,
            }),
          ),
        this.maxQueueLength,
        this.logger,
        () => {
          if (this.get(channel.guild.id) === session) this.sessions.delete(channel.guild.id);
        },
      );
      this.sessions.set(channel.guild.id, session);
      connection.subscribe(player);
      connection.on('error', (error) =>
        this.logger.warn({ err: error }, '音声接続でエラーが発生しました'),
      );
      connection.on(VoiceConnectionStatus.Destroyed, () => session.destroy());
      connection.on(VoiceConnectionStatus.Disconnected, () => {
        void Promise.any([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ])
          .then(() => entersState(connection, VoiceConnectionStatus.Ready, 15000))
          .catch((error: unknown) => {
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
    for (const session of this.sessions.values()) session.destroy();
  }
}
