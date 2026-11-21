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
| unx-crystaldragon | moved | Recon done 2026-11-21: map is type-derived (64×64 × 8-B cells; type 5 wall, 1 floor, 6 door — rendered, not confirmed); view likely slot-table pieces. One unpacker, `SF` codec decodes 31/31 exactly. Open work: `docs/crystaldragon/TODO.md` | `docs/crystaldragon/amiga/data-structure.md` | 2026-11-21 |
| unx-evilsdoom-aga | moved | Recon done 2026-11-21: fan-fixed CD v1.8 build; no map files — maps live in the per-dungeon state block saved as `SAVE/<slot>/.BEL` etc. (30×30 × 1 B, bit 7 = solid → type-derived; rendered); view likely a slot table (strong hypothesis). All RNC1/CrM2, 236/236 unpack. Open work: `docs/evilsdoom/TODO.md` | `docs/evilsdoom/amigaaga/data-structure.md` | 2026-11-21 |
| unx-hiredguns | moved | Recon done 2026-11-21: maps are a true 3D grid (3 planes of 20×23×23 × 4-B cells, address maths from the exe), walls probably type-derived per voxel plus an authored shape index — a new 3D case for the survey; view likely pre-scaled slot blits (hypothesis). Custom `.gfx` packer open. Open work: `docs/hiredguns/TODO.md` | `docs/hiredguns/amiga/data-structure.md` | 2026-11-21 |
| unx-liberation-cd32 | moved | Recon done 2026-11-21: maps are generated, not stored (CityGen/BuildingGen/PlotGen, LCG seeded `world*16+zone` → stable per zone; 64×64 × 3 layers, hypothesis); view mixes `AmSp` bitmap wall pieces (4 banks, 152 pieces, 71/71 files) with `O3DG` vector objects. Wall model unknown until the generators run. Open work: `docs/liberation/TODO.md` | `docs/liberation/cd32/data-structure.md` | 2026-11-21 |
| unx-perihelion | moved | Recon done 2026-11-21: file names are `Table.Dat` records in hex (96/96); overhead 40×40 tile maps confirmed; first-person dungeons use 352×364 piece atlases, dungeon grid not yet located (lead: type-derived). No palette yet. Open work: `docs/perihelion/TODO.md` | `docs/perihelion/amiga/data-structure.md` | 2026-11-21 |
| unx-dm-therons-quest | deferred: PC Engine CD, not Amiga; `.chd` needs extracting first | Is Dungeon Master: Theron's Quest's dungeon data the DM1 format (a free cross-version oracle for `docs/dungeonmaster-format.md`)? | `data/_unexplored_/Dungeon Master - Theron's Quest (USA).chd` | 2026-11-21 |
| unx-zombi | moved | Recon done 2026-11-21: map is per-cell (`plan` 6 floors × 7×8 grid + `i-lieux` exits, 162/162 reciprocal); view is one 160×80 picture per location (Cyber Paint SEQ). Open work: `docs/zombi/TODO.md` | `docs/zombi/amiga/data-structure.md` | 2026-11-21 |
