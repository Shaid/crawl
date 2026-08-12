/**
 * The 16 `DrawMazePiece` call arguments that compose Wizardry 6's (Amiga)
 * static first-person corridor frame -- `CODE+0x633c`–`0x6452`, inside the
 * function at `CODE+0x632c` (`LAB_036C`). Extracted by disassembly
 * (radare2 + the committed IRA `Bane.asm`, byte-identical between the two
 * tools), 2026-08-07. See `docs/wizardry6/amiga/data-structure.md` §4.4's
 * correction block for the full derivation and the exact byte-range
 * caveat (this 16-call sub-range is a strict subset of the doc's earlier,
 * imprecise `0x632c`–`0x6552` annotation, which actually spans two
 * adjacent functions).
 *
 * Each triple is `DrawMazePiece(srcIdx, mode, dstIdx)`'s three arguments,
 * confirmed push order `dstIdx, mode, srcIdx` (`data-structure.md` §4.4):
 * - `dstIdx === 0xffff` -> direct path: compose-list record `srcIdx`
 *   supplies both the graphic and the placement.
 * - `dstIdx !== 0xffff` -> mirrored path: the graphic comes from
 *   `composeList[srcIdx].dirIndex`, but placement comes from
 *   `composeList[dstIdx]`, and the blit is horizontally mirrored (bit-
 *   reversed). This holds even for calls 1-3/10-12 below, where
 *   `dstIdx === srcIdx` -- the game does not special-case that as
 *   "non-mirrored," so a faithful port must not either.
 * - `mode`: 1 = OR the source into the destination (transparent overlay),
 *   0 = replace.
 *
 * `srcIdx`/`dstIdx` here are indices into the 366-entry compose-list
 * (`mazedata-composelist.json`), not directly into the 153-entry graphic
 * directory (`mazedata.json`) -- resolve `composeList[idx].dirIndex` to
 * get the directory/atlas frame.
 */
export interface DrawMazePieceCall {
  dstIdx: number;
  mode: 0 | 1;
  srcIdx: number;
}

export const STATIC_CORRIDOR_CALLS: DrawMazePieceCall[] = [
  { dstIdx: 123, mode: 1, srcIdx: 123 },
  { dstIdx: 124, mode: 1, srcIdx: 124 },
  { dstIdx: 125, mode: 1, srcIdx: 125 },
  { dstIdx: 16, mode: 1, srcIdx: 20 },
  { dstIdx: 17, mode: 1, srcIdx: 21 },
  { dstIdx: 18, mode: 1, srcIdx: 22 },
  { dstIdx: 20, mode: 1, srcIdx: 16 },
  { dstIdx: 21, mode: 1, srcIdx: 17 },
  { dstIdx: 22, mode: 1, srcIdx: 18 },
  { dstIdx: 151, mode: 1, srcIdx: 151 },
  { dstIdx: 152, mode: 1, srcIdx: 152 },
  { dstIdx: 153, mode: 1, srcIdx: 153 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 25 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 28 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 31 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 34 },
];

/**
 * The 6 status-icon `DrawMazePiece` calls immediately following, in the
 * separate function at `CODE+0x64ee` (`LAB_036E`) -- not part of the
 * corridor frame itself, kept here for completeness since both were
 * extracted in the same pass.
 */
export const STATUS_ICON_CALLS: DrawMazePieceCall[] = [
  { dstIdx: 0xffff, mode: 0, srcIdx: 346 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 349 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 352 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 361 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 355 },
  { dstIdx: 0xffff, mode: 0, srcIdx: 358 },
];
