# Abandoned Places (Amiga) — open work

Single status surface. Spec: `docs/abandonedplaces/amiga/data-structure.md`. Plan: `docs/abandonedplaces/plan.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ap-artgame-unpacker | open | Promote the recon-probe directory parser + backward-LZ unpacker to a committed shared tool for AP1+AP2 (427/427 + 262/262 already pass in the probe) | data-structure.md § 2–3 | 2026-11-21 recon |
| ap1-level-record | open | Decode the 10,916-B level record past the 32×32 grid (+2048 wallset id?, objects/monsters/events, start pose) and the meaning of cell flags `0x4000`/`0x2000` | data-structure.md § 5 | 2026-11-21 recon |
| ap1-renderer-slots | open | Find the first-person slot table (destinations per depth/side) for the headerless `wallN.M`/`blockN.M`/`doorN.M`… art; check `moduleN` (21,330 B) and `module` | data-structure.md § 6 | 2026-11-21 recon |
| ap1-palettes | open | Locate the dungeon/town/cut-scene palettes (64-B `*DATA` files, in-code tables) | data-structure.md § 4 | 2026-11-21 recon |
| ap1-gfx-families | open | Decode `monsterN`, `bpl.*` (small header), `ABIC.*` (40,064 = 64 + 40,000?), `sp*`, `icon*`, fonts | data-structure.md § 4 | 2026-11-21 recon |
| ap1-group-field | open | Meaning of the directory's u16 group field (0–9) | data-structure.md § 2 | 2026-11-21 recon |
