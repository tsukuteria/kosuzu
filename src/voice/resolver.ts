import type { Logger } from 'pino';
import type { SettingsStore } from '../store/settings.js';
import type { SpeakerCatalog } from '../tts/speakers.js';
import type { Character } from './credits.js';

export interface ResolvedVoice {
  styleId: number;
  speedScale: number;
  pitchScale: number;
  character?: Character;
}

export function createVoiceResolver(
  store: Pick<SettingsStore, 'user' | 'guild'>,
  catalog: Pick<SpeakerCatalog, 'list'>,
  defaultStyleId: number,
  logger: Pick<Logger, 'debug'>,
) {
  return async (guildId: string, userId: string): Promise<ResolvedVoice> => {
    const user = store.user(guildId, userId);
    const styles = await catalog.list(guildId);
    for (const styleId of [user?.styleId, store.guild(guildId)?.defaultStyleId, defaultStyleId]) {
      if (styleId == null) continue;
      const style = styles.find((style) => style.styleId === styleId);
      if (style)
        return {
          styleId,
          speedScale: user?.speed ?? 1,
          pitchScale: user?.pitch ?? 0,
          character: { speakerUuid: style.speakerUuid, speakerName: style.speakerName },
        };
      logger.debug({ guildId, userId, styleId }, '利用できない話者のためフォールバックします');
    }
    throw new Error('利用可能な既定話者がありません');
  };
}
