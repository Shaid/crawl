# Perihelion — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| peri-scaffold | open | Register `perihelion` in `src/game-id.ts` + game config; extractor that parses `Table.Dat` and labels files | plan.md § Step 0; data-structure.md § File naming scheme | 2026-11-21 recon |
| peri-audio | open | Extract 15 MODs (split `map.wind` at 8,758), 13 8SVX, IFF ANIM/ILBM banks | data-structure.md § Inventory by family | 2026-11-21 recon |
| peri-palette | open | Locate tile/wall/picture palettes (main program `$0RGB` tables; test the two 112×150 CMAPs at +0x32A9A/+0x33AFE on the portraits) | data-structure.md § Palettes | 2026-11-21 recon |
| peri-overhead-maps | open | Promote the 16 overhead maps + 6 tilesets (structure confirmed) to an extractor; colour once a palette is found | data-structure.md § Overhead maps | 2026-11-21 recon |
| peri-pictures | open | Extract 28 portraits (112×150×5) + 6 location pictures (240×130×5), row-interleaved | data-structure.md § Inventory by family | 2026-11-21 recon |
| peri-dungeon-grid | open | Decode the dungeon grids (candidate: main program +0x72D80–0x73DC0, several 0/1 maps of varying width) and classify wall storage | data-structure.md § Dungeon maps | 2026-11-21 recon |
| peri-view-slots | open | Find the piece-rectangle/slot table that blits the 352×364 wall atlases into the first-person view | data-structure.md § Wall atlases | 2026-11-21 recon |
| peri-selfpacked | open | Depack `005810FA00005344` (own header: 40,000 unpacked / 21,315 packed); find the decruncher in `Boot.Exe` | data-structure.md § File naming scheme | 2026-11-21 recon |
| peri-misc-banks | open | Identify `0277022E…` sfx bank, `map.wind` tail, `01461308…`, `00770EA4…`, `022917F6…`, `00020000…`, `01640A96…` | data-structure.md § Inventory by family | 2026-11-21 recon |
| peri-ingame-check | blocked:user screenshots | One town (overhead) and one dungeon view (Watchtower Colony start) to confirm palette and slot placement | plan.md § Phase 2/4 | 2026-11-21 recon |
