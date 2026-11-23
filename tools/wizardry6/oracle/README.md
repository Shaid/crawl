# Wizardry 6 (Amiga) game oracle

Runs individual routines from the retail `Bane` executable under a
[Unicorn](https://www.unicorn-engine.org/) 68000 CPU core and reports what the
game itself draws or decides. It is a single-routine harness, not a system
emulator: there is no custom-chip, OS or disk emulation. The few library and
C-runtime calls the routines make are stubbed in Python: AllocMem, file I/O
served from `data/wizardry6/amiga/`, `BltBitMap` for the four minterms the
view uses, and a no-op `WaitBlit`. The custom-blitter "present" call is
captured as a screen snapshot.

It is the ground truth for `tools/wizardry6/{view-model,evaluate-cell,movement,
export-dungeon-slots}.ts`. Before this harness existed, the walker's
"pixel-exact" claims were only ever checked against crawl's own renders.

## Install

Python 3.10+ with `unicorn` (2.x) and `numpy`:

```sh
python3 -m venv tools/wizardry6/oracle/.venv
tools/wizardry6/oracle/.venv/bin/pip install unicorn numpy
```

The `.venv` folder is git-ignored. The vitest finds the interpreter in this
order: `$W6_ORACLE_PYTHON`, then `tools/wizardry6/oracle/.venv/bin/python`,
then `python3`. It skips cleanly if none of them can import `unicorn` and
`numpy`, or if the retail data or exported assets are missing.

The oracle also needs:

- the retail files under `data/wizardry6/amiga/`. Set `W6_DATA` to use
  another folder.
- the exported level JSONs, which it uses for the walker-to-game coordinate
  mapping: `npm run w6:levels`.

## Use

| What | Command |
|---|---|
| Regression sample (336 poses + 840 moves) | `npx vitest run tools/wizardry6/__tests__/oracle-parity.test.ts` |
| Full view sweep, one level | `tools/wizardry6/oracle/.venv/bin/python tools/wizardry6/oracle/sweep.py --out /some/dir 5` |
| Full view sweep, all levels | the same command with `all` in place of the level number. It runs each level in its own process, so memory is freed between levels. |
| Raw oracle calls | `oracle.py frames\|moves\|arrive IN.json OUT` (see the docstring in `oracle.py`) |

`sweep.py` writes `levelNN.json` files to `--out`. Each one holds per-level
counts plus up to 40 example mismatches, split into:

- **cel**: the game's `.PIC` cel draws differ from the walker's.
- **list**: the walker emits a different maze-piece list or order.
- **geom**: the walker's slot geometry draws a piece differently from
  `DrawMazePiece`.

Do not point `--out` under `data/`.

## Files

- `hunks.py`: HUNK parser.
- `emu.py`: Unicorn wrapper, with library-vector traps and cdecl call/hook helpers.
- `w6.py`: game-state setup:
  - mazedata via the game's loader, maze caches as `newgame.dbs` fills them;
  - resident `.PIC` slots via `LoadPicToSlot`;
  - the drawing BitMap;
  - pose mapping from walker grid coordinates.
- `oracle.py`: CLI for frames, moves and arrival.
- `sweep.py`: full view sweep with the staged mismatch breakdown.
- `walker-frames.mts`: renders walker frames and draw lists for `sweep.py`.

## Game-rules harness (2026-11-23)

`rules.py` is a second entry point on the same `emu.py` core for the *rules*
routines (random generator, level-up, CheckLevelUp through the game's own
`ReadSection`). Window/text callees are replaced by no-ops. `rules.py vectors
OUT.json` writes the committed `rules-vectors.json` that
`tools/wizardry6/__tests__/rules.test.ts` diffs `tools/wizardry6/rules.ts`
against (null controls included). See `docs/wizardry6/amiga/game-rules.md`.
