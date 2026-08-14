# Might & Magic II: Gates to Another World — integration plan

## Ground truth

This game's reverse engineering is a **finished project** and is treated as
ground truth rather than re-derived:

- **Repo:** https://github.com/Vairn/MM2 (shallow clone at `/tmp/opencode/MM2` when the
  integration session ran).
- **Key locations:** `EXTRACTED/docs/` (~60 format documents), `EXTRACTED/decomp/`
  (round-trip C codecs), `EXTRACTED/mm2.capstone.asm` (68k disassembly — the
  repo's own "source of truth"), `tools/` (~250 RE tools), `wiki/`.
- **License / porting permission:** Vairn/MM2 has no license file, but the
  project owner (Vairn — the author of that RE project, brother of this
  repo's owner) has granted explicit permission to reimplement his findings
  in this Seer project as TypeScript. crawl's `tools/mm2/` codecs may
  therefore be **direct, faithful ports** of Vairn's C/Python reference
  implementations (with attribution), not just re-derivations from the docs.
  The original integration pass still wrote `tools/mm2/` as original TS
  informed by the docs; later ports (e.g. the PC DOS `.4`/`.16` codecs) may
  port the reference codecs directly. Format descriptions in
  `docs/mm2/amiga/data-structure.md` cite the per-format source doc.

The one caveat: Vairn's docs explicitly say *"docs can be wrong — the ASM is
the source of truth."* Everything we port is marked **Confirmed / Observed /
Unknown** in their docs, and crawl's verification ledger (`docs/mm2/TODO.md`)
records what we could re-verify against real bytes.

## Data gap

The Vairn/MM2 repo contains **no retail game data** (its `.gitignore` is a
whitelist that excludes it). Retail files must be supplied by the user.

Retail data for this repo already exists (gitignored) at
`data/mm2/amiga/data/` — 72 `.anm`, 27 `.32` (plus the `globe.32`/`disk.32`
XOR blobs), all 8 `.dat` files, and the `Manual`/fonts/`assign` floppy extras.
Place flat files directly in `data/mm2/amiga/` if preferred; the pipeline
(`tools/shared/game-config.ts`) searches recursively under `mm2/amiga` for
`items.dat`/`map.dat`.

## What this pass integrated

| Area | Deliverable |
|------|-------------|
| Layout | `data/mm2/amiga/`, `public/assets/mm2/amiga/`, `docs/mm2/` |
| Framework registration | `src/game-id.ts`, `tools/shared/game-config.ts`, `tools/shared/viewer-config.ts` |
| Docs | `docs/mm2/amiga/data-structure.md` (formats), this plan, `docs/mm2/TODO.md` |
| Codecs (`tools/mm2/`) | `.32` image, `.anm` TV, items, monsters, roster, spells, str, map, attrib, event, **PC DOS `.4`/`.16` (LZW + wall/monster)** |
| CLIs | `tools/mm2/export-data.ts` (dat → JSON), `tools/mm2/decode-graphics.ts` (.32/.anm → PNG atlases/strips), `tools/mm2/decode-pc-graphics.ts` (.4/.16 → PNG atlases/monster strips) |
| Verification | 47 unit tests + 11 real-data tests; the repo stays green |

## Quickstart

```bash
# Decode every .dat file present in <dataDir> to public/assets/mm2/amiga/data/
npm run mm2:data

# Decode every .32 sheet / .anm animation to PNG atlases / strips
npm run mm2:gfx
```

## Next pass candidates

See `docs/mm2/TODO.md`. The PC DOS `.4`/`.16` codecs are **done** (verified
byte-exact against Vairn's reference on the GOG data at `data/mm2/dosega/`);
the `globe.32` copy-protection XOR decode and the `event.dat` opcode-VM
disassembler are also **done** (see `docs/mm2/TODO.md` for both — the globe
key needed a one-byte correction vs Vairn's own reference script, and the
event script region turned out to be a sequence of per-handler segments
rather than one flat stream, both found via this repo's own real-data
verification). Remaining highest-value items: composed `.anm` walk sequences
as GIFs (combat engine block selection is the only gap — the longest-block
heuristic works for showcase), and the GOG `STR.DAT`/`MONSTERS.DAT`/
`ATTRIB.DAT` LZW wrapper (confirmed byte-exact, not yet ported — `ITEMS.DAT`
turns out not to be LZW-wrapped at all and is already decodable with the
existing Amiga codec, see `docs/mm2/dosega/data-structure.md`).
