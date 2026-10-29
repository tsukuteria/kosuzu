import { REST, Routes } from 'discord.js';
import { commands } from '../src/commands/index.js';
import { toCommandBodies } from '../src/commands/serialize.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const rest = new REST().setToken(config.discordToken);
const route = config.discordDevGuildId
  ? Routes.applicationGuildCommands(config.discordClientId, config.discordDevGuildId)
  : Routes.applicationCommands(config.discordClientId);
try {
  await rest.put(route, { body: toCommandBodies(commands) });
  logger.info(
    { count: commands.length, guildId: config.discordDevGuildId },
    'コマンドを登録しました',
  );
} catch (error) {
  logger.error({ err: error }, 'コマンドの登録に失敗しました');
  process.exitCode = 1;
}
