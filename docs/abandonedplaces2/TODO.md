# Abandoned Places 2 (Amiga) — open work

Single status surface. Spec: `docs/abandonedplaces2/amiga/data-structure.md`. Plan: `docs/abandonedplaces2/plan.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ap2-dng-cells | open | Decode `dng_NN.dat` cell bytes 0–4 + byte-5 flags `0x40`/`0x80`, and the 8 trailing blocks (objects/monsters/events) | data-structure.md § 3 | 2026-11-21 recon |
| ap2-slot-dest-table | open | Find the slot destination coordinates (where each `.def` record lands in the 192×135 view) in `main` | data-structure.md § 5 | 2026-11-21 recon |
| ap2-misc-gfx | open | `.ani` (37,260), `bank*.bpl` + `.cfs`, `pic_NN`, `chrset*` fonts | data-structure.md § 2 | 2026-11-21 recon |
| ap2-image-palettes | open | Palette for 5-plane images (`mon_*`, `onwl_*`, `items`, `fire`, …; indices 16–31) and the depth/torch ramp in indices 12–15; set palettes only cover 0–15 | data-structure.md § 5 "Export + palettes" | 2026-11-21 game-re |
