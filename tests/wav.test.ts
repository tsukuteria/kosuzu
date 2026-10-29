import { describe, expect, it } from 'vitest';
import { wavToPcm } from '../src/tts/wav.js';

function chunk(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(name);
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}
export function makeWav(extra = false): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(2, 2);
  fmt.writeUInt32LE(48000, 4);
  fmt.writeUInt32LE(192000, 8);
  fmt.writeUInt16LE(4, 12);
  fmt.writeUInt16LE(16, 14);
  const body = Buffer.concat([
    Buffer.from('WAVE'),
    ...(extra ? [chunk('JUNK', Buffer.from('abc'))] : []),
    chunk('fmt ', fmt),
    chunk('data', Buffer.from([1, 2, 3, 4])),
    ...(extra ? [chunk('LIST', Buffer.from('x'))] : []),
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe('wavToPcm', () => {
  it.each([false, true])('余分な奇数長チャンクも走査して PCM を取り出す (%s)', (extra) => {
    expect(wavToPcm(makeWav(extra))).toEqual(Buffer.from([1, 2, 3, 4]));
  });
  it.each([0, 8, 12, 20, 22, 24, 28, 32, 34, 36, 40])('ヘッダー破損を拒否する (%s)', (offset) => {
    const wav = makeWav();
    wav[offset] ^= 0xff;
    expect(() => wavToPcm(wav)).toThrow();
  });
  it('切断・欠落したチャンクを拒否する', () => {
    const wav = makeWav();
    for (let size = 0; size < wav.length; size++)
      expect(() => wavToPcm(wav.subarray(0, size))).toThrow();
    const missing = Buffer.from(wav);
    missing.write('JUNK', 36);
    expect(() => wavToPcm(missing)).toThrow();
  });
});
