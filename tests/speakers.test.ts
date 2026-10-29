import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';
import { MAIN_SPEAKER_UUIDS, SpeakerCatalog } from '../src/tts/speakers.js';
import { createVoiceResolver } from '../src/voice/resolver.js';

const db = openDatabase(':memory:');
const store = new SqliteSettings(db);
afterEach(() => {
  db.exec('DELETE FROM user_voices; DELETE FROM guild_settings; DELETE FROM enabled_speakers');
});
import { afterAll } from 'vitest';
afterAll(() => db.close());
const style = (styleId: number, speakerUuid: string = MAIN_SPEAKER_UUIDS[0]) => ({
  styleId,
  speakerUuid,
  speakerName: '四国めたん',
  styleName: `スタイル${styleId}`,
});
const engine = { styles: async () => [style(3), style(8), style(9, 'extra'), style(10, 'hidden')] };

describe('SpeakerCatalog / resolver', () => {
  it('ホワイトリストとギルド・グローバル有効化の積集合を返す', async () => {
    store.enableSpeaker('g', 'extra', 'admin');
    store.enableSpeaker(null, 'missing', 'admin');
    const catalog = new SpeakerCatalog(engine, store);
    expect((await catalog.list('g')).map((s) => s.styleId)).toEqual([3, 8, 9]);
    expect(await catalog.find('other', 9)).toBeUndefined();
    store.enableSpeaker(null, 'hidden', 'admin');
    expect(await catalog.find('other', 10)).toBeDefined();
  });
  it('名前・スタイル・ラベルで検索し、候補を25件に制限する', async () => {
    const catalog = new SpeakerCatalog(
      { styles: async () => Array.from({ length: 40 }, (_, i) => style(i)) },
      store,
    );
    expect(await catalog.search('g', '四国')).toHaveLength(25);
    expect(await catalog.search('g', 'スタイル39')).toEqual([
      { name: '四国めたん（スタイル39）', value: '39' },
    ]);
    expect(await catalog.search('g', '四国めたん（スタイル39）')).toHaveLength(1);
    expect(await catalog.search('g', '不明')).toEqual([]);
  });
  it('ユーザー→サーバー→設定の順に解決し、無効な保存話者を記録する', async () => {
    const logger = { debug: vi.fn() };
    const resolve = createVoiceResolver(store, new SpeakerCatalog(engine, store), 3, logger);
    expect(await resolve('g', 'u')).toEqual({
      styleId: 3,
      speedScale: 1,
      pitchScale: 0,
      character: { speakerUuid: MAIN_SPEAKER_UUIDS[0], speakerName: '四国めたん' },
    });
    store.setDefaultStyle('g', 8);
    expect((await resolve('g', 'u')).styleId).toBe(8);
    store.setUser('g', 'u', { styleId: 3, speed: 1.5, pitch: 0.1 });
    expect(await resolve('g', 'u')).toMatchObject({ styleId: 3, speedScale: 1.5, pitchScale: 0.1 });
    store.setUser('g', 'u', { styleId: 9, speed: 1.5, pitch: 0.1 });
    expect((await resolve('g', 'u')).styleId).toBe(8);
    store.setDefaultStyle('g', 999);
    expect((await resolve('g', 'u')).styleId).toBe(3);
    expect(logger.debug).toHaveBeenCalled();
  });
});
