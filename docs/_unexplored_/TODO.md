# `data/_unexplored_/` — open work

Undecoded dungeon crawlers sitting in `data/_unexplored_/`. Triage evidence is in
`probe-recon.md` (this folder); genre checks are in
`../walker-map-format-future-decision.md` § "Second sweep (2026-08-15, part 2)".
First step for each is a `re-recon` pass (inventory, prior art, ranked plan). Each
recon should answer the two walker questions: which wall-storage model (per-cell,
shared-edge, type-derived, or something new), and which renderer shape.

Dungeon Master, Chaos Strikes Back, DM2 and Bard's Tale 1–3 also have data here, but
they're already decoded (`docs/dungeonmaster*`, `docs/chaosstrikesback`,
`docs/bardstale*`), so they have no rows.

| ID | Status | Question | Evidence | Updated |
|----|--------|----------|----------|---------|
| unx-abandonedplaces | open | Recon Abandoned Places (ArtGame 1992, "plays like Dungeon Master"): mount the 5 standard `DOS\0` ADFs, inventory, find the dungeon grid and wall model | `probe-recon.md` § Per-game profiles | 2026-11-21 |
| unx-abandonedplaces2 | open | Recon Abandoned Places 2 (ICE 1993): are the `.000`–`.003` files disk images? Same engine as AP1? | `probe-recon.md` § Per-game profiles | 2026-11-21 |
| unx-crystaldragon | open | Recon Crystal Dragon (Magnetic Fields 1994): 221 hex-named extensionless files (index/archive pattern, unprobed) | `probe-recon.md` § Per-game profiles | 2026-11-21 |
| unx-evilsdoom-aga | open | Recon Evil's Doom (Olympia 1996, AGA): 394 files, extensionless + `.bin`/`.dat`, 3 plain ILBMs | `probe-recon.md` § Per-game profiles | 2026-11-21 |
| unx-hiredguns | open | Recon Hired Guns (DMA Design 1993): grid map format behind its 4 viewports; `.gfx` ×38 + character ILBMs | `probe-recon.md` § Per-game profiles | 2026-11-21 |
| unx-liberation-cd32 | open | Recon Liberation: Captive II (CD32 1994): grid-stepped but vector-rendered (`FORM O3DG` objects, `AmSp` wall graphics, `.sty` packed) — which renderer shape is it? | `probe-recon.md` § Cross-corpus wins, § Per-game profiles | 2026-11-21 |
| unx-perihelion | open | Recon Perihelion (Psygnosis 1993): hash-named files with embedded 8SVX banks; find the map data | `probe-recon.md` § Cross-corpus wins | 2026-11-21 |
| unx-dm-therons-quest | deferred: PC Engine CD, not Amiga; `.chd` needs extracting first | Is Dungeon Master: Theron's Quest's dungeon data the DM1 format (a free cross-version oracle for `docs/dungeonmaster-format.md`)? | `data/_unexplored_/Dungeon Master - Theron's Quest (USA).chd` | 2026-11-21 |
| unx-zombi | open (lower priority) | Recon Zombi (Ubi Soft 1990): not an RPG, but movement is grid-stepped — `plan` (336 B) reads as 8-wide rows of 86 unique location ids (hypothesis), with `i-lieux` (4,500 B) and `LIEUX.SEQ` (334 KB) the likely location index and pictures. Confirm the grid, exits and facing; is the view one pre-drawn picture per location/facing? | `probe-recon.md` § Cross-corpus wins; decision doc § "2026-11-21 review" | 2026-11-21 |
