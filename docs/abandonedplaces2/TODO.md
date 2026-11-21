# Abandoned Places 2 (Amiga) — open work

Single status surface. Spec: `docs/abandonedplaces2/amiga/data-structure.md`. Plan: `docs/abandonedplaces2/plan.md`.
The shared unpacker row lives in `docs/abandonedplaces/TODO.md` (`ap-artgame-unpacker`).

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ap2-tileset-triplets | open | Decode `.bpl` via `.def`/`.ofs` (colour planes + mask plane; plane order; UI triplets without a mask) into atlases with `set_NN.clr` palettes | data-structure.md § 5 | 2026-11-21 recon |
| ap2-dng-cells | open | Decode `dng_NN.dat` cell bytes 0–4 + byte-5 flags `0x40`/`0x80`, and the 8 trailing blocks (objects/monsters/events) | data-structure.md § 3 | 2026-11-21 recon |
| ap2-slot-dest-table | open | Find the slot destination coordinates (where each `.def` record lands in the 192×135 view) in `main` | data-structure.md § 5 | 2026-11-21 recon |
| ap2-misc-gfx | open | `.ani` (37,260), `bank*.bpl` + `.cfs`, `pic_NN`, `chrset*` fonts | data-structure.md § 2 | 2026-11-21 recon |
