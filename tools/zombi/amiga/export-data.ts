/**
 * Zombi (Amiga) extractor — Cyber Paint `.SEQ` pictures + `.SON` sound effects.
 *
 * Usage: npx tsx tools/zombi/amiga/export-data.ts [dataDir]
 * (`dataDir` defaults to `data/zombi/amiga/data`.)
 *
 * Palette: the ST 3-bit `0x0RGB` words become Amiga 4-bit by doubling each
 * channel (n -> 2n); confirmed — the executable holds PRESENT.SEQ's and
 * SCREEN.SEQ's palettes at exactly that scaling (`zombi+0x13BB8`..). The
 * PNGs use the Amiga value (nibble * 17), so white is 0xEE, not 0xFF.
 *
 * Spec: docs/zombi/amiga/data-structure.md § SEQ / § SON.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { shelfPack } from '@seer-project/core';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex, type ManifestEntry } from '../../shared/asset-paths.ts';
import { parseSeq, frameIndices } from '../../shared/cyberpaint-seq.ts';

const GAME = 'zombi';
const PLATFORM = 'amiga';

/** ST word 0x0RGB (3 bits/channel) -> Amiga 4-bit (n*2) -> 8-bit (nibble*17). */
export function amigaColorFromSt(word: number): [number, number, number] {
  const c = (n: number) => (n & 7) * 2 * 17;
  return [c(word >> 8), c(word >> 4), c(word)];
}

export interface SeqExportSummary {
  files: number;
  frames: number;
  sounds: number;
  errors: string[];
}

export function resolveDataDir(dataDir: string): string {
  return existsSync(resolve(dataDir, 'data')) ? resolve(dataDir, 'data') : resolve(dataDir);
}

export async function exportSeqFile(dir: string, file: string): Promise<{ frames: number; entry: ManifestEntry }> {
  const d = new Uint8Array(readFileSync(resolve(dir, file)));
  const seq = parseSeq(d);
  const name = file.replace(/\.seq$/i, '').toLowerCase();
  const pals = new Set(seq.frames.map((f) => f.palette.join(',')));
  const palette = seq.frames[0].palette.map(amigaColorFromSt);
  const single = seq.frames.length === 1;
  const pack = shelfPack(seq.frames.map((f) => ({ name: `${name}_${f.index}`, width: f.width, height: f.height })), 1024);
  const rgba = new Uint8Array(pack.width * pack.height * 4);
  seq.frames.forEach((f, i) => {
    const idx = frameIndices(d, f);
    const pal = f.palette.map(amigaColorFromSt);
    const { x: ox, y: oy } = pack.frames[i];
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const c = pal[idx[y * f.width + x]];
        const o = ((oy + y) * pack.width + ox + x) * 4;
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
  });
  const cat = single ? 'screens' : 'sprites';
  const outDir = assetDir(cat, GAME, PLATFORM);
  if (single) {
    const f = seq.frames[0];
    const img = new Uint8Array(f.width * f.height * 4);
    for (let y = 0; y < f.height; y++) img.set(rgba.subarray(((pack.frames[0].y + y) * pack.width + pack.frames[0].x) * 4, ((pack.frames[0].y + y) * pack.width + pack.frames[0].x + f.width) * 4), y * f.width * 4);
    await writePNG(resolve(outDir, `${name}.png`), img, f.width, f.height);
  } else {
    await writePNG(resolve(outDir, `${name}.png`), rgba, pack.width, pack.height);
    writeJson(resolve(outDir, `${name}.json`), {
      frames: pack.frames.map((p, i) => ({ name: `${i}`, x: p.x, y: p.y, w: seq.frames[i].width, h: seq.frames[i].height, label: seq.frames[i].name, storage: seq.frames[i].storage, op: seq.frames[i].operation })),
      width: pack.width,
      height: pack.height,
    });
  }
  writeJson(resolve(assetDir('palettes', GAME, PLATFORM), `${name}.json`), {
    colors: palette.map(([r, g, b]) => ({ r, g, b })),
    stWords: seq.frames[0].palette,
    distinctFramePalettes: pals.size,
  });
  return { frames: seq.frames.length, entry: manifestEntry(`${cat}/${name}`, seq.frames.length, true) };
}

/** `.SON`: u32 BE length, u16 BE rate, signed 8-bit mono PCM. */
export function sonToWav(b: Uint8Array): { wav: Uint8Array; rate: number; samples: number } {
  const n = (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0;
  const rate = (b[4] << 8) | b[5];
  if (n !== b.length - 6) throw new Error(`SON length ${n} != ${b.length - 6}`);
  const out = new Uint8Array(44 + n);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, 36 + n, true);
  out.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) out[44 + i] = (b[6 + i] + 128) & 0xff; // signed -> unsigned 8-bit
  return { wav: out, rate, samples: n };
}

/**
 * Location id (1..90) -> LIEUX.SEQ frame index (0-based), from the executable's
 * LAB_0275 (zombi hunk S_0 +0x5088) + LAB_0139 (+0x2B72, frame = picture-1).
 * The picture number starts as the location id, is remapped by an 18-entry
 * table for the car-park/vehicle ids, then overridden by `i-lieux` record
 * byte 9 when non-zero. Ids 87-90 are vehicle views (+0x5F4A..0x5F7A).
 */
export function locationFrame(id: number, iLieuxByte9: number): number {
  let pic = id;
  if (id === 71) pic = 0x46;
  else if (id >= 72 && id <= 74) pic = 0x47;
  else if (id === 75 || id === 76) pic = 0x48;
  else if (id >= 77 && id <= 81) pic = 0x49;
  else if (id >= 82 && id <= 86) pic = 0x4a;
  else if (id === 90) pic = 0x4c;
  else if (id >= 87) pic = 0x4b;
  if (iLieuxByte9) pic = iLieuxByte9;
  return pic - 1;
}

export async function exportZombiData(dataDirArg: string): Promise<SeqExportSummary> {
  const dir = resolveDataDir(dataDirArg);
  const s: SeqExportSummary = { files: 0, frames: 0, sounds: 0, errors: [] };
  const entries: ManifestEntry[] = [];
  const names = readdirSync(dir);
  for (const f of names.filter((x) => /\.seq$/i.test(x)).sort()) {
    try {
      const r = await exportSeqFile(dir, f);
      s.files++; s.frames += r.frames; entries.push(r.entry);
    } catch (e) { s.errors.push(`${f}: ${(e as Error).message}`); }
  }
  const audioDir = assetDir('audio', GAME, PLATFORM);
  const sounds: Record<string, { rate: number; samples: number }> = {};
  for (const f of names.filter((x) => /\.son$/i.test(x)).sort()) {
    try {
      const w = sonToWav(new Uint8Array(readFileSync(resolve(dir, f))));
      const n = f.replace(/\.son$/i, '').toLowerCase();
      writeFileSync(resolve(audioDir, `${n}.wav`), w.wav);
      sounds[n] = { rate: w.rate, samples: w.samples };
      s.sounds++;
    } catch (e) { s.errors.push(`${f}: ${(e as Error).message}`); }
  }
  writeJson(resolve(assetDir('data', GAME, PLATFORM), 'sounds.json'), sounds);
  const il = resolve(dir, 'i-lieux');
  if (existsSync(il)) {
    const b = new Uint8Array(readFileSync(il));
    const frames: number[] = [];
    for (let id = 1; id <= 90; id++) frames.push(locationFrame(id, b[(id - 1) * 50 + 9]));
    writeJson(resolve(assetDir('data', GAME, PLATFORM), 'location-pictures.json'), { atlas: 'sprites/lieux', frames });
  }
  writeManifest(entries, GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  console.log(`zombi/amiga: ${s.files} SEQ files, ${s.frames} frames, ${s.sounds} SON -> WAV` + (s.errors.length ? `, errors: ${s.errors.join('; ')}` : ''));
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportZombiData(resolve(process.argv[2] ?? 'data/zombi/amiga/data')).catch((e) => { console.error(e); process.exit(1); });
}
