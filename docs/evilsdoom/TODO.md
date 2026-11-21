# Evil's Doom — open work

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| evilsdoom-scaffold | open | RNC1 depack is on demand in `tools/evilsdoom/amigaaga/export-walker.ts` (`unpacked()`, `ancient`); still missing: a full-tree depack step and the CrM2 `OMD/PCH.DAT` | plan.md § Phase 0 | 2026-11-21 |
| evilsdoom-newgame-state | open | Which file/code seeds a new game's dungeon state (copied from `8(A6)+$EB38`) | amigaaga/data-structure.md § Dungeon maps | 2026-11-21 recon |
| evilsdoom-eve | open | `EVE/*` per-level decoration banks (descriptor list + pixels) and `.MAIN` | amigaaga/data-structure.md § First-person view | 2026-11-21 recon |
| evilsdoom-pic | open | `PIC/*` headerless CMAP+BODY: codec and geometry (plain ByteRun1 sizes inconsistent) | amigaaga/data-structure.md § PIC | 2026-11-21 recon |
| evilsdoom-mon | open | `MON/*` monster sprite banks | amigaaga/data-structure.md § Other families | 2026-11-21 recon |
| evilsdoom-ui | open | `DMD`/`OMD` icon/font/page banks, `DUNDAT` panels, `INT/*.bin` screens | amigaaga/data-structure.md § Other families | 2026-11-21 recon |
| evilsdoom-music | open | `MUZ/P60.*` as signature-less P60A (reuse hunter's decode) | amigaaga/data-structure.md § Prior art | 2026-11-21 recon |
| evilsdoom-text | deferred:after maps | `OMD/TXT.DAT`, `CT/*` text/script records | amigaaga/data-structure.md § Other families | 2026-11-21 recon |
| evilsdoom-level-lists | open | The four per-level lists stored with each grid (BEL A6+`$4512/$4516/$451A/$451E`, set in the level routines `+0xE3AA..`): record shapes and meaning (objects, doors, events?) | amigaaga/data-structure.md § Dungeon state block — framing | 2026-11-21 |
| evilsdoom-stairs | open | Confirm bit-2 cells = stairs (list at A6+`$791A`, `+0xBA0C`, 10-B records) and the up/down links; walker does not follow stairs and starts non-saved levels on the first bit-2 cell (hypothesis) | amigaaga/data-structure.md § Dungeon state block — framing | 2026-11-21 |
| evilsdoom-doors | open | Draw doors (draw-list cmds 2/5/6, 14-B masked descriptors at A6+`$3C4C`, `DOR/*` banks) and decode the door objects (`+0x4B2C`, byte +3 = `$0A` open) so closed doors block; walker treats bit-3 cells as open and undrawn | amigaaga/data-structure.md § First-person view — walls | 2026-11-21 |
| evilsdoom-decor | open | Wall decorations / floor items / objects: draw-list cmds 1/2/4/7/8/9 (`+0xAB72` tests bits 1/3/4/5/6), `EVE/<dng>.<n>` + `.MAIN` banks | amigaaga/data-structure.md § First-person view — walls | 2026-11-21 |
| evilsdoom-mirror-phase | open | Walker's step-mirror phase is (x+y+facing) parity relative to the start pose; the real phase depends on moves since module entry. In-game check: from the saved start, does one step forward show the mirrored wall art? | amigaaga/data-structure.md § First-person view — walls | 2026-11-21 |
| evilsdoom-cll-pristine | open | No byte-pristine `.CLL`; walker uses slot B (max solid cells, party on L0). Find the new-game seed (see `evilsdoom-newgame-state`) to replace it | amigaaga/data-structure.md § Dungeon state block — framing | 2026-11-21 |
