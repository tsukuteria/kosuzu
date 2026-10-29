import type { Client } from 'discord.js';
import type { Logger } from 'pino';

export function handleReady(client: Client<true>, logger: Logger): void {
  logger.info(
    { tag: client.user.tag, guildCount: client.guilds.cache.size },
    'Discord に接続しました',
  );
}
