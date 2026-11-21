# Abandoned Places (Amiga) — open work

Single status surface. Spec: `docs/abandonedplaces/amiga/data-structure.md` (renderer: section 7). Plan: `docs/abandonedplaces/plan.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ap1-entities | open | Decode the 10 object lists (wall objects/items from `item`, doors, monsters) and the handler table `0xB046` (object-group draw entries) so the walker can draw them; doors still do not block | data-structure.md § 7.4 | 2026-11-21 game-re |
| ap1-wallset-art | open | Decode `wallN.M`/`blockN.M`/`doorN.M`/`stairsN`/`gateN`/`switchN`/`buttonN`/`carpetN.M`/`cupboardN` geometry (object-draw tables around `module` 0xC250..0xC6FF, 0xB0EE..0xB5D0, blit 0xD84A/0xD962) | data-structure.md § 7.2 | 2026-11-21 game-re |
| ap1-forest | open | The 8 `level_forest*` levels use the separate 116 KB `forest` engine (outdoor view); locate its renderer tables | data-structure.md § 4 | 2026-11-21 game-re |
| ap1-start-poses | open | Confirm start pose of dungeon 1 level 1 ((2,25) facing 0 is the entrance record's destination) and arrival poses of levels >1 (taken from teleports pointing at them) against the real game | data-structure.md § 7.4 | 2026-11-21 game-re |
| ap1-view-spill | open | Pieces 11/13/20 spill 10 px outside the 144 px window; walker clips, original overdraws then redraws the frame (0xDED6/0xDFCE) | data-structure.md § 7.3 | 2026-11-21 game-re |
| ap1-palette-plane5 | open | Fade table vs copper constants differ at indices 5/8/15; which applies when the 5th bitplane is set | data-structure.md § 7.2 | 2026-11-21 game-re |
| ap1-gfx-families | open | Decode `monsterN`, `bpl.*` (small header), `ABIC.*` (40,064 = 64 + 40,000?), `sp*`, `icon*`, fonts | data-structure.md § 4 | 2026-11-21 recon |
| ap1-group-field | open | Meaning of the directory's u16 group field (0–9) | data-structure.md § 2 | 2026-11-21 recon |
