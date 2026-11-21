# Perihelion: The Prophecy (Amiga) — plan

Format detail lives in `docs/perihelion/amiga/data-structure.md`; open work in `docs/perihelion/TODO.md`. This file only orders the work.

## Step 0 — scaffold (not done; recon touches no code)

- Register game id `perihelion` (platform `amiga`) in `src/game-id.ts` and add a `defineGameConfig` entry in `tools/shared/game-config.ts`.
- Data location: the retail files stay at `data/_unexplored_/Perihelion/` until the user moves them to `data/perihelion/amiga/`. Extractors should take the directory as an argument.
- The file-naming scheme is solved (`Table.Dat` records). The first extractor should parse `Table.Dat` and label every file by disk/track/type, instead of hard-coding hex names.

## Phase 1 — standard formats (easy, no oracle needed beyond the format itself)

- 15 ProTracker MODs → `audio/` (`@seer-project/tracker`). `map.wind` carries extra data after the MOD, so split at the closure size (8,758).
- 5 standalone 8SVX + 8 in the main program + IFF ANIM/ILBM in the intro bank and the two ANIM files (`@seer-project/iff`).
- Oracle: size closure / IFF chunk walk.

## Phase 2 — overhead maps + tilesets (easy; structurally confirmed already)

- Decode 6 tilesets (16×16×5, row-interleaved) and 16 maps (40×40 tile plane + 40×40 passability plane), using the pairing table in the spec.
- Oracle: seam continuity (have: 0.59–0.65 against a 0.35 null). Add the fan maps / screenshots once a palette exists.
- **Blocker: palette.** Search the main program for 32-word `$0RGB` tables near the map/tileset loaders, or ask the user for a screenshot of one town.
- Walker relevance: these are top-down maps, not first-person. The passability plane is the collision grid.

## Phase 3 — pictures (easy geometry, palette-blocked)

- 28 portraits (112×150×5) and 6 location pictures (240×130×5) are row-interleaved. Try the two 112×150 CMAPs in the main program (+0x32A9A, +0x33AFE) on the portraits first.
- `005810FA…` needs the game's own decruncher (header `0000 9C40 0000 5343`). Find it in `Boot.Exe` (22.5 KB); emulate rather than reimplement if it isn't a known packer (`ancient` first).

## Phase 4 — first-person dungeons (the walker work; medium–hard)

1. **Dungeon grids**: decode the candidate span in the main program at +0x72D80…+0x73DC0 (several 0/1 maps, varying widths) and the record table before it. Find the reader in the main program's code (68k, absolute load; entry `JMP $0B7454`). Agent: `amiga-disasm`. The load address isn't known yet; the slave's patch addresses are a free file↔runtime mapping (lesson `whdload-slave-no-format-info.md`).
   Oracle: the fan ILBM maps in `Docs/` (Watchtower Colony 1/2, Security Zone; City of Midlight may be an overhead map instead).
2. **View rendering**: find the piece-rectangle/slot table for the 352×364 wall atlases (same code area). Then reproduce one view against a user screenshot.
3. Classify wall storage for `docs/walker-map-format-future-decision.md` (expected type-derived; verify).

## Phase 5 — remaining banks

`0277022E…` sfx bank (named samples), `map.wind` tail (≈189 KB of graphics), `014613080102D68E`, `00770EA40100BAE8`, `022917F60100D8A0`, `0002000001002F30`. Also the game text and logic tables in the main program.

## Pitfalls to watch

- `whdload-slave-no-format-info.md`: use the slave only as an address-mapping oracle.
- `file-offsets-vs-segment-relative.md`: the main program is an absolute-load image (JMP at +0), not a HUNK. Keep file offsets and runtime addresses apart.
- `fixed-stride-record-count-unverified.md`: the 0/1 span is several maps, not one 64×64 grid.
- `check-that-cannot-fail-is-not-evidence.md`: give every render a shuffled-tile or transposed null (as done for the seams).

## Seer packages

`@seer-project/iff` (8SVX/ILBM/ANIM), `@seer-project/tracker` (MOD), `@seer-project/gfx` (row-interleaved planar), `@seer-project/dungeon` (walker, phase 4). No new upstream candidates yet.
