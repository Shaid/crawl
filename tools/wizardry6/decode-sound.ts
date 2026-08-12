/**
 * Converts Wizardry 6 (Amiga) ".snd" sound-effect files to playable WAV.
 *
 * Format (high-confidence, see docs/wizardry6/amiga/data-structure.md
 * section ".snd sound effects"): raw, headerless, unsigned 8-bit PCM.
 * Evidence: no IFF/8SVX magic bytes at the start of any of the 35 corpus
 * files; byte value histograms cluster tightly around 0x80 (128), which is
 * silence/DC-centre for unsigned 8-bit PCM (e.g. sound02.snd opens with 20
 * consecutive 0x80/0x86 bytes -- a held near-silent tone, not compressed
 * data); whole-file means for all sampled files fall in 132-138, close to
 * 128. Not yet confirmed by ear (no playback performed this pass) and the
 * true sample rate is unknown (no header field carries one) -- this script
 * defaults to 8000 Hz, a common Paula-chip sample effects rate, and that
 * default is a guess, not a confirmed value.
 *
 * Usage: npx tsx tools/wizardry6/decode-sound.ts <dataDir> [sampleRate]
 */
import { resolve } from 'node:path';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readBinary } from '@seer-project/pipeline';

function wrapWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const dataSize = pcm.length;
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (1 byte/sample, mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  buf.set(pcm, 44); // unsigned 8-bit PCM is stored as-is in WAV (WAV's 8-bit convention is also unsigned)
  return buf;
}

function main() {
  const dataDir = process.argv[2];
  const sampleRate = process.argv[3] ? parseInt(process.argv[3], 10) : 8000;
  if (!dataDir) {
    console.error('Usage: npx tsx tools/wizardry6/decode-sound.ts <dataDir> [sampleRate]');
    process.exit(1);
  }

  const outDir = resolve('public/assets/wizardry6/amiga/audio');
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(dataDir).filter((f) => /\.snd$/i.test(f));
  for (const name of files) {
    const pcm = readBinary(resolve(dataDir, name));
    const wav = wrapWav(pcm, sampleRate);
    const outName = name.replace(/\.snd$/i, '.wav');
    writeFileSync(resolve(outDir, outName), wav);
  }
  console.log(`Wrote ${files.length} WAV files (assumed unsigned 8-bit PCM @ ${sampleRate} Hz, rate unconfirmed)`);
}

main();
