# MM2 — Might & Magic II: Gates to Another World (Amiga)

RE integration for the crawl monorepo. Format work is ported from the
**Vairn/MM2** ground-truth project (https://github.com/Vairn/MM2 — a finished RE
of this exact game); see `docs/mm2/index.md` for provenance and the data gap.

## Getting real data in place

The Vairn/MM2 repo ships **no retail game data**. Put your own MM2 Amiga files
here:

```
data/mm2/amiga/            <- flat files (items.dat, map.dat, town.32, 1.anm, ...)
data/mm2/amiga/data/       <- or nested exactly like the original floppy layout
                              (already populated on this machine)
```

The framework config (`tools/shared/game-config.ts`) finds the files
recursively under `mm2/amiga` by looking for `items.dat` / `map.dat`.

Generated assets go to `public/assets/mm2/amiga/` (gitignored).

## Quickstart

```bash
npm run mm2:data   # tools/mm2/export-data.ts   data/mm2/amiga/data
npm run mm2:gfx    # tools/mm2/decode-graphics.ts data/mm2/amiga/data
```

## Docs

- `docs/mm2/index.md` — plan, ground truth, data gap
- `docs/mm2/amiga/data-structure.md` — the format reference
- `docs/mm2/TODO.md` — verification ledger + open work
