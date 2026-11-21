# Abandoned Places 2 (Amiga) — plan

Spec: `docs/abandonedplaces2/amiga/data-structure.md`. Open work: `docs/abandonedplaces2/TODO.md`.
The container and packer are shared with AP1 (spec: `docs/abandonedplaces/amiga/data-structure.md`
§2–§3). Do AP1's `ap-artgame-unpacker` first; AP2 reuses it unchanged.

## Phase 0 — scaffold (not done by recon)
- Register `abandonedplaces2` / `amiga` in `src/game-id.ts` and the game config with
  the first extractor. Data stays at `data/_unexplored_/abandonedplaces2/` until moved.

## Phase 1 — unpack (trivial once the AP1 tool lands)
- Parse `ap2.dir` (5 sections; sections 0–3 map to `ap2.000`–`.003`) and unpack all
  617 records. Oracle: 262/262 checksum + consumption, 4/4 section-end = file size.

## Phase 2 — palettes (easy)
- `set_NN.clr` / `*.clr` = 32 × 12-bit words. Pair each tileset with its set's
  palette. Oracle: screenshots; colours on `pic_NN.bpl` should look natural.

## Phase 3 — tileset triplets → atlases (easy-medium; self-describing)
- Decode `.bpl` with `.def` geometry: colour planes plus a trailing mask plane (spec §5,
  1,476/1,520 invariant). Work out the plane order (mask last vs first) and the UI
  triplets without a mask. Pitfall:
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
