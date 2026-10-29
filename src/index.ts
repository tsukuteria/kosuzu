import { Client, Events, GatewayIntentBits } from 'discord.js';
import { commands } from './commands/index.js';
import { loadConfig } from './config.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleReady } from './events/ready.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  try {
    handleReady(readyClient, logger);
  } catch (error) {
    logger.error({ err: error }, '起動イベントの処理に失敗しました');
  }
});
client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction, commands, logger);
});
process.on('unhandledRejection', (error) => logger.error({ err: error }, '未処理の Promise 拒否'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, '未捕捉例外');
  process.exitCode = 1;
  logger.flush(() => process.exit(1));
});
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    logger.info({ signal }, '終了します');
    void client.destroy().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, '終了処理に失敗しました');
        process.exit(1);
      },
    );
  });
}
client.login(config.discordToken).catch((error: unknown) => {
  logger.fatal({ err: error }, 'Discord へのログインに失敗しました');
  process.exit(1);
});
