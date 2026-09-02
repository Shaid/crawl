/**
 * Eye of the Beholder II (Amiga) `TEXT.CPS` / `TEXT2.CPS` / `TEXT4.CPS`
 * NPC dialogue-text decoder.
 *
 * **A genuine, decisive find (2026-09-02): despite the `.CPS` extension
 * (every other `.CPS` in this corpus is a bitmap, `./decode-cps.ts`),
 * these three files are the Amiga port's `TEXT.DAT` equivalent** -- NOT
 * an image, and no `TEXT.DAT` file exists anywhere in this corpus at all.
 * `Screen::loadBitmap`/`decodeFrame4` don't get anywhere near these files
 * at runtime; they hit them purely because `.CPS` is this whole corpus's
 * blanket "goes through the shared Kyra bitmap header + LCW" container,
 * used here for a wholly different payload type. Confirmed by decoding,
 * not guessed from the extension:
 *
 * - LCW-decompressing any of the three (`decompressKyraContainer`, `./
 *   decode-vcn.ts`) yields exactly **22,463 bytes** -- byte-for-byte the
 *   same size as EOB2 *DOS*'s own `TEXT.DAT` (`docs/eotb2/dosvga/
 *   data-structure.md` § "ITEM.DAT / ITEMTYPE.DAT / TEXT.DAT").
 * - That payload is the **identical offset-table + NUL-terminated-
 *   string-pool** format already confirmed for DOS's `TEXT.DAT`: `u16 LE
 *   offsets[N]` (`N = offsets[0]/2`), followed immediately by the string
 *   pool. `offsets[0]=244` -> `N=122`, matching DOS's own count exactly.
 * - The decompressed bytes of all three files are **md5-identical to each
 *   other AND to EOB2 DOS's real `TEXT.DAT`** (`438534e7ba748251c5ac24b
 *   4d6654c88`, all four) -- the strongest possible confirmation: this
 *   isn't a structurally-similar-but-different reencoding, it is the
 *   exact same string data, just LCW-compressed and split across 3
 *   identical copies (presumably one per language-selection UI hook, not
 *   investigated further) instead of DOS's single raw file.
 *
 * See `~/.claude/agents/game-re-lessons/familiar-extension-not-proof-of-
 * standard-format.md` -- this is a fresh instance of that pitfall at the
 * whole-file level (extension, not magic bytes).
 */
import { decompressKyraContainer } from './decode-vcn.ts';

export function decodeTextCps(data: Uint8Array): string[] {
  const dec = decompressKyraContainer(data);
  const numEntries = ((dec[0]! | (dec[1]! << 8)) / 2) | 0;
  const strings: string[] = [];
  for (let i = 0; i < numEntries; i++) {
    const start = dec[i * 2]! | (dec[i * 2 + 1]! << 8);
    let end = start;
    while (dec[end] !== 0 && end < dec.length) end++;
    strings.push(Buffer.from(dec.subarray(start, end)).toString('latin1'));
  }
  return strings;
}
