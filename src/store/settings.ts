import type { DatabaseSync } from 'node:sqlite';
import { normalizeSurface, type DictionaryEntry } from '../tts/dictionary.js';

export interface UserVoice {
  styleId: number | null;
  speed: number;
  pitch: number;
}
export interface GuildSettings {
  autojoin: boolean;
  excludedVoiceChannels: string[];
  defaultStyleId: number | null;
  lastTextChannelId: string | null;
  fixedTextChannelId?: string | null;
  readMaxLength?: number | null;
  skipPrefix?: string | null;
  announceJoin?: boolean;
  readName?: 'off' | 'on_change';
  dictPermission?: 'everyone' | 'admin';
}
export interface SettingsStore {
  setGuildOption(guildId: string, key: GuildOption, value: string | number | null): void;
  dictionary(guildId: string): DictionaryEntry[];
  putDictionary(guildId: string, surface: string, reading: string, userId: string): boolean;
  removeDictionary(guildId: string, surface: string): boolean;
  enableSpeaker(guildId: string | null, uuid: string, installedBy: string): void;
  disableSpeaker(guildId: string | null, uuid: string): void;
  speakerInstalls(guildId: string): SpeakerInstall[];
  countStyleUsers(guildId: string, styleIds: number[]): number;
  setAutojoin(guildId: string, enabled: boolean): void;
  setVoiceChannelExcluded(guildId: string, channelId: string, excluded: boolean): void;
  guild(guildId: string): GuildSettings | undefined;
  setDefaultStyle(guildId: string, styleId: number | null): void;
  setLastTextChannel(guildId: string, channelId: string): void;
  user(guildId: string, userId: string): UserVoice | undefined;
  setUser(guildId: string, userId: string, voice: UserVoice): void;
  resetUser(guildId: string, userId: string): void;
  enabledSpeakers(guildId: string): string[];
}
export type GuildOption =
  | 'fixed_text_channel_id'
  | 'read_max_length'
  | 'skip_prefix'
  | 'announce_join'
  | 'read_name'
  | 'dict_permission';

export interface SpeakerInstall {
  speakerUuid: string;
  installedBy: string;
  installedAt: string;
}

export class SqliteSettings implements SettingsStore {
  private readonly dictionaryCache = new Map<string, DictionaryEntry[]>();
  constructor(private readonly db: DatabaseSync) {}

  setGuildOption(guildId: string, key: GuildOption, value: string | number | null): void {
    this.db
      .prepare(
        `INSERT INTO guild_settings(guild_id, ${key}) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET ${key} = excluded.${key}`,
      )
      .run(guildId, value);
  }
  dictionary(guildId: string): DictionaryEntry[] {
    let entries = this.dictionaryCache.get(guildId);
    if (!entries) {
      entries = this.db
        .prepare('SELECT surface, reading FROM dictionary WHERE guild_id = ? ORDER BY surface')
        .all(guildId) as unknown as DictionaryEntry[];
      this.dictionaryCache.set(guildId, entries);
    }
    return entries;
  }
  putDictionary(guildId: string, surface: string, reading: string, userId: string): boolean {
    surface = normalizeSurface(surface);
    if (
      !surface.trim() ||
      Array.from(surface).length > 50 ||
      !reading.length ||
      Array.from(reading).length > 100
    )
      throw new Error('辞書の表記は1〜50文字、読みは1〜100文字で指定してください');
    const entries = this.dictionary(guildId);
    const exists = entries.some((entry) => entry.surface === surface);
    if (!exists && entries.length >= 500) throw new Error('辞書は500件まで登録できます');
    this.db
      .prepare(
        'INSERT INTO dictionary(guild_id, surface, reading, created_by) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, surface) DO UPDATE SET reading = excluded.reading, created_by = excluded.created_by, created_at = CURRENT_TIMESTAMP',
      )
      .run(guildId, surface, reading, userId);
    this.dictionaryCache.delete(guildId);
    return exists;
  }
  removeDictionary(guildId: string, surface: string): boolean {
    const result = this.db
      .prepare('DELETE FROM dictionary WHERE guild_id = ? AND surface = ?')
      .run(guildId, normalizeSurface(surface));
    this.dictionaryCache.delete(guildId);
    return Number(result.changes) > 0;
  }

  countStyleUsers(guildId: string, styleIds: number[]): number {
    if (!styleIds.length) return 0;
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM user_voices WHERE guild_id = ? AND style_id IN (${styleIds.map(() => '?').join(',')})`,
      )
      .get(guildId, ...styleIds)!.count as number;
  }

  speakerInstalls(guildId: string): SpeakerInstall[] {
    return this.db
      .prepare(
        'SELECT speaker_uuid AS speakerUuid, installed_by AS installedBy, installed_at AS installedAt FROM enabled_speakers WHERE guild_id = ? ORDER BY installed_at, speaker_uuid',
      )
      .all(guildId) as unknown as SpeakerInstall[];
  }

  guild(guildId: string): GuildSettings | undefined {
    const row = this.db
      .prepare(
        'SELECT *, default_style_id AS defaultStyleId, last_text_channel_id AS lastTextChannelId, excluded_voice_channels AS excludedVoiceChannels FROM guild_settings WHERE guild_id = ?',
      )
      .get(guildId);
    if (!row) return undefined;
    return {
      defaultStyleId: row.defaultStyleId as number | null,
      lastTextChannelId: row.lastTextChannelId as string | null,
      autojoin: row.autojoin === 1,
      excludedVoiceChannels: JSON.parse(row.excludedVoiceChannels as string) as string[],
      fixedTextChannelId: row.fixed_text_channel_id as string | null,
      readMaxLength: row.read_max_length as number | null,
      skipPrefix: row.skip_prefix as string | null,
      announceJoin: row.announce_join === 1,
      readName: row.read_name as GuildSettings['readName'],
      dictPermission: row.dict_permission as GuildSettings['dictPermission'],
    };
  }
  setAutojoin(guildId: string, enabled: boolean): void {
    this.db
      .prepare(
        'INSERT INTO guild_settings(guild_id, autojoin) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET autojoin = excluded.autojoin',
      )
      .run(guildId, Number(enabled));
  }
  setVoiceChannelExcluded(guildId: string, channelId: string, excluded: boolean): void {
    const ids = new Set(this.guild(guildId)?.excludedVoiceChannels ?? []);
    if (excluded) ids.add(channelId);
    else ids.delete(channelId);
    this.db
      .prepare(
        'INSERT INTO guild_settings(guild_id, excluded_voice_channels) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET excluded_voice_channels = excluded.excluded_voice_channels',
      )
      .run(guildId, JSON.stringify([...ids]));
  }
  setDefaultStyle(guildId: string, styleId: number | null): void {
    this.db
      .prepare(
        'INSERT INTO guild_settings(guild_id, default_style_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET default_style_id = excluded.default_style_id',
      )
      .run(guildId, styleId);
  }
  setLastTextChannel(guildId: string, channelId: string): void {
    this.db
      .prepare(
        'INSERT INTO guild_settings(guild_id, last_text_channel_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET last_text_channel_id = excluded.last_text_channel_id',
      )
      .run(guildId, channelId);
  }
  user(guildId: string, userId: string): UserVoice | undefined {
    return this.db
      .prepare(
        'SELECT style_id AS styleId, speed, pitch FROM user_voices WHERE guild_id = ? AND user_id = ?',
      )
      .get(guildId, userId) as unknown as UserVoice | undefined;
  }
  setUser(guildId: string, userId: string, voice: UserVoice): void {
    this.db
      .prepare(
        'INSERT INTO user_voices(guild_id, user_id, style_id, speed, pitch) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET style_id = excluded.style_id, speed = excluded.speed, pitch = excluded.pitch',
      )
      .run(guildId, userId, voice.styleId, voice.speed, voice.pitch);
  }
  resetUser(guildId: string, userId: string): void {
    this.db
      .prepare('DELETE FROM user_voices WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId);
  }
  enabledSpeakers(guildId: string): string[] {
    return this.db
      .prepare(
        'SELECT DISTINCT speaker_uuid FROM enabled_speakers WHERE guild_id = ? OR guild_id IS NULL',
      )
      .all(guildId)
      .map((row) => row.speaker_uuid as string);
  }
  enableSpeaker(guildId: string | null, uuid: string, installedBy: string): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO enabled_speakers(guild_id, speaker_uuid, installed_by) VALUES (?, ?, ?)',
      )
      .run(guildId, uuid, installedBy);
  }
  disableSpeaker(guildId: string | null, uuid: string): void {
    this.db
      .prepare('DELETE FROM enabled_speakers WHERE guild_id IS ? AND speaker_uuid = ?')
      .run(guildId, uuid);
  }
}
