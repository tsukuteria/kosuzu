import type { DatabaseSync } from 'node:sqlite';

export interface UserVoice {
  styleId: number | null;
  speed: number;
  pitch: number;
}
export interface GuildSettings {
  defaultStyleId: number | null;
  lastTextChannelId: string | null;
}
export interface SettingsStore {
  guild(guildId: string): GuildSettings | undefined;
  setDefaultStyle(guildId: string, styleId: number | null): void;
  setLastTextChannel(guildId: string, channelId: string): void;
  user(guildId: string, userId: string): UserVoice | undefined;
  setUser(guildId: string, userId: string, voice: UserVoice): void;
  resetUser(guildId: string, userId: string): void;
  enabledSpeakers(guildId: string): string[];
}

export class SqliteSettings implements SettingsStore {
  constructor(private readonly db: DatabaseSync) {}

  guild(guildId: string): GuildSettings | undefined {
    return this.db
      .prepare(
        'SELECT default_style_id AS defaultStyleId, last_text_channel_id AS lastTextChannelId FROM guild_settings WHERE guild_id = ?',
      )
      .get(guildId) as unknown as GuildSettings | undefined;
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
