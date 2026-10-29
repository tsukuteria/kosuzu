import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export interface Config {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly discordDevGuildId: string | undefined;
  readonly logLevel: string;
  readonly voicevoxUrl: string;
  readonly voicevoxTimeoutMs: number;
  readonly defaultStyleId: number;
  readonly readMaxLength: number;
  readonly maxQueueLength: number;
  readonly readSkipPrefix: string;
}

export function voicevoxConfig(env: NodeJS.ProcessEnv) {
  const timeoutMs = Number(env.VOICEVOX_TIMEOUT_MS?.trim() || 15_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('VOICEVOX_TIMEOUT_MS は 1〜2147483647 の整数で指定してください');
  }
  return {
    voicevoxUrl: env.VOICEVOX_URL?.trim() || 'http://127.0.0.1:50021',
    voicevoxTimeoutMs: timeoutMs,
  };
}

export function validateConfig(env: NodeJS.ProcessEnv): Readonly<Config> {
  const missing = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'].filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`必須の環境変数が未設定です: ${missing.join(', ')}`);
  return Object.freeze({
    discordToken: env.DISCORD_TOKEN!.trim(),
    discordClientId: env.DISCORD_CLIENT_ID!.trim(),
    discordDevGuildId: env.DISCORD_DEV_GUILD_ID?.trim() || undefined,
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    ...voicevoxConfig(env),
    defaultStyleId: integerConfig(env, 'DEFAULT_STYLE_ID', 3, 0),
    readMaxLength: integerConfig(env, 'READ_MAX_LENGTH', 100),
    maxQueueLength: integerConfig(env, 'MAX_QUEUE_LENGTH', 20),
    readSkipPrefix: env.READ_SKIP_PREFIX ?? ';',
  });
}

function integerConfig(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 1): number {
  const value = Number(env[key]?.trim() || fallback);
  if (!Number.isSafeInteger(value) || value < min)
    throw new Error(`${key} は ${min} 以上の整数で指定してください`);
  return value;
}

export function loadConfig(): Readonly<Config> {
  if (existsSync('.env')) loadEnvFile('.env');
  return validateConfig(process.env);
}
