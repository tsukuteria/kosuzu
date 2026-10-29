import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { checkVoicevoxHealth } from '../src/events/ready.js';
import { VoicevoxClient } from '../src/tts/voicevox.js';

describe('checkVoicevoxHealth', () => {
  it.each([true, false])('ENGINE の状態を記録し、失敗を伝播させない (%s)', async (available) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    if (available) fetch.mockResolvedValue(Response.json('0.26.0'));
    else fetch.mockRejectedValue(new TypeError('fetch failed'));
    const engine = new VoicevoxClient({ baseUrl: 'http://localhost:50021', fetch });
    const logger = { info: vi.fn(), warn: vi.fn() };
    await expect(checkVoicevoxHealth(engine, logger as unknown as Logger)).resolves.toBeUndefined();
    if (available) {
      expect(logger.info).toHaveBeenCalledWith({ version: '0.26.0' }, expect.any(String));
      expect(logger.warn).not.toHaveBeenCalled();
    } else {
      expect(logger.warn).toHaveBeenCalledWith(
        { err: expect.objectContaining({ kind: 'unavailable' }) },
        expect.any(String),
      );
      expect(logger.info).not.toHaveBeenCalled();
    }
    expect(fetch).toHaveBeenCalledTimes(available ? 1 : 3);
  });
});
