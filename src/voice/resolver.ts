import type { Logger } from 'pino';
import type { SettingsStore } from '../store/settings.js';
import type { SpeakerCatalog } from '../tts/speakers.js';

export interface ResolvedVoice {
  styleId: number;
  speedScale: number;
  pitchScale: number;
}

export function createVoiceResolver(
  store: SettingsStore,
  catalog: Pick<SpeakerCatalog, 'list'>,
  defaultStyleId: number,
  logger: Pick<Logger, 'debug'>,
) {
  return async (guildId: string, userId: string): Promise<ResolvedVoice> => {
    const user = store.user(guildId, userId);
    const styles = await catalog.list(guildId);
    for (const styleId of [user?.styleId, store.guild(guildId)?.defaultStyleId, defaultStyleId]) {
      if (styleId == null) continue;
      if (styles.some((style) => style.styleId === styleId))
        return { styleId, speedScale: user?.speed ?? 1, pitchScale: user?.pitch ?? 0 };
      logger.debug({ guildId, userId, styleId }, '利用できない話者のためフォールバックします');
    }
    throw new Error('利用可能な既定話者がありません');
  };
}
