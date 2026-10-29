import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { voicevoxConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { VoicevoxClient } from '../src/tts/voicevox.js';

if (existsSync('.env')) loadEnvFile('.env');
const logger = createLogger(process.env.LOG_LEVEL?.trim() || 'info');
try {
  const styleId = Number(process.argv[2] ?? 3);
  if (!Number.isInteger(styleId) || styleId < 0)
    throw new Error('スタイル ID は 0 以上の整数で指定してください');
  const config = voicevoxConfig(process.env);
  const engine = new VoicevoxClient({
    baseUrl: config.voicevoxUrl,
    timeoutMs: config.voicevoxTimeoutMs,
    logger,
  });
  logger.info({ version: await engine.version() }, 'VOICEVOX ENGINE のバージョン');
  logger.info({ speakers: (await engine.speakers()).slice(0, 5) }, '利用可能な話者（一部）');
  const style = await engine.findStyle(styleId);
  if (!style) throw new Error(`スタイル ID ${styleId} が見つかりません`);
  const wav = await engine.synthesize('こんにちは、読み上げのテストです。', styleId);
  await mkdir('data', { recursive: true });
  await writeFile('data/smoke.wav', wav);
  logger.info(
    { path: 'data/smoke.wav', styleId, credit: `VOICEVOX:${style.speakerName}` },
    '音声を保存しました',
  );
} catch (error) {
  logger.error({ err: error }, 'VOICEVOX の動作確認に失敗しました');
  process.exitCode = 1;
}
