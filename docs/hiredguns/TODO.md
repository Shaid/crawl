# Hired Guns — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| hg-map-planes | open | Decode the 3 voxel-plane cell fields (20×23×23×4 B at `+0x6F40`, `+0xA8E8` stride) and which way z runs | amiga/data-structure.md § "Maps" | 2026-11-21 recon |
| hg-map-header-objects | open | Map header words `w0`/`w1`/`w4` and the `+0x22EC` 28-byte object/event records (internal offsets) | amiga/data-structure.md § "Maps" | 2026-11-21 recon |
| hg-gfx-packer | open | Custom packer of `CharactersGfx`/`MonstersGfx` `.gfx` (`0x7790…` stream); oracle = ILBM + `MakeFigure/Filters` | amiga/data-structure.md § "Character/monster .gfx" | 2026-11-21 recon |
| hg-figure-records | open | Shared figure-record grammar (`Figure.dump`, Styles, Misc, Items) | amiga/data-structure.md § "Figure records" | 2026-11-21 recon |
| hg-view-renderer | open | First-person slot table: which cell offsets (incl. z±1) draw which Style record | amiga/data-structure.md § "Character/monster .gfx" (walker question 2) | 2026-11-21 recon |
| hg-banks-audio-text | open | `GameFast`/`GameChip`/`ExtraSfx` offset banks, front-end `.dat` screens, text banks | amiga/data-structure.md § "Inventory by family" | 2026-11-21 recon |
| hg-dev-archive | blocked:user to supply the July 2021 Hired Guns dev archive (Internet Archive), if wanted | Authoritative source for map/packer/renderer | amiga/data-structure.md § "Prior art" | 2026-11-21 recon |
