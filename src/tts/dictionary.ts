export interface DictionaryEntry {
  surface: string;
  reading: string;
}

export function normalizeSurface(value: string): string {
  return value.normalize('NFKC').replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const cache = new WeakMap<DictionaryEntry[], (text: string) => string>();
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  let apply = cache.get(entries);
  if (!apply) {
    const readings = new Map(entries.map((e) => [normalizeSurface(e.surface), e.reading]));
    const surfaces = [...readings.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!surfaces.length) return text;
    const pattern = new RegExp(
      surfaces.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g',
    );
    apply = (input) => {
      let normalized = '';
      const starts: number[] = [];
      const ends: number[] = [];
      for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        input,
      )) {
        const folded = normalizeSurface(part.segment);
        for (let i = 0; i < folded.length; i++) {
          starts.push(part.index);
          ends.push(part.index + part.segment.length);
        }
        normalized += folded;
      }
      let result = '';
      let last = 0;
      for (const match of normalized.matchAll(pattern)) {
        const start = starts[match.index];
        const end = ends[match.index + match[0].length - 1];
        if (start < last) continue;
        result += input.slice(last, start) + readings.get(match[0]);
        last = end;
      }
      return result + input.slice(last);
    };
    cache.set(entries, apply);
  }
  return apply(text);
}
