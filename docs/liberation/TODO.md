# Liberation: Captive II — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| lib-gen-harness | open | Run CityGen/BuildingGen under a 68k harness and dump the 3×4 KB grid planes for (world, zone) | cd32/data-structure.md § "1. How is the map stored?" | 2026-11-21 recon |
| lib-gen-grid-format | open | Decode the 3 byte-planes (city 64×64; interiors variable width): wall encoding per-cell / shared-edge / type-derived? | cd32/data-structure.md § "1. How is the map stored?" | 2026-11-21 recon |
| lib-world-seed-origin | open | Where is the 14-bit `world` word at A5+0x626C first set — fixed per level or random per new game? | cd32/data-structure.md § "1. How is the map stored?" | 2026-11-21 recon |
| lib-vgm-slot-table | open | Map the 152 VGM pieces (4 banks) to view slots; find the renderer behind captiveII +0x251DE | cd32/data-structure.md § "2. How is the first-person view drawn?" | 2026-11-21 recon |
| lib-vgm-palette | open | Find the 16-colour palette(s) for 4-plane wall art (and confirm gamemenu.spr's 32-colour trailer) | cd32/data-structure.md § `AmSp` | 2026-11-21 recon |
| lib-city-view-mix | open | Is the outdoor city vector-only, or VGM pieces + vector buildings? | cd32/data-structure.md § "2. How is the first-person view drawn?" | 2026-11-21 recon |
| lib-o3dg-chunks | open | Decode FORM O3DG/VCDO chunks (OFFS, EXVL, PLST, VSPR, VFTX) | cd32/data-structure.md § `FORM O3DG` | 2026-11-21 recon |
| lib-imga | open | Decode ImgA sprite-bank entries (MainSp, 3dView, taxi, backpack) | cd32/data-structure.md § `ImgA` | 2026-11-21 recon |
