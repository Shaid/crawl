/**
 * Eye of the Beholder II (Amiga) standalone `.PAL` decoder.
 *
 * **Confirmed (2026-09-02) by direct inspection of real corpus bytes** --
 * every wall-set `.PAL` in `data/eotb2/amiga/data/` (`AZURE.PAL`,
 * `CRIMSON.PAL`, `DUNG.PAL`, `FOREST.PAL`, `MEZZ.PAL`, `SILVER.PAL`) is
 * exactly 64 bytes = 32 colours x 2 bytes -- the same 12-bit-Amiga-word,
 * big-endian encoding already confirmed for EOB1 Amiga's `.VCN`-embedded
 * palette patch (`docs/eotb/amiga/data-structure.md` § "Palette (VCN
 * offset 0x02...)", `Palette::loadAmigaPalette`) -- reuses
 * `eobAmigaWordToRGB`/`readBEWords` from `tools/eotb/palette.ts` directly
 * rather than re-deriving the scaling formula.
 *
 * This is a genuine, confirmed divergence from EOB2 *DOS*'s own `.PAL`
 * (768 bytes = 256 x 3-byte 6-bit VGA DAC entries, `tools/eotb2/
 * palette.ts`): same game, same file extension, same *mechanism*
 * (`EoBCoreEngine::initLevelData` name-matches the level's `.INF`
 * wall-set stem to `<stem>.PAL`, `docs/eotb2/dosvga/data-structure.md` §
 * "Palette resolution"), but two different concrete on-disk encodings --
 * the DOS/VGA-shaped 768-byte format and this Amiga-native 64-byte
 * format -- exactly the hybrid this project's platform-crossing pattern
 * predicts (EOB2's *mechanism*, EOB1-Amiga's *encoding*).
 *
 * `FINALE.PAL` is 384 bytes (6 x 64-byte palettes back to back) -- not
 * decoded by this module (out of scope for the wall-rendering pipeline;
 * see `docs/eotb2/amiga/data-structure.md`'s "Not extracted this
 * session" table).
 */
import { eobAmigaWordToRGB, readBEWords } from '../../eotb/palette.ts';

const PALETTE_COLORS = 32;
const PALETTE_BYTES = PALETTE_COLORS * 2; // 64

export function decodePal(data: Uint8Array): [number, number, number][] {
  if (data.length !== PALETTE_BYTES) {
    throw new Error(`decodePal: oracle check failed -- expected ${PALETTE_BYTES} bytes (32 x BE Amiga colour word), got ${data.length}`);
  }
  return readBEWords(data, 0, PALETTE_COLORS).map(eobAmigaWordToRGB);
}
