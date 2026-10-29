export type MentionResolver = (kind: 'user' | 'role' | 'channel', id: string) => string | undefined;

export function normalizeText(
  text: string,
  options: {
    resolve?: MentionResolver;
    maxLength?: number;
    truncateSuffix?: string;
    hasAttachments?: boolean;
    transform?: (text: string) => string;
  } = {},
): string {
  let result = text
    .replace(/```[\s\S]*?(?:```|$)/g, ' コードブロック省略 ')
    .replace(/\|\|[\s\S]*?\|\|/g, ' 伏せ字 ')
    .replace(/https?:\/\/[^\s<>]+/gi, 'URL省略')
    .replace(/<(@[!&]?|#)(\d+)>/g, (_match, prefix: string, id: string) => {
      const kind = prefix === '#' ? 'channel' : prefix === '@&' ? 'role' : 'user';
      return (
        options.resolve?.(kind, id) ??
        { user: 'ユーザー', role: 'ロール', channel: 'チャンネル' }[kind]
      );
    })
    .replace(/<a?:(\w+):\d+>/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ｗw]{2,}/g, 'わらわら')
    .replace(/\s+/g, ' ')
    .trim();
  if (!result && options.hasAttachments) result = '添付ファイル';
  if (options.transform) result = options.transform(result);
  const chars = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(result),
    (part) => part.segment,
  );
  const max = options.maxLength ?? 100;
  return chars.length > max ? chars.slice(0, max).join('') + (options.truncateSuffix ?? '以下略') : result;
}
