import { Client, Events, GatewayIntentBits } from 'discord.js';
import { commands } from './commands/index.js';
import type { CommandContext } from './commands/types.js';
import { loadConfig } from './config.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleMessage } from './events/messageCreate.js';
import { checkVoicevoxHealth, handleReady } from './events/ready.js';
import { createLogger } from './logger.js';
import { RuntimeLifecycle } from './lifecycle.js';
import { openDatabase } from './store/database.js';
import { SqliteSettings } from './store/settings.js';
import { SpeakerCatalog } from './tts/speakers.js';
import { VoicevoxClient, type TtsEngine } from './tts/voicevox.js';
import { VoiceSessionManager } from './voice/manager.js';
import { createVoiceResolver } from './voice/resolver.js';
import { AutoJoin } from './voice/autoJoin.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const lifecycle = new RuntimeLifecycle();
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
const resolveVoice = createVoiceResolver(store, catalog, config.defaultStyleId, logger);
const sessions = new VoiceSessionManager(ttsEngine, logger, config.maxQueueLength, store, {
  catalog,
  resolveVoice,
});
const context: CommandContext = {
  lifecycle,
  readDefaults: config,
  engine: ttsEngine,
  logger,
  sessions,
  store,
  catalog,
  resolveVoice,
};
client.on(Events.MessageCreate, (message) => {
  void lifecycle.run(() => handleMessage(message, context, config, logger));
});
const resolveAnnouncement = createVoiceResolver(
  { user: () => undefined, guild: (id) => store.guild(id) },
  catalog,
  config.defaultStyleId,
  logger,
);
const autoJoin = new AutoJoin(
  sessions,
  store,
  (guildId) => resolveAnnouncement(guildId, ''),
  config.autoLeaveGraceMs,
  logger,
);
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  void lifecycle
    .run(() => autoJoin.update(oldState, newState))
    .catch((error: unknown) => logger.warn({ err: error }, '音声状態の処理に失敗しました'));
});

client.once(Events.ClientReady, (readyClient) => {
  void checkVoicevoxHealth(ttsEngine, logger);
  try {
    handleReady(readyClient, logger);
    void lifecycle.run(() => autoJoin.scan(readyClient.guilds.cache.values()));
  } catch (error) {
    logger.error({ err: error }, '起動イベントの処理に失敗しました');
  }
});
client.on(Events.InteractionCreate, (interaction) => {
  void lifecycle.run(() => handleInteraction(interaction, commands, logger, context));
});
process.on('unhandledRejection', (error) => logger.error({ err: error }, '未処理の Promise 拒否'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, '未捕捉例外');
  process.exitCode = 1;
  logger.flush(() => process.exit(1));
});
let shuttingDown = false;
function shutdown(exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // Compose の 15 秒より前に終了する。通信や collector が止まらない場合も上限を設ける。
  const deadline = setTimeout(() => {
    logger.error('終了処理が制限時間を超えました');
    logger.flush(() => process.exit(1));
  }, 10_000);
  // ログの flush 自体が停止しても Docker の SIGKILL より先に終了する。
  setTimeout(() => process.exit(1), 12_000).unref();
  void lifecycle
    .stop({
      stopSessions: () => sessions.destroyAll(),
      drainAutoJoin: () => autoJoin.drain(),
      destroyClient: () => client.destroy(),
      closeDatabase: () => db.close(),
    })
    .then(
      () => {
        clearTimeout(deadline);
        logger.info('終了処理が完了しました');
        logger.flush(() => process.exit(exitCode));
      },
      (error: unknown) => {
        clearTimeout(deadline);
        logger.error({ err: error }, '終了処理に失敗しました');
        logger.flush(() => process.exit(1));
      },
    );
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, '終了します');
    shutdown(0);
  });
}
client.login(config.discordToken).catch((error: unknown) => {
  logger.fatal({ err: error }, 'Discord へのログインに失敗しました');
  shutdown(1);
});
