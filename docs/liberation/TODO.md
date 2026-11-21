# Liberation: Captive II — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| lib-world-seed-origin | partial | New game (+0x22756) sets zone 8 and leaves `world` (A5+0x1D7A) at its BSS 0 unless the `(12944,A5)` restore record supplies one; how `world` advances during play (PlotGen missions) is open — the walker exports world 0 only | cd32/data-structure.md § "City generation oracle" | 2026-11-21 walker |
| lib-o3dg-chunks | open | Decode FORM O3DG/VCDO chunks (OFFS, EXVL, PLST, VSPR, VFTX) | cd32/data-structure.md § `FORM O3DG` | 2026-11-21 recon |
| lib-imga | open | Decode ImgA sprite-bank entries (MainSp, 3dView, taxi, backpack) | cd32/data-structure.md § `ImgA` | 2026-11-21 recon |
| lib-walker-objects | open | Draw city vector objects (doors/signs via +0x27C5C, `(2012)` handlers +0x267B8.., people/droids) in the walker | cd32/data-structure.md § "City view composer" | 2026-11-21 walker |
| lib-walker-layers | open | Follow stairs/ramps (flags bit 3, +0x24648) and drops (bit 4) between underworld / street / roof layers; walker is street-only | § "City view composer" — Collision | 2026-11-21 walker |
| lib-walker-anim | open | Motion frames (banks 1-3, slot tables +0x2BC62/+0x2C58A/+0x2CC84) and the type-6 texture animation `(2836,A5)` | § "City view composer" | 2026-11-21 walker |
| lib-buildinggen | open | Run BuildingGen in the harness (already loaded) for interiors; building wall set via +0x36A24, tables +0x27B04/+0x266F8 | § "1. How is the map stored?" | 2026-11-21 walker |
| lib-vgm-banks123 | open | Confirm banks 1-3 are the move/turn transition art (only bank 0 is used by the walker) | § `AmSp` | 2026-11-21 walker |
