# Hired Guns — open work

Solved 2026-11-21 and removed from this list: `hg-map-planes` (cell bitfields, z up, plane
offsets), `hg-gfx-packer` (31/31, ILBM byte-exact), `hg-view-renderer` (67-position view from
the retail tables). See amiga/data-structure.md § "Walker pass".

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| hg-walker-ingame-check | open | User screenshots to confirm the walker view, orientation and movement against the real game (checks listed below) | tools/walker/games-hiredguns.ts | 2026-11-21 |
| hg-sky-copper | open | Floppy sky: the copper gradient that recolours colour 6 on the sky rows (walker uses a placeholder blue ramp) and the 4 `horizons` silhouettes (map struct +154+512, 144x32 1bpp) | view.ts `skyColour`; CD32 `Sky.s` is AGA-only | 2026-11-21 |
| hg-view-objects | open | Not drawn yet: player heads (blocks 32..47), grenades/effects (22..31, exgfx), explosions and skeleton remains (Misc.gfx), text-panel overlay (`texts[]`), planet, CD32-only light pools are N/A | view.ts header | 2026-11-21 |
| hg-monsters | open | Monsters: the two MonstersGfx figures (locn mons1/mons2) fill Style slots 12..19 (decoder ready, `recordAt`); spawn comes from eggs (plane 2 `egg_hatch`/`egg_contents`), monsters[] is empty at rest | data-structure § Walker pass | 2026-11-21 |
| hg-movement-specials | open | Teleport (block 6), boost (2), exit (3), lifts (`lifts[]`, floor 2/variant), pushables, buttons (`buttons[]`), door keys/button-only doors are reported but not acted on; doors open instantly | model.ts | 2026-11-21 |
| hg-random-flip | open | Placements with control -1 are drawn unflipped (the game flips at random per frame from VHPOSR) | view.ts `blit` | 2026-11-21 |
| hg-map-header-objects | open | Remaining `struct map` tables: explosions, text triggers, buttons, lifts, pushables (offsets known, semantics not wired) | amiga/data-structure.md § Walker pass | 2026-11-21 |
| hg-figure-records | partial | Figure records = Style records (confirmed for CharactersGfx); still open: `Face.dump`, Items.gfx, the remaining Misc.gfx entries | amiga/data-structure.md | 2026-11-21 |
| hg-banks-audio-text | open | `GameFast`/`GameChip`/`ExtraSfx` offset banks, front-end `.dat` screens, text banks | amiga/data-structure.md § "Inventory by family" | 2026-11-21 recon |
| hg-dev-archive | open | Keep mining the CD32 dev archive (`data/hiredguns/devarchive/`, gitignored, licence unstated: read for understanding only, no code copied) — check each finding against the floppy retail files | amiga/data-structure.md § "Prior art" | 2026-11-21 |

## In-game checks for the user (hg-walker-ingame-check)

Map 01 "Artificial Island", party member 1's start (x7, y11, z11 = walker level 111):

1. Facing **north** (compass N): grass, two trees close on the left, open sky with two
   small bushes on the horizon ahead/right.
2. Facing **east**: a brown building ahead with a door in the middle, a dirt path leading to
   it, grass either side.
3. Facing **south**: the building's corner close on the right, open grass to the left.
4. Facing **west**: the same building wall close on the left, trees on the right, path ahead.
5. Walk east along the path: three steps to x10, the fourth press opens the side door at
   x11, two more steps reach x12, where a stone staircase rises ahead between brown walls.
   One more step east climbs to x13 on layer z12 (walker level 112).

If 1-4 match with left and right swapped, the walker's handedness is wrong; if the
building is ahead when the compass says north, the facing numbers are rotated.
