import { Client, Events, GatewayIntentBits } from 'discord.js';
import { commands } from './commands/index.js';
import type { CommandContext } from './commands/types.js';
import { loadConfig } from './config.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleMessage } from './events/messageCreate.js';
import { checkVoicevoxHealth, handleReady } from './events/ready.js';
import { createLogger } from './logger.js';
import { openDatabase } from './store/database.js';
import { SqliteSettings } from './store/settings.js';
import { SpeakerCatalog } from './tts/speakers.js';
import { VoicevoxClient, type TtsEngine } from './tts/voicevox.js';
import { VoiceSessionManager } from './voice/manager.js';
import { createVoiceResolver } from './voice/resolver.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const ttsEngine: TtsEngine = new VoicevoxClient({
  baseUrl: config.voicevoxUrl,
  timeoutMs: config.voicevoxTimeoutMs,
  logger,
});
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const db = openDatabase(config.databasePath);
const store = new SqliteSettings(db);
const catalog = new SpeakerCatalog(ttsEngine, store);
const sessions = new VoiceSessionManager(ttsEngine, logger, config.maxQueueLength, store);
const context: CommandContext = {
  sessions,
  store,
  catalog,
  resolveVoice: createVoiceResolver(store, catalog, config.defaultStyleId, logger),
};
client.on(Events.MessageCreate, (message) => handleMessage(message, context, config, logger));

client.once(Events.ClientReady, (readyClient) => {
  void checkVoicevoxHealth(ttsEngine, logger);
  try {
    handleReady(readyClient, logger);
  } catch (error) {
    logger.error({ err: error }, '起動イベントの処理に失敗しました');
  }
});
client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction, commands, logger, context);
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
    sessions.destroyAll();
    db.close();
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
  db.close();
  process.exit(1);
});
