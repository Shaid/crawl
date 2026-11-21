# Perihelion — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| peri-scaffold | open | Extractor that parses `Table.Dat` and labels the 96 files (data moved to `data/perihelion/amiga/` and game registered 2026-11-21) | plan.md § Step 0; data-structure.md § File naming scheme | 2026-11-21 |
| peri-audio | open | Extract 15 MODs (split `map.wind` at 8,758), 13 8SVX, IFF ANIM/ILBM banks | data-structure.md § Inventory by family | 2026-11-21 recon |
| peri-palette | open | In-game palette solved ($E7BDE, 2026-11-21). Still open: palettes of the portraits / location pictures / intro (try the two 112×150 CMAPs at +0x32A9A/+0x33AFE) and confirm the overhead maps use $E7BDE (renders coherent) | data-structure.md § First-person dungeons → Palette | 2026-11-21 |
| peri-overhead-maps | open | Promote the 16 overhead maps + 6 tilesets (structure confirmed) to an extractor; colour with the in-game palette `$E7BDE` (overhead renders are coherent with it) | data-structure.md § Overhead maps | 2026-11-21 recon |
| peri-pictures | open | Extract 28 portraits (112×150×5) + 6 location pictures (240×130×5), row-interleaved | data-structure.md § Inventory by family | 2026-11-21 recon |
| peri-selfpacked | open | Depack `005810FA00005344` (own header: 40,000 unpacked / 21,315 packed); find the decruncher in `Boot.Exe` | data-structure.md § File naming scheme | 2026-11-21 recon |
| peri-misc-banks | open | Identify `0277022E…` sfx bank, `map.wind` tail, `01461308…`, `00770EA4…`, `00020000…` (`022917F6…` solved 2026-11-21: dungeon 1's atlas), `01640A96…` | data-structure.md § Inventory by family | 2026-11-21 recon |
| peri-ingame-check | blocked:user | Compare walker frames with the game: see data-structure.md § First-person dungeons → In-game checks | walker frames in build/cache/perihelion/walker-frames/ | 2026-11-21 |
| peri-door-locks | open | Decode the door-lock table (`$C4C98` list, 12-B records: x, y, lock type, tick range; `$BD374`/`$BD3CC`) so locked doors stay shut without the key/code; the walker currently toggles every door | data-structure.md § First-person dungeons | 2026-11-21 |
| peri-ladders-exits | open | Decode the teleport/ladder table (`$C4CA0` list, used by `$BDD0E`: x, y → new x, y within tick ranges) and wire ladders (4/5) and exits (6) into the walker | data-structure.md § First-person dungeons | 2026-11-21 |
| peri-dungeon-events | open | Event / zone lists of the `$C4C86` struct (`$C4C8C`, `$C4C90`, `$C4C94` music zones, `$C4C9C`, `$C4CA4`..`$C4CB0`) and the `$F4112` square-event table: messages, NPCs, monsters | data-structure.md § First-person dungeons | 2026-11-21 |
| peri-overhead-walker | open | The overhead 40×40 maps are a separate top-down mode (not the dungeon grids): find their loader/scroller and the map↔location links, then add them as walker levels (`renderCanvas`, tile + passability planes) | data-structure.md § Overhead maps | 2026-11-21 |
| peri-dungeon-names | open | Level names are the music-module titles (`innercity`, `inside.colony` …); find the in-game location names (fan maps suggest Watchtower Colony = dungeon 2) | games-perihelion.ts | 2026-11-21 |
