import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePlayer4x, player4xToProtrackerMod, convertPlayer4xToMod, isPlayer4x } from '../amiga-player4x.ts';

describe('isPlayer4x', () => {
  it('recognizes P40A/P40B/P41A magics', () => {
    expect(isPlayer4x(new Uint8Array([0x50, 0x34, 0x30, 0x41]))).toBe(true); // 'P40A'
    expect(isPlayer4x(new Uint8Array([0x50, 0x34, 0x30, 0x42]))).toBe(true); // 'P40B'
    expect(isPlayer4x(new Uint8Array([0x50, 0x34, 0x31, 0x41]))).toBe(true); // 'P41A'
  });

  it('rejects non-matching magic, including standard ProTracker header bytes', () => {
    expect(isPlayer4x(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBe(false);
    expect(isPlayer4x(new Uint8Array([]))).toBe(false);
  });
});

/**
 * Hand-built minimal synthetic `P41A` fixture: songLength=1, 0 samples, a
 * single pattern whose 4 channels all point at the same 256-byte all-zero
 * track-data span (64 rows x 4 bytes/event, event byte c1=c2=c3=c4=0x00
 * decodes via `setEvent(0,0,0)` to the "no note, no effect" all-zero MOD
 * event `[0,0,0,0]`). Byte layout (see `decodePlayer4x`'s own field-by-field
 * reads):
 *
 *   0-3   magic 'P41A'
 *   4     "real number of patterns" (unused)
 *   5     len (song length) = 1
 *   6     nsmp = 0
 *   7     pad byte
 *   8-11  raw trkdatOfs = 24  (-> trkdatOfs = 24+4 = 28)
 *   12-15 raw trktabOfs = 16  (-> trktabOfs = 16+4 = 20)
 *   16-19 raw smpOfs    = 24  (-> smpOfs    = 24+4 = 28, unused: nsmp=0)
 *   20-27 track-offset table: 4 channels x u16be, all 0 (-> all 4 channels'
 *         track data starts at trkdatOfs=28)
 *   28-283 track data: 256 zero bytes (64 rows x 4 bytes), shared by all 4
 *          channels since they all resolve to the same start address
 */
function buildMinimalP41A(): Uint8Array {
  const buf = new Uint8Array(284);
  buf.set([0x50, 0x34, 0x31, 0x41], 0); // 'P41A'
  buf[4] = 0x00;
  buf[5] = 0x01; // len = 1
  buf[6] = 0x00; // nsmp = 0
  buf[7] = 0x00;
  const u32be = (off: number, v: number) => {
    buf[off] = (v >>> 24) & 0xff;
    buf[off + 1] = (v >>> 16) & 0xff;
    buf[off + 2] = (v >>> 8) & 0xff;
    buf[off + 3] = v & 0xff;
  };
  u32be(8, 24); // raw trkdatOfs
  u32be(12, 16); // raw trktabOfs
  u32be(16, 24); // raw smpOfs
  // offsets 20-283 are already zero (track-offset table + track data)
  return buf;
}

describe('decodePlayer4x + player4xToProtrackerMod, synthetic fixture', () => {
  it('decodes the minimal fixture to the expected logical structure', () => {
    const mod = decodePlayer4x(buildMinimalP41A());
    expect(mod.version).toBe('P41A');
    expect(mod.songLength).toBe(1);
    expect(mod.samples).toHaveLength(0);
    expect(mod.patterns).toHaveLength(1);
    expect(mod.patterns[0]).toHaveLength(64);
    for (const row of mod.patterns[0]!) {
      expect(row).toHaveLength(16);
      expect(Array.from(row)).toEqual(new Array(16).fill(0));
    }
  });

  it('re-encodes to a byte-exact, correctly-sized M.K. ProTracker module', () => {
    const mod = decodePlayer4x(buildMinimalP41A());
    const out = player4xToProtrackerMod(mod);
    // Standard 1084-byte MOD header (20 title + 31*30 sample headers + 1
    // songLength + 1 restart byte + 128 order table + 4 magic) plus one
    // pattern (64 rows x 16 bytes) plus 0 sample bytes.
    expect(out.length).toBe(1084 + 1 * 64 * 16);
    const magic = String.fromCharCode(out[1080]!, out[1081]!, out[1082]!, out[1083]!);
    expect(magic).toBe('M.K.');
    expect(out[950]).toBe(1); // song length byte
    expect(out[951]).toBe(0x7f); // noisetracker/restart byte
    expect(out[952]).toBe(0); // order table entry 0
    // Pattern data (right after the 1084-byte header) is all zero.
    expect(Array.from(out.subarray(1084))).toEqual(new Array(1024).fill(0));
  });

  it('convertPlayer4xToMod is equivalent to decode-then-encode', () => {
    const raw = buildMinimalP41A();
    expect(convertPlayer4xToMod(raw)).toEqual(player4xToProtrackerMod(decodePlayer4x(raw)));
  });

  it('throws on bad magic', () => {
    expect(() => decodePlayer4x(new Uint8Array(20))).toThrow();
  });
});

const MUSIC_DIR = 'data/dungeonmaster2/amiga/music';
const HAS_CORPUS = existsSync(MUSIC_DIR);

describe.skipIf(!HAS_CORPUS)('P41A decoder, real Dungeon Master II corpus', () => {
  it('all 10 music/*.MOD files are P41A-signed and decode to well-formed modules', () => {
    const files = readdirSync(MUSIC_DIR).sort();
    expect(files.length).toBe(10);
    for (const f of files) {
      const raw = new Uint8Array(readFileSync(resolve(MUSIC_DIR, f)));
      expect(isPlayer4x(raw)).toBe(true);
      const mod = decodePlayer4x(raw);
      expect(mod.version).toBe('P41A');
      expect(mod.songLength).toBeGreaterThan(0);
      expect(mod.songLength).toBeLessThan(128);
      expect(mod.samples.length).toBeGreaterThan(0);
      expect(mod.samples.length).toBeLessThanOrEqual(31);
    }
  });

  it('re-encoded modules are well-formed M.K. ProTracker files whose size matches the computed structure', () => {
    const files = readdirSync(MUSIC_DIR).sort();
    for (const f of files) {
      const raw = new Uint8Array(readFileSync(resolve(MUSIC_DIR, f)));
      const mod = decodePlayer4x(raw);
      const out = convertPlayer4xToMod(raw);
      const patternBytes = mod.patterns.length * 64 * 16;
      const sampleBytes = mod.samples.reduce((n, s) => n + s.data.length, 0);
      expect(out.length).toBe(1084 + patternBytes + sampleBytes);
      const magic = String.fromCharCode(out[1080]!, out[1081]!, out[1082]!, out[1083]!);
      expect(magic).toBe('M.K.');
    }
  });

  it('decoded sample PCM is real, non-degenerate audio (quantitative RMS + lag-1 autocorrelation check)', () => {
    // Guards against a silent decode regression that would still "look" like
    // valid bytes (in-range header fields) while actually producing
    // flat/silent/garbage sample data. Real audio is strongly self-correlated
    // sample-to-sample; noise/a decode bug is not. Thresholds match the
    // values found during initial verification (2026-09-02): 29/30 samples
    // in [0.57, 0.99], one percussive/noisy outlier near 0.
    const files = readdirSync(MUSIC_DIR).sort();
    let checked = 0;
    let stronglyCorrelated = 0;
    for (const f of files) {
      const raw = new Uint8Array(readFileSync(resolve(MUSIC_DIR, f)));
      const mod = decodePlayer4x(raw);
      for (const s of mod.samples) {
        if (s.data.length < 100) continue;
        checked++;
        const signed = new Int8Array(s.data.buffer, s.data.byteOffset, s.data.length);
        let sum = 0;
        let min = 127;
        let max = -128;
        for (const v of signed) {
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const mean = sum / signed.length;
        let num = 0;
        let den = 0;
        for (let i = 1; i < signed.length; i++) num += (signed[i]! - mean) * (signed[i - 1]! - mean);
        for (let i = 0; i < signed.length; i++) den += (signed[i]! - mean) ** 2;
        const r1 = den === 0 ? 0 : num / den;
        // Non-degenerate: not silent/flat.
        expect(max - min).toBeGreaterThan(4);
        if (Math.abs(r1) > 0.5) stronglyCorrelated++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(stronglyCorrelated / checked).toBeGreaterThan(0.8);
  });
});
