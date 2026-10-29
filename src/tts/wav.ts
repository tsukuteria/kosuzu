export function wavToPcm(wav: Buffer): Buffer {
  const invalid = () => new Error('WAV は PCM 16-bit / 48000 Hz / 2 ch である必要があります');
  if (
    wav.length < 12 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw invalid();
  const end = wav.readUInt32LE(4) + 8;
  if (end !== wav.length) throw invalid();
  let format = false;
  let data: Buffer | undefined;
  let offset = 12;
  while (offset < end) {
    if (offset + 8 > end) throw invalid();
    const name = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size + (size % 2) > end) throw invalid();
    if (name === 'fmt ') {
      if (
        format ||
        size < 16 ||
        wav.readUInt16LE(start) !== 1 ||
        wav.readUInt16LE(start + 2) !== 2 ||
        wav.readUInt32LE(start + 4) !== 48000 ||
        wav.readUInt32LE(start + 8) !== 192000 ||
        wav.readUInt16LE(start + 12) !== 4 ||
        wav.readUInt16LE(start + 14) !== 16
      )
        throw invalid();
      format = true;
    }
    if (name === 'data') {
      if (data || size === 0 || size % 4 !== 0) throw invalid();
      data = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || !data) throw invalid();
  return data;
}
