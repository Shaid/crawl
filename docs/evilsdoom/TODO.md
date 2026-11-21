# Evil's Doom — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| evilsdoom-scaffold | open | RNC1/CrM2 depack layer into `build/cache/evilsdoom/` (data moved to `data/evilsdoom/amigaaga/` and game registered 2026-11-21) | plan.md § Phase 0 | 2026-11-21 |
| evilsdoom-map-record | open | Dungeon state block framing: levels per file, grid offsets, pre-grid word lists, cell bit meanings, start position | amigaaga/data-structure.md § Dungeon maps | 2026-11-21 recon |
| evilsdoom-newgame-state | open | Which file/code seeds a new game's dungeon state (copied from `8(A6)+$EB38`) | amigaaga/data-structure.md § Dungeon maps | 2026-11-21 recon |
| evilsdoom-view-slots | open | Decode the 14-B view-slot blit table (`BEL.dat+0x16834`): field meanings, plane count, mask layout | amigaaga/data-structure.md § First-person view | 2026-11-21 recon |
| evilsdoom-wal | open | Render `WAL/*.DT0/DT1` + `DOR/*` via the slot table; find the dungeon palette | amigaaga/data-structure.md § First-person view | 2026-11-21 recon |
| evilsdoom-eve | open | `EVE/*` per-level decoration banks (descriptor list + pixels) and `.MAIN` | amigaaga/data-structure.md § First-person view | 2026-11-21 recon |
| evilsdoom-pic | open | `PIC/*` headerless CMAP+BODY: codec and geometry (plain ByteRun1 sizes inconsistent) | amigaaga/data-structure.md § PIC | 2026-11-21 recon |
| evilsdoom-mon | open | `MON/*` monster sprite banks | amigaaga/data-structure.md § Other families | 2026-11-21 recon |
| evilsdoom-ui | open | `DMD`/`OMD` icon/font/page banks, `DUNDAT` panels, `INT/*.bin` screens | amigaaga/data-structure.md § Other families | 2026-11-21 recon |
| evilsdoom-music | open | `MUZ/P60.*` as signature-less P60A (reuse hunter's decode) | amigaaga/data-structure.md § Prior art | 2026-11-21 recon |
| evilsdoom-text | deferred:after maps | `OMD/TXT.DAT`, `CT/*` text/script records | amigaaga/data-structure.md § Other families | 2026-11-21 recon |
