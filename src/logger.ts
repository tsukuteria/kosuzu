import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    ...(process.env.NODE_ENV !== 'production' && process.stdout.isTTY
      ? { transport: { target: 'pino-pretty' } }
      : {}),
  });
}
