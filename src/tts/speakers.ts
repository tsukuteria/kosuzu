import type { SettingsStore } from '../store/settings.js';
import type { SpeakerStyle, TtsEngine } from './voicevox.js';

export const MAIN_SPEAKER_UUIDS = [
  '7ffcb7ce-00ec-4bdc-82cd-45a8889e43ff',
  '388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',
  '35b2c544-660e-401e-b503-0e14c635303a',
  '3474ee95-c274-47f9-aa1a-8322163d96f1',
  'b1a81618-b27b-40d2-b0ea-27a9ad408c4b',
  'c30dc15a-0992-4f8d-8bb8-ad3b314e6a6f',
  'e5020595-5c5d-4e87-b849-270a518d0dcf',
  '4f51116a-d9ee-4516-925d-21f183e2afad',
  '8eaad775-3119-417e-8cf4-2a10bfd592c8',
  '481fb609-6446-4870-9f46-90c4dd623403',
] as const;

export const styleLabel = (style: SpeakerStyle): string =>
  `${style.speakerName}（${style.styleName}）`;

export class SpeakerCatalog {
  constructor(
    private readonly engine: Pick<TtsEngine, 'styles'>,
    private readonly store: Pick<SettingsStore, 'enabledSpeakers'>,
  ) {}

  async list(guildId: string): Promise<SpeakerStyle[]> {
    const enabled = new Set<string>([
      ...MAIN_SPEAKER_UUIDS,
      ...this.store.enabledSpeakers(guildId),
    ]);
    return (await this.engine.styles()).filter((style) => enabled.has(style.speakerUuid));
  }
  async find(guildId: string, styleId: number): Promise<SpeakerStyle | undefined> {
    return (await this.list(guildId)).find((style) => style.styleId === styleId);
  }
  async search(guildId: string, query: string): Promise<{ name: string; value: string }[]> {
    const text = query.trim().toLocaleLowerCase('ja');
    return (await this.list(guildId))
      .filter((style) => styleLabel(style).toLocaleLowerCase('ja').includes(text))
      .slice(0, 25)
      .map((style) => ({ name: styleLabel(style).slice(0, 100), value: String(style.styleId) }));
  }
}
