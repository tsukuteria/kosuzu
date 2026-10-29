import { describe, expect, it } from 'vitest';
import { applyDictionary } from '../src/tts/dictionary.js';
import { openDatabase } from '../src/store/database.js';
import { SqliteSettings } from '../src/store/settings.js';

describe('辞書', () => {
  it('NFKC と ASCII 大文字を照合し長い表記を優先、置換結果を再走査しない', () => {
    const entries = [
      { surface: 'abc', reading: 'B' },
      { surface: 'ab', reading: '短い' },
      { surface: 'b', reading: 'C' },
    ];
    expect(applyDictionary('前ＡＢＣ後 ab B', entries)).toBe('前B後 短い C');
    expect(applyDictionary('ABC', entries)).toBe('B');
  });
  it('登録制限と更新時のキャッシュ無効化を守る', () => {
    const db = openDatabase(':memory:');
    try {
      const store = new SqliteSettings(db);
      expect(() => store.putDictionary('g', '　', 'a', 'u')).toThrow();
      expect(() => store.putDictionary('g', 'x'.repeat(51), 'a', 'u')).toThrow();
      expect(() => store.putDictionary('g', 'x', '', 'u')).toThrow();
      expect(() => store.putDictionary('g', 'x', 'a'.repeat(101), 'u')).toThrow();
      expect(store.putDictionary('g', 'Ａ', '最初', 'u')).toBe(false);
      expect(applyDictionary('A', store.dictionary('g'))).toBe('最初');
      expect(store.putDictionary('g', 'a', '次', 'u')).toBe(true);
      expect(applyDictionary('A', store.dictionary('g'))).toBe('次');
      expect(store.removeDictionary('g', 'Ａ')).toBe(true);
      expect(applyDictionary('A', store.dictionary('g'))).toBe('A');
      for (let i = 0; i < 500; i++) store.putDictionary('g', `x${i}`, 'a', 'u');
      expect(() => store.putDictionary('g', 'overflow', 'a', 'u')).toThrow();
      expect(store.putDictionary('g', 'x0', 'b', 'u')).toBe(true);
    } finally {
      db.close();
    }
  });
});
