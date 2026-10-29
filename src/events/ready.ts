import type { Client } from 'discord.js';
import type { Logger } from 'pino';
import type { TtsEngine } from '../tts/voicevox.js';

export async function checkVoicevoxHealth(
  engine: Pick<TtsEngine, 'version'>,
  logger: Logger,
): Promise<void> {
  try {
    logger.info({ version: await engine.version() }, 'VOICEVOX ENGINE に接続しました');
  } catch (error) {
    logger.warn({ err: error }, 'VOICEVOX ENGINE に接続できません。Bot は稼働を続けます');
  }
}

export function handleReady(client: Client<true>, logger: Logger): void {
  logger.info(
    { tag: client.user.tag, guildCount: client.guilds.cache.size },
    'Discord に接続しました',
  );
}
