# Zombi — plan

Format detail lives in `amiga/data-structure.md`; open items in `TODO.md`.
Retail files: `data/zombi/amiga/data/`.

## Shape of the game (recon answer)

- **Map:** 90 locations (`i-lieux`); `plan` places ids 1–86 on a 6-floor
  7×8 grid, and ids 87–90 are off-grid vehicle views. Each location
  storing its own four horizontal exits plus up/down (`i-lieux`) —
  **per-cell** faces, values open/door/wall/edge. Converts straight into the
  `@seer-project/dungeon` per-cell model; the grid file is only placement.
- **View:** **one pre-drawn 160×80 picture per location** (`LIEUX.SEQ`),
  no per-facing variants and no wall mosaic; objects (`objet.seq`) and
  zombies (`z.seq`/`skins.seq`) are presumably blitted over it. A walker
  for this game is a picture-per-node viewer with compass exits, not a
  frustum renderer.

## Phases

0. **Scaffold** — done (commit 59b2d29): `zombi` registered in
   `src/game-id.ts` and `tools/shared/game-config.ts`.
1. **SEQ extractor** (`seq-cyberpaint`) — done (commit fa5decf):
   `tools/shared/cyberpaint-seq.ts` + `npm run zombi:export` emit atlases and
   screens for all 11 files. Upstream candidate still open: a Cyber Paint SEQ
   decoder belongs in `@seer-project/gfx` (ST-era art shipped unconverted in
   other ports too).
2. **Map export** (`zombi-map`) — `plan` + `i-lieux` → per-cell level JSON.
   Needs the compass orientation (`zombi-exit-orientation`) from the
   executable (the location→picture table is done, commit fa5decf:
   `data/location-pictures.json`). Use `Agent: amiga-disasm` on `zombi`; find the `i-lieux`/`plan` loaders via
   their filename strings.
3. **Objects/zombies** — `i-objets`, `i-lieux` slot bytes 10..41, sprite
   placement over the picture. Oracle: rendered pictures with obvious
   object positions + in-game screenshot.
4. **Audio** — MODs via `@seer-project/tracker`; `.SON` → WAV (trivial).
5. **State/text** — `zombi.sys`, `francais.txt`, `keymap`; low value.

Pitfalls to read before phase 2: `file-offsets-vs-segment-relative.md`,
`check-that-cannot-fail-is-not-evidence.md`, `rle-decode-succeeds-on-garbage.md`
(the SEQ decode passed closure — pictures confirm it, but keep the check).
