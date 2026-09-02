/**
 * Eye of the Beholder II (Amiga) `.VMP` wall-view mapping table decoder.
 *
 * **Confirmed byte-identical to EOB2 DOS/VGA's `.VMP`, not to EOB1
 * Amiga's** -- a real, checked finding, not an assumption from either
 * sibling port. `docs/eotb/amiga/data-structure.md`'s own module comment
 * for EOB1's `decode-vmp.ts` states EOB1 Amiga's leading header word and
 * tile-index words are **big-endian** (reasoned from a plausible ascending
 * run under BE vs. implausible multiples-of-256 under LE). EOB2 Amiga's
 * real `.VMP` bytes go the *other* way: reading `CRIMSON.VMP`'s leading
 * u16 as **little-endian** gives `2916` -- exactly `330 + 6*431`, the same
 * self-describing entry-count value EOB2 DOS's `.VMP` stores in that
 * position (`../decode-vmp.ts`'s module doc) -- while BE gives `25611`
 * (meaningless). The following words, read LE, form a plausible
 * ascending-then-mirrored run (`1,2,3,4,5,6,5,7,8,9,10,10(mirror),
 * 9(mirror),8(mirror),7(mirror)...`); read BE they're uniform multiples of
 * 256 (implausible, same tell EOB1's own doc uses). `FOREST.VMP`'s LE
 * header is `1192 = 330 + 2*431`, matching DOS FOREST's own count exactly.
 *
 * So this module re-exports EOB2 DOS's decoder unmodified rather than
 * porting EOB1 Amiga's BE one -- verified against all 5 real wall-set
 * `.VMP` files with their real `numTiles` (from `./decode-vcn.ts`): 0
 * oracle-check failures, correct wall-type-run count per set (CRIMSON/
 * DUNG/MEZZ/SILVER: 6, FOREST: 2).
 */
export { decodeVmp, type VmpData, type VmpTileRef } from '../decode-vmp.ts';
export { CELL_OFFSETS, WALL_RENDER_SLOTS, type WallRenderSlot } from '../../eotb/decode-vmp.ts';
