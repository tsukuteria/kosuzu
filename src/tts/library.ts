export const LIBRARY_SIZE_LIMIT = 256 * 1024 * 1024;

export async function downloadLibrary(
  url: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  limit = LIBRARY_SIZE_LIMIT,
): Promise<Blob> {
  if (!['http:', 'https:'].includes(new URL(url).protocol))
    throw new Error('ダウンロード URL が不正です');
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error('ライブラリを取得できませんでした');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > limit)
      throw new Error('ライブラリのサイズ上限を超えています');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('ライブラリのサイズ上限を超えています');
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks, { type: 'application/zip' });
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
