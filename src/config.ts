import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export interface Config {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly discordDevGuildId: string | undefined;
  readonly logLevel: string;
  readonly voicevoxUrl: string;
}

export function validateConfig(env: NodeJS.ProcessEnv): Readonly<Config> {
  const missing = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'].filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`必須の環境変数が未設定です: ${missing.join(', ')}`);
  return Object.freeze({
    discordToken: env.DISCORD_TOKEN!.trim(),
    discordClientId: env.DISCORD_CLIENT_ID!.trim(),
    discordDevGuildId: env.DISCORD_DEV_GUILD_ID?.trim() || undefined,
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    voicevoxUrl: env.VOICEVOX_URL?.trim() || 'http://127.0.0.1:50021',
  });
}

export function loadConfig(): Readonly<Config> {
  if (existsSync('.env')) loadEnvFile('.env');
  return validateConfig(process.env);
}
