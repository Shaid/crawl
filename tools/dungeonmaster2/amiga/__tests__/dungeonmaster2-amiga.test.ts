import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDataFileHeader, readItem } from '../../../shared/dungeonmaster-container.ts';
import { decodeImg4Checked, decodeImg1Checked } from '../../../shared/dungeonmaster-codec.ts';
import { parseDungeon } from '../../../shared/dungeonmaster-dungeon.ts';

const DATA_DIR = 'data/dungeonmaster2/amiga';
const HAS_CORPUS = existsSync(resolve(DATA_DIR, 'GRAPHICS.DAT'));

describe.skipIf(!HAS_CORPUS)('Dungeon Master II (Amiga), real corpus', () => {
  it('DUNGEON.DAT (uncompressed) parses to 44 maps, including the DM2-only "empty" square type', () => {
    const raw = new Uint8Array(readFileSync(resolve(DATA_DIR, 'DUNGEON.DAT')));
    const parsed = parseDungeon(raw); // not 0x8104-signed on this corpus
    expect(parsed.header.mapCount).toBe(44);
    expect(parsed.maps).toHaveLength(44);
    // Real evidence is structural, not "level 7" (DM2 has several maps per level):
    // forward walk tiles to EOF-2, trailer = byte sum, per-map byte offsets = cumulative cursor.
    expect(parsed.forwardTilingExact).toBe(true);
    expect(parsed.checksum).toEqual({ stored: 0x3d9f, computed: 0x3d9f, valid: true });
    expect(parsed.mapOffsetsMatchCursor).toBe(true);
    expect(parsed.maps[0]!.def.level).toBe(7);

    let sawEmpty = false;
    for (const m of parsed.maps) {
      for (const row of m.squares) for (const sq of row) if (sq.type === 'empty') sawEmpty = true;
    }
    expect(sawEmpty).toBe(true);
  });

  it('GRAPHICS.DAT: 2,260/2,263 plausible items tile exactly under the 5/6-nibble-palette + 16-byte-trailer grammar', () => {
    const data = new Uint8Array(readFileSync(resolve(DATA_DIR, 'GRAPHICS.DAT')));
    const df = parseDataFileHeader(data);
    expect(df.format).toBe('DMII');
    expect(df.itemCount).toBe(4630);

    let candidates = 0;
    let tiled = 0;
    let six = 0;
    let five = 0;
    let fiveWithSelector5 = 0;
    let oldGrammarExact = 0;
    let img1Exact = 0;
    for (const item of df.items) {
      if (item.size < 8 || item.size > 32768) continue;
      const raw = readItem(data, item);
      const w = (raw[0] << 8) | raw[1];
      const h = (raw[2] << 8) | raw[3];
      if (w === 0 || h === 0 || w > 350 || h > 220 || w * h > 40000) continue;
      candidates++;
      const r = decodeImg4Checked(raw);
      if (r) {
        tiled++;
        if (r.paletteNibbles === 6) six++;
        else {
          five++;
          if (r.selector5Runs > 0) fiveWithSelector5++;
        }
      }
      // Null controls: the old 6-nibble grammar WITHOUT a trailer, and IMG1.
      if (decodeImg1Checked(raw).exact) img1Exact++;
      // Old grammar: 6-nibble palette, stream must consume the whole item (no trailer).
      const noTrailer = decodeImg4NoTrailerExact(raw);
      if (noTrailer) oldGrammarExact++;
    }
    expect(candidates).toBe(2263);
    expect(tiled).toBe(2260);
    expect(six).toBe(1533);
    expect(five).toBe(727);
    expect(fiveWithSelector5).toBe(727); // every 5-nibble item uses the non-palette selector 5
    // Null controls collapse: the shipped-before grammar (no trailer) tiles ~5/2263; IMG1 almost none.
    expect(oldGrammarExact).toBeLessThan(30);
    expect(img1Exact).toBeLessThan(100);
  });
});

/** The pre-audit grammar (6-nibble palette, run stream consumes the whole item, no trailer). */
function decodeImg4NoTrailerExact(raw: Uint8Array): boolean {
  // Re-use the checked decoder on a copy with 16 zero bytes appended: if the old grammar were
  // right the stream would end at the original end and the appended bytes would be the trailer.
  const padded = new Uint8Array(raw.length + 16);
  padded.set(raw);
  const r = decodeImg4Checked(padded, 6);
  return r !== null && r.padNibbles <= 1;
}
