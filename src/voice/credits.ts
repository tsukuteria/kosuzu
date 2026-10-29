import { PermissionFlagsBits, type GuildBasedChannel, type VoiceBasedChannel } from 'discord.js';
import type { Logger } from 'pino';
import type { SpeakerCatalog } from '../tts/speakers.js';
import type { SpeakerStyle } from '../tts/voicevox.js';
import type { ResolvedVoice } from './resolver.js';

export type Character = Pick<SpeakerStyle, 'speakerUuid' | 'speakerName'>;
export type CreditSender = (content: string) => Promise<unknown>;
export interface CreditOptions {
  catalog: Pick<SpeakerCatalog, 'list' | 'find'>;
  resolveVoice(guildId: string, userId: string): Promise<ResolvedVoice>;
}

// 解決済み音声の順（VC メンバーの列挙順）を保ち、スタイルではなく UUID でまとめる。
export function collectCharacters(
  voices: readonly Pick<ResolvedVoice, 'styleId'>[],
  styles: readonly SpeakerStyle[],
): Character[] {
  const characters = new Map<string, Character>();
  for (const voice of voices) {
    const style = styles.find((s) => s.styleId === voice.styleId);
    if (style && !characters.has(style.speakerUuid)) characters.set(style.speakerUuid, style);
  }
  return [...characters.values()];
}

export const creditLabel = (character: Character): string => `VOICEVOX:${character.speakerName}`;
export const formatCharacters = (characters: readonly Character[]): string =>
  `現在設定されているキャラクター：${characters.map(creditLabel).join('、') || 'なし'}`;

export class SessionCredits {
  readonly credited = new Set<string>();
  announceChannelId?: string;
  characters: Character[] = [];
  private sender?: CreditSender;
  private readonly styles = new Map<number, SpeakerStyle>();
  private readonly pending = new Map<number, Promise<void>>();
  private readonly waiting = new Map<string, Character>();
  private collectionFailed = false;

  constructor(
    private readonly find: (styleId: number) => Promise<SpeakerStyle | undefined>,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  setDestination(channelId: string, sender: CreditSender): void {
    this.announceChannelId = channelId;
    this.sender = sender;
  }

  announceCurrent(prefix: string): Promise<void> {
    return this.sender && this.announceChannelId
      ? this.announce(this.announceChannelId, this.sender, prefix)
      : Promise.resolve();
  }

  async prepare(channel: VoiceBasedChannel, options: CreditOptions): Promise<void> {
    this.characters = [];
    this.collectionFailed = false;
    try {
      const styles = await options.catalog.list(channel.guild.id);
      for (const style of styles) this.styles.set(style.styleId, style);
      const voices = await Promise.all(
        [...channel.members.values()]
          .filter((member) => !member.user.bot)
          .map((member) => options.resolveVoice(channel.guild.id, member.id)),
      );
      this.characters = collectCharacters(voices, styles);
    } catch (error) {
      this.collectionFailed = true;
      this.logger.warn({ err: error }, '接続時のキャラクター一覧を取得できませんでした');
    }
  }

  async announce(
    channelId: string,
    sender: CreditSender,
    prefix: string,
    connectSender: CreditSender = sender,
  ): Promise<void> {
    this.setDestination(channelId, sender);
    const added = this.characters.filter((c) => !this.credited.has(c.speakerUuid));
    for (const character of added) this.credited.add(character.speakerUuid);
    // 予約は同期的に行い、送信待ち中の発話でも二重投稿しない。
    try {
      const line = this.collectionFailed
        ? '現在設定されているキャラクター：取得できませんでした'
        : formatCharacters(this.characters);
      const sent = connectSender(`${prefix}\n${line}`);
      for (const character of this.waiting.values()) this.add(character);
      this.waiting.clear();
      await sent;
    } catch (error) {
      for (const character of added) this.credited.delete(character.speakerUuid);
      this.logger.warn({ err: error, channelId }, '接続時のクレジット送信に失敗しました');
    }
  }

  use(voice: Pick<ResolvedVoice, 'styleId' | 'character'>): Promise<void> | undefined {
    const character = voice.character ?? this.styles.get(voice.styleId);
    if (character) {
      this.add(character);
      return undefined;
    }
    const existing = this.pending.get(voice.styleId);
    if (existing) return existing;
    // 通常は resolver の情報または接続時のカタログで同期判定できる。
    // 未知の styleId だけの発話は順序を予約し、補完後に合成を開始する。
    const task = Promise.resolve()
      .then(() => this.find(voice.styleId))
      .then((style) => {
        if (!style) throw new Error(`話者が見つかりません: ${voice.styleId}`);
        this.styles.set(style.styleId, style);
        this.add(style);
      })
      .catch((error: unknown) =>
        this.logger.warn({ err: error }, '発話のクレジット取得に失敗しました'),
      )
      .finally(() => this.pending.delete(voice.styleId));
    this.pending.set(voice.styleId, task);
    return task;
  }

  private add(character: Character): void {
    if (this.credited.has(character.speakerUuid)) return;
    if (!this.sender) {
      this.waiting.set(character.speakerUuid, character);
      return;
    }
    this.credited.add(character.speakerUuid);
    try {
      void this.sender(`${creditLabel(character)} を追加で使用します`).catch((error: unknown) => {
        this.credited.delete(character.speakerUuid);
        this.logger.warn({ err: error }, '追加クレジットの送信に失敗しました');
      });
    } catch (error) {
      this.credited.delete(character.speakerUuid);
      this.logger.warn({ err: error }, '追加クレジットの送信に失敗しました');
    }
  }
}

export async function prepareAutoCredits(
  channel: VoiceBasedChannel,
  session: { credits?: SessionCredits; readsChannel(id: string): boolean },
  lastTextChannelId: string | null | undefined,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  const me = channel.guild.members.me;
  const destination = (target: GuildBasedChannel | null) => {
    if (
      target?.isSendable() &&
      me &&
      target
        .permissionsFor(me)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    )
      return { id: target.id, send: (content: string) => target.send(content) };
    return undefined;
  };
  let target = destination(channel);
  if (!target && lastTextChannelId && session.readsChannel(lastTextChannelId)) {
    const last = await channel.guild.channels.fetch(lastTextChannelId).catch(() => null);
    target = destination(last);
  }
  if (target) {
    session.credits?.setDestination(target.id, target.send);
  } else {
    logger.warn({ guildId: channel.guild.id }, 'クレジットを送信できるチャンネルがありません');
  }
}
