# Abandoned Places 2 (Amiga) — plan

Spec: `docs/abandonedplaces2/amiga/data-structure.md`. Open work: `docs/abandonedplaces2/TODO.md`.
The container and packer are shared with AP1 (spec: `docs/abandonedplaces/amiga/data-structure.md`
§2–§3). The shared unpacker is done (`tools/shared/artgame-kernel.ts`, commit 09a59a1).

## Phase 0 — scaffold (done)
- `abandonedplaces2` / `amiga` registered in `src/game-id.ts` and
  `tools/shared/game-config.ts`; data at `data/abandonedplaces2/amiga/` (commit 59b2d29).

## Phase 1 — unpack (trivial once the AP1 tool lands)
- Done (commit 09a59a1, `tools/abandonedplaces/unpack.ts`): parse `ap2.dir` (5 sections;
  sections 0–3 map to `ap2.000`–`.003`) and unpack all 617 records (593 distinct names). Oracle: 262/262 checksum + consumption, 4/4 section-end = file size.

## Phase 2 — palettes (easy)
- `set_NN.clr` / `*.clr` = 32 × 12-bit words. Pair each tileset with its set's
  palette. Oracle: screenshots; colours on `pic_NN.bpl` should look natural.

## Phase 3 — tileset triplets → atlases (easy-medium; self-describing)
- Done (commit 09a59a1, `tools/abandonedplaces2/amiga/export-tilesets.ts`): `.bpl` with
  `.def` geometry, colour planes then a trailing mask plane (mask-last confirmed; flags bit 0
  marks masked records), 1,962/1,962 invariant — supersedes the recon's 1,476/1,520
  (spec §5). Pitfall:
  `fixed-stride-record-count-unverified.md` does not apply, because sizes come from
  the records. But check for a stored-plane-order surprise: render greyscale first.

## Phase 4 — dungeon levels + walker (medium)
- Decode the `dng_NN.dat` cell bytes 0–4 and the eight trailing blocks (spec §3) from
  `main`'s level loader (`amiga-disasm`, HUNK). Wall model = type-derived (byte 5 bit 0);
  convert to per-cell faces on import. Find the slot destination table in `main` and
  build a slot-table walker (`@seer-project/dungeon` DrawItem composite, as Black
  Crypt does).

## Phase 5 — monsters/objects/items/text/audio
- `mon_NN`/`obj_NN` use the same triplet grammar. `item.dat`/`itemdesc.dat` tables.
  Text files are plain. Audio = ProTracker `M.K.` + TFMX.

## seer packages
- `@seer-project/amiga` (HUNK), `@seer-project/gfx` (planar), `@seer-project/tracker` (MOD).
