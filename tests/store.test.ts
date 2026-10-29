import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { DatabaseSync } from 'node:sqlite';

const databases: ReturnType<typeof openDatabase>[] = [];
function memoryStore() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return { db, store: new SqliteSettings(db) };
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe('SQLite', () => {
  it('v1 DB を v2 に更新し既存設定を保持する', () => {
    const db = new DatabaseSync(':memory:');
    databases.push(db);
    db.exec(
      "CREATE TABLE guild_settings(guild_id TEXT PRIMARY KEY, default_style_id INTEGER, last_text_channel_id TEXT) STRICT; INSERT INTO guild_settings VALUES ('g', 8, 'text'); PRAGMA user_version = 1",
    );
    migrate(db);
    const store = new SqliteSettings(db);
    expect(store.guild('g')).toEqual({
      defaultStyleId: 8,
      lastTextChannelId: 'text',
      autojoin: true,
      excludedVoiceChannels: [],
    });
    store.setAutojoin('g', false);
    store.setVoiceChannelExcluded('g', 'vc', true);
    store.setVoiceChannelExcluded('g', 'vc', true);
    expect(store.guild('g')?.excludedVoiceChannels).toEqual(['vc']);
    store.setVoiceChannelExcluded('g', 'vc', false);
    expect(store.guild('g')).toMatchObject({
      autojoin: false,
      defaultStyleId: 8,
      excludedVoiceChannels: [],
    });
  });
  it('マイグレーションは再適用してもデータを保持する', () => {
    const { db, store } = memoryStore();
    store.setLastTextChannel('g', 'text');
    migrate(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect(store.guild('g')?.lastTextChannelId).toBe('text');
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  });
  it('ギルド・ユーザー設定を分離して更新・削除する', () => {
    const { store } = memoryStore();
    expect(store.guild('g')).toBeUndefined();
    store.setDefaultStyle('g', 3);
    store.setLastTextChannel('g', 'text');
    store.setDefaultStyle('g', 8);
    expect(store.guild('g')).toEqual({
      defaultStyleId: 8,
      lastTextChannelId: 'text',
      autojoin: true,
      excludedVoiceChannels: [],
    });
    store.setUser('g', 'u', { styleId: 3, speed: 1.2, pitch: -0.1 });
    store.setUser('g', 'u', { styleId: null, speed: 0.5, pitch: 0 });
    expect(store.user('g', 'u')).toEqual({ styleId: null, speed: 0.5, pitch: 0 });
    expect(store.user('other', 'u')).toBeUndefined();
    store.resetUser('g', 'u');
    expect(store.user('g', 'u')).toBeUndefined();
  });
  it('有効化は NULL のグローバル行も重複せず、スコープごとに削除できる', () => {
    const { db, store } = memoryStore();
    store.enableSpeaker(null, 'global', 'admin');
    store.enableSpeaker(null, 'global', 'admin');
    store.enableSpeaker('g', 'local', 'admin');
    expect(store.enabledSpeakers('g').sort()).toEqual(['global', 'local']);
    expect(store.enabledSpeakers('other')).toEqual(['global']);
    expect(
      db.prepare('SELECT installed_at, installed_by FROM enabled_speakers').get(),
    ).toMatchObject({ installed_at: expect.any(String), installed_by: 'admin' });
    store.disableSpeaker(null, 'global');
    store.disableSpeaker('g', 'local');
    expect(store.enabledSpeakers('g')).toEqual([]);
  });
  it('未来版 DB を拒否して既存データを残す', () => {
    const { db, store } = memoryStore();
    store.setDefaultStyle('g', 3);
    db.exec('PRAGMA user_version = 99');
    expect(() => migrate(db)).toThrow('バージョン');
    expect(store.guild('g')?.defaultStyleId).toBe(3);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(99);
  });
});
