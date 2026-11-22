# Ishar game oracle

The Ishar titles' first-person view is drawn by the game's own ALIS
scripts. To check crawl's walker against the game, this directory runs the
retail scripts in [`maestun/alis`](https://github.com/maestun/alis), an MIT-licensed
reimplementation of the ALIS engine by maestun and contributors. A small
harness patch drives it headless and frame-locked. The engine is not a
hardware emulator: it runs the game's bytecode with its own C VM.

Nothing from alis is copied into crawl. The source is fetched at build time
into `build/cache/` (git-ignored). Crawl commits only `harness.patch`, which
adds `src/sys/harness.inc` and hooks it in at six points.

## Build

```sh
bash tools/ishar/oracle/build.sh     # needs git, make, a C compiler, SDL2 dev files
```

The script clones alis at the pinned commit `31b1811`, applies
`harness.patch` and runs `make`. The binary is
`build/cache/ishar-oracle/alis/build/alis`.

## Use

```sh
npx tsx tools/ishar/oracle/sweep.ts ishar  --poses 60 --seed 1   # random poses in CONT1
npx tsx tools/ishar/oracle/sweep.ts ishar2 --poses 30
npx tsx tools/ishar/oracle/sweep.ts ishar3 --poses 60                # Maz, under the virtual clock
npx vitest run tools/ishar/__tests__/oracle-parity.test.ts         # fixed sample + a real walk
```

- **Game files.** Each title's retail files are copied into
  `build/cache/ishar-oracle/data/<game>/`. The game writes into its own
  directory (`alis.state`), so the oracle never runs on `data/`.
- **Boot.** The first run plays a scripted boot (clicks and keys, keyed by
  frame number) and saves an alis state at the first in-game frame. Later
  runs start from that state.
- **Poses** (`capturePoses`). Each pose pokes the party row and column, sets
  the facing one turn to the left, then clicks the game's "turn right"
  arrow. The game wakes its scene scripts and redraws, exactly as on a real
  turn. The harness then dumps the frame (`.ppm`) and the live display list
  (`.spr`: entities, screens, and every sprite with its owner, slot offset,
  depth, mirror flag and screen box).
- **Walks** (`captureWalk`). A walk clicks the game's own arrows with nothing
  poked, so every game rule runs as in play: walkability, sub-zones, grid
  loads and region changes.
- **Comparison** (`compare.ts`). Crawl's `IsharScene`
  (`tools/shared/ishar-scene.ts`) is fed the same sequence of states. It is
  then compared per pose on:
  - placements, as a multiset of (script, directory slot, x, y, z,
    mirrored);
  - pixels of the view window.

  Sprites from non-scenery entities (wandering NPCs and monsters) are left
  out of the placement count. The "masked" pixel rate also leaves out their
  boxes. `sweep.ts` also prints a null control, which compares crawl's pose
  i against the game's pose i+1.

## Harness commands

`$ALIS_HARNESS` names a command file with lines of the form
`<frame> <cmd> [args]`:

- `click X Y`, `rclick`, `move`, `up` — mouse input;
- `key SDLKEY`, `keyup` — keyboard input;
- `poke` / `pokew` / `peek` / `memdump` — main-segment memory, at hex
  offsets;
- `derefdump OFF N NAME` — dumps the data of an indirect engine-3.0 array,
  whose handle is at main offset OFF (for example, Ishar 3's grid buffer B
  at `0x14ae`);
- `derefpoke OFF IDX VAL` — writes byte IDX (decimal) of such an array
  (for example, a gate value 100 into Ishar 3's buffer B to drive a trip);
- `dump NAME` — writes the frame and the display list;
- `save`, `mark`, `quit`.

These variables change how it runs:

| Variable | Effect |
|---|---|
| `ALIS_HARNESS_FAST=1` | Removes the frame and loop sleeps. |
| `ALIS_HARNESS_VCLOCK=N` | Drops the SDL timer. The 50/60 Hz timer routine (`alis.timeclock`, palette fades) instead runs N times per presented frame. Host tick/delay calls (film and audio pacing) also become virtual. Timer-paced games then run deterministically in fast mode. Ishar 3 uses `VCLOCK=1` (`OracleTitle.env`). |
| `ALIS_HARNESS_MS=1` | Keys commands to wall-clock milliseconds instead of frames. This is not deterministic; it was only used before the virtual clock existed. |
| `ALIS_HARNESS_TRACE=1` | Logs every script load, start, wake-up and kill. |
| `ALIS_HARNESS_WATCH=hexoff,...` | Reports which script changed a main-segment byte. |

## Caveats

- **Independence.** Crawl's ALIS interpreter (`tools/shared/alis-interp.ts`)
  was written partly from the alis sources as a reference. Agreement
  therefore shows that crawl reproduces alis. It is not fully independent
  proof that both match the original Amiga engine. The two codebases share
  no code.
- **Ishar 3.** Ishar 3 boots deterministically under `ALIS_HARNESS_VCLOCK=1`
  in about one second. Only its start town (Maz) has a scene spec so far.

`ALIS_HARNESS_NOENT=name,...` (`captureWalk(..., { noNpcs: true })`, names from
the title's `npcScripts`) kills those entities whenever they are alive, between
script activations. That changes the game: use it only for long scenery walks
that roaming NPCs would otherwise block or turn into fights.

Read-back walks: `captureLegWalk(game, plan, outDir, opts)` plays a walk in
legs. Each leg starts from the savestate the previous one saved, in a
private hard-linked copy of the game directory (the shared boot state is
never touched). `plan` returns the next leg's actions and expected states
(`tools/ishar/oracle/route.ts` plans them on the CONT grids with the
title's step test). The harness command `expect OFF VAL` holds all further
input once a main-global byte differs, so a leg stops where the game
stopped following it. Use `startState`/`finalState` to chain walks and
`legCommands` for per-leg pokes. A walk from a mid-game savestate must give
the scene the game's sub-zone (`crawlWalk(..., startZone)`; Ishar 1 dumps
`0x3eac` as `zone` each step, and a walk whose first action is a turn
takes it from there).

`ALIS_HARNESS_STRCMP=1` logs the engine's string compares and key reads,
with the script and pc of each `ogetkey`. That is how the Ishar 1 CONT3
manual-protection answer table (MONSTRE.DO) was found.


Manual-protection prompts (Ishar 1, `manual.ts`): `isharManualTable` reads the
8-entry answer table a protection script builds (MONSTRE.DO for CONT3,
TELEP.DO for the CONT5 cave mouth). `answerManualPrompt(game, stateIn,
stateOut, words, lead)` plays `lead` from a savestate (the engine does not
save while the prompt waits), types each word and keeps the first one after
which a turn click works. The prompt runs in real time, about 60 s per try,
and a wrong word waits out the 150 s timeout, so pass the likely word first.

Ishar 3 gate trips (`build/cache/ishar-oracle/states/i3-foret5.state`, the
forest after a trip): GERDEP `+0xe04` sends MAIN message 38 when the party
steps forward onto a grid-B cell of 100 (the gates are on CONT2-3 to CONT6-3).
MAIN `+0x3cdc` then picks the destination from the region and location
(`+0x41ed`), plays SPACE2 and loads the new region. Region 1 (CONT1-3) has no
gate cell, so the oracle drives a trip by setting the location to 13 and
writing 100 into buffer B in front of the party (`derefpoke 14ae 163 100` at
the new-game start, facing west): the party arrives in the forest (region 5,
CONT4-3) at (3,5). Caveat: every savestate load advances Ishar 3's game
clock by hours (the clock is not in the saved state the same way), so
multi-leg walks jump through day and night; use single-leg walks for
measurements.
