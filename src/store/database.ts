import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const migrations = [
  `CREATE TABLE guild_settings (
    guild_id TEXT PRIMARY KEY, default_style_id INTEGER, last_text_channel_id TEXT
  ) STRICT;
  CREATE TABLE user_voices (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, style_id INTEGER,
    speed REAL NOT NULL DEFAULT 1 CHECK(speed BETWEEN 0.5 AND 2),
    pitch REAL NOT NULL DEFAULT 0 CHECK(pitch BETWEEN -0.15 AND 0.15),
    PRIMARY KEY(guild_id, user_id)
  ) STRICT;
  CREATE TABLE enabled_speakers (
    guild_id TEXT, speaker_uuid TEXT NOT NULL,
    installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, installed_by TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX enabled_guild ON enabled_speakers(guild_id, speaker_uuid) WHERE guild_id IS NOT NULL;
  CREATE UNIQUE INDEX enabled_global ON enabled_speakers(speaker_uuid) WHERE guild_id IS NULL;`,
  `ALTER TABLE guild_settings ADD COLUMN autojoin INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE guild_settings ADD COLUMN excluded_voice_channels TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE guild_settings ADD COLUMN fixed_text_channel_id TEXT;
  ALTER TABLE guild_settings ADD COLUMN read_max_length INTEGER;
  ALTER TABLE guild_settings ADD COLUMN skip_prefix TEXT;
  ALTER TABLE guild_settings ADD COLUMN announce_join INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE guild_settings ADD COLUMN read_name TEXT NOT NULL DEFAULT 'off' CHECK(read_name IN ('off', 'on_change'));
  ALTER TABLE guild_settings ADD COLUMN dict_permission TEXT NOT NULL DEFAULT 'everyone' CHECK(dict_permission IN ('everyone', 'admin'));
  CREATE TABLE dictionary (
    guild_id TEXT NOT NULL, surface TEXT NOT NULL, reading TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(guild_id, surface)
  ) STRICT;`,
];

export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('PRAGMA user_version').get()!.user_version as number;
    if (version > migrations.length) throw new Error('DB のバージョンが新しすぎます');
    for (let i = version; i < migrations.length; i++) {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
