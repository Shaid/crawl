/**
 * Eye of the Beholder (Amiga) `.INF` -- level -> wall-set association
 * only, not a full parser.
 *
 * The Amiga `.INF` files in this corpus are **plain text-embedded**, not
 * LCW-compressed the way `docs/eotb/amiga/eotb-inf-spec.md`'s generic
 * "the .inf files are standard CPS files" claim implies -- confirmed
 * empirically this session (`strings data/eotb/amiga/LEVEL1.INF` shows
 * readable `level1.maz`, `brick`, `kobold`, `leech` directly in the raw
 * bytes). The Amiga `Inf` struct layout differs from the ModdingWiki
 * DOS-era struct's field offsets (the `mazeName`/wall-set-stem strings
 * don't start where that struct says), so rather than reverse a new
 * Amiga-specific header layout this pass does the pragmatic thing: scan
 * the raw bytes for one of the 5 known EOB1 wall-set name tokens. Verified
 * against the whole corpus: all 12 `LEVEL*.INF` files resolve to exactly
 * one of BRICK/BLUE/DROW/GREEN/XANATHA, matching the wall-set files that
 * actually exist in `data/eotb/amiga/`. A real header parse (monster
 * spawns, decoration/event scripts) is out of scope, same as this game's
 * other still-open `.INF` items in `docs/eotb/TODO.md`.
 */
const WALL_SETS = ['BRICK', 'BLUE', 'DROW', 'GREEN', 'XANATHA'] as const;
export type WallSet = (typeof WALL_SETS)[number];

export function findWallSet(infData: Uint8Array): WallSet {
  const text = Buffer.from(infData).toString('latin1').toUpperCase();
  for (const name of WALL_SETS) {
    // Match as a standalone NUL/word-bounded token, not a substring of something else.
    const re = new RegExp(`(^|[^A-Z])${name}([^A-Z]|$)`);
    if (re.test(text)) return name;
  }
  throw new Error(`findWallSet: no known wall-set token found in INF data (looked for ${WALL_SETS.join('/')})`);
}
