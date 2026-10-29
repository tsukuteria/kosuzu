import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config.js';

describe('validateConfig', () => {
  it('退出猶予の既定・0・上限と不正値を検証する', () => {
    const env = { DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'id' };
    for (const value of ['0', '500', '2147483647'])
      expect(validateConfig({ ...env, AUTO_LEAVE_GRACE_MS: value }).autoLeaveGraceMs).toBe(
        Number(value),
      );
    for (const value of ['-1', '0.5', 'NaN', 'Infinity', '2147483648'])
      expect(() => validateConfig({ ...env, AUTO_LEAVE_GRACE_MS: value })).toThrow(
        'AUTO_LEAVE_GRACE_MS',
      );
  });
  it('不足する必須項目を列挙する', () => {
    expect(() => validateConfig({ DISCORD_TOKEN: ' ' })).toThrow(
      /DISCORD_TOKEN, DISCORD_CLIENT_ID/,
    );
  });
  it('既定値を適用し設定を凍結する', () => {
    const config = validateConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'id',
      LOG_LEVEL: '',
      VOICEVOX_URL: '',
    });
    expect(config).toEqual({
      databasePath: 'data/kosuzu.db',
      autoLeaveGraceMs: 10000,
      discordToken: 'token',
      discordClientId: 'id',
      discordDevGuildId: undefined,
      logLevel: 'info',
      voicevoxUrl: 'http://127.0.0.1:50021',
      voicevoxTimeoutMs: 15_000,
      defaultStyleId: 3,
      readMaxLength: 100,
      maxQueueLength: 20,
      readSkipPrefix: ';',
    });
    expect(Object.isFrozen(config)).toBe(true);
  });
  it.each(['DEFAULT_STYLE_ID', 'READ_MAX_LENGTH', 'MAX_QUEUE_LENGTH'])(
    '不正な %s を拒否する',
    (key) => {
      for (const value of ['-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
        expect(() =>
          validateConfig({ DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'id', [key]: value }),
        ).toThrow(key);
      }
    },
  );
  it('読み上げ設定を読み込み、話者 0 と空の除外接頭辞を許す', () => {
    expect(
      validateConfig({
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'id',
        DEFAULT_STYLE_ID: '0',
        READ_MAX_LENGTH: '40',
        MAX_QUEUE_LENGTH: '2',
        READ_SKIP_PREFIX: '',
      }),
    ).toMatchObject({
      defaultStyleId: 0,
      readMaxLength: 40,
      maxQueueLength: 2,
      readSkipPrefix: '',
    });
    for (const key of ['READ_MAX_LENGTH', 'MAX_QUEUE_LENGTH'])
      expect(() =>
        validateConfig({ DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'id', [key]: '0' }),
      ).toThrow(key);
  });
  it('任意項目を読み込む', () => {
    const config = validateConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'id',
      DISCORD_DEV_GUILD_ID: 'guild',
      LOG_LEVEL: 'debug',
      VOICEVOX_URL: 'http://localhost:50021',
      VOICEVOX_TIMEOUT_MS: ' 20000 ',
      DATABASE_PATH: ' custom/voice.db ',
    });
    expect(config).toMatchObject({
      discordDevGuildId: 'guild',
      logLevel: 'debug',
      voicevoxUrl: 'http://localhost:50021',
      voicevoxTimeoutMs: 20_000,
      databasePath: 'custom/voice.db',
    });
  });
  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '2147483648'])(
    '不正なタイムアウト %s を拒否する',
    (value) => {
      expect(() =>
        validateConfig({
          DISCORD_TOKEN: 'token',
          DISCORD_CLIENT_ID: 'id',
          VOICEVOX_TIMEOUT_MS: value,
        }),
      ).toThrow(/VOICEVOX_TIMEOUT_MS/);
    },
  );
});
