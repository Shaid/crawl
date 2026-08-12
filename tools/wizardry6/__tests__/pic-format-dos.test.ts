import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decompressDosRle, RLE_BLOCK_SIZE } from '../dos-rle.ts';
import { readDosPic, DOS_DIRECTORY_SIZE } from '../pic-format-dos.ts';
import { readPicDirectory, decodePicCel, picCelByteLength } from '../pic-format.ts';

const DOS_DIR = 'data/wizardry6/dosega/wiz6';
const AMIGA_DIR = 'data/wizardry6/amiga';

function hex(s: string): Uint8Array {
  return new Uint8Array(
    s
      .split(/\s+/)
      .filter(Boolean)
      .map((b) => parseInt(b, 16)),
  );
}

/** Fast element-wise compare -- vitest's deep equality is far too slow here. */
function diffCount(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.abs(a.length - b.length) + 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

describe('decompressDosRle', () => {
  it('copies a literal token', () => {
    expect([...decompressDosRle(hex('03 aa bb cc'))]).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('expands a run token as 256 - ctrl copies', () => {
    expect([...decompressDosRle(hex('fd 01'))]).toEqual([1, 1, 1]);
    expect(decompressDosRle(hex('80 ff'))).toHaveLength(128);
    expect([...decompressDosRle(hex('ff 7e'))]).toEqual([0x7e]);
  });

  it('decodes the real mon00.pic header into four 24-byte directory slots', () => {
    // First 28 compressed bytes of data/wizardry6/dosega/wiz6/mon00.pic.
    const src = hex(
      '02 58 02 fd 01 ed 00 02 78 02 fd 01 ed 00' + ' 02 98 02 fd 01 ed 00 02 b8 02 fd 01 ed 00',
    );
    const out = decompressDosRle(src);
    expect(out).toHaveLength(96); // 4 slots x 24 bytes
    for (const [i, lo] of [0x58, 0x78, 0x98, 0xb8].entries()) {
      const slot = out.subarray(i * 24, (i + 1) * 24);
      expect([...slot.subarray(0, 5)]).toEqual([lo, 0x02, 1, 1, 1]); // offset LE, w, h, mask
      expect([...slot.subarray(5)]).toEqual(new Array(19).fill(0)); // mask tail
    }
  });

  it('skips the one-byte filler left at the end of a 4096-byte block', () => {
    const src = new Uint8Array(RLE_BLOCK_SIZE + 2);
    src[0] = 0x80; // run of 128
    src[1] = 0x11;
    src[RLE_BLOCK_SIZE - 1] = 0xff; // filler: a run token cannot fit in 1 byte
    src[RLE_BLOCK_SIZE] = 0xfe; // next block: run of 2
    src[RLE_BLOCK_SIZE + 1] = 0x22;
    const out = decompressDosRle(src);
    // 128x 0x11, then the zero-filled remainder decoded as zero-length
    // literals, then 2x 0x22 from the next block -- and no 0xff run.
    expect(out.subarray(0, 128).every((b) => b === 0x11)).toBe(true);
    expect([...out.subarray(out.length - 2)]).toEqual([0x22, 0x22]);
    expect([...out].filter((b) => b === 0xff)).toHaveLength(0);
  });
});

const hasCorpus = existsSync(DOS_DIR) && existsSync(AMIGA_DIR);

describe.skipIf(!hasCorpus)('DOS .PIC vs Amiga .PIC corpus', () => {
  const names = hasCorpus
    ? readdirSync(DOS_DIR)
        .filter((n) => /^mon\d\d\.pic$/.test(n))
        .filter((n) => existsSync(join(AMIGA_DIR, n)))
        .sort()
    : [];

  it('finds the mon##.pic corpus', () => {
    expect(names.length).toBe(59);
  });

  it('decompresses byte-exactly to the Amiga tile payload', () => {
    let cels = 0;
    let pixels = 0;
    for (const name of names) {
      const { data, cels: dosCels } = readDosPic(readFileSync(join(DOS_DIR, name)));
      const amiga = new Uint8Array(readFileSync(join(AMIGA_DIR, name)));
      const amigaCels = readPicDirectory(amiga);

      // Whole payload identical, and the directory is 50 bytes shorter.
      expect(data.length, name).toBe(amiga.length - 50);
      expect(diffCount(data.subarray(DOS_DIRECTORY_SIZE), amiga.subarray(650)), name).toBe(0);

      expect(dosCels.length, name).toBe(amigaCels.length);
      for (const [i, d] of dosCels.entries()) {
        const a = amigaCels[i];
        const where = `${name} cel ${i}`;
        expect(d.offset, where).toBe(a.offset - 50);
        expect([d.tilesWide, d.tilesHigh], where).toEqual([a.tilesWide, a.tilesHigh]);
        expect(diffCount(d.mask, a.mask), where).toBe(0);
        expect(diffCount(decodePicCel(data, d), decodePicCel(amiga, a)), where).toBe(0);
        cels++;
        pixels += d.widthPx * d.heightPx;
      }
    }
    expect(cels).toBe(712);
    expect(pixels).toBe(3414272);
  });

  it('satisfies the mask-popcount offset invariant', () => {
    for (const name of [...names, 'credits.pic']) {
      const { cels } = readDosPic(readFileSync(join(DOS_DIR, name)));
      for (const [i, cel] of cels.entries()) {
        if (i + 1 >= cels.length) continue; // last cel: trailing zero pad allowed
        expect(cels[i + 1].offset - cel.offset, `${name} cel ${i}`).toBe(picCelByteLength(cel));
      }
    }
  });
});
