import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config.js';

describe('validateConfig', () => {
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
      discordToken: 'token',
      discordClientId: 'id',
      discordDevGuildId: undefined,
      logLevel: 'info',
      voicevoxUrl: 'http://127.0.0.1:50021',
    });
    expect(Object.isFrozen(config)).toBe(true);
  });
  it('任意項目を読み込む', () => {
    const config = validateConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'id',
      DISCORD_DEV_GUILD_ID: 'guild',
      LOG_LEVEL: 'debug',
      VOICEVOX_URL: 'http://localhost:50021',
    });
    expect(config).toMatchObject({
      discordDevGuildId: 'guild',
      logLevel: 'debug',
      voicevoxUrl: 'http://localhost:50021',
    });
  });
});
