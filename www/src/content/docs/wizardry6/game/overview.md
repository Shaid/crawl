---
title: Game & Platforms
description: The Wizardry 6 release family and its resource layout.
---

# Game & Platforms

Wizardry 6 is represented here as one game with three materially different
resource environments. The Amiga version is the primary disassembly target;
the DOS/EGA release confirms the shared lineage and platform substitutions;
the SNES cartridge is a separately mapped engine and data layout.

| Platform | Corpus | Role in the research |
|----------|--------|----------------------|
| Amiga | `data/wizardry6/amiga/` — 117 files | Primary format and loader oracle; the `Bane` executable exposes the resource and dungeon-view consumers. |
| DOS/EGA | `data/wizardry6/dosega/` | Shared-format comparison, endian-swap and overlay-loader study, plus CGA/Tandy variants. |
| SNES | `data/wizardry6/snes/` | Independent 65816/PPU implementation with its own tile banks, palettes, maze tables, audio driver and first-person composer. |

## Amiga file families

The Amiga directory is unusually regular for a game of this size:

- `Bane` is a standard AmigaOS HUNK executable with a code hunk, a small data
  hunk and a small BSS reservation.
- `mon00.pic`–`mon58.pic` and `CREDITS.PIC` use the same confirmed cel
  directory and sparse 8×8-tile payload format.
- `DRAGONSC.EGA`, `GRAVEYRD.EGA` and `TITLEPAG.EGA` are fixed full-screen
  images, distinct from the variable-record `mazedata.ega` art bank.
- `WFONT0-4.EGA` and `WPORT1-3.EGA` hold fonts and portrait strips.
- `misc.hdr`, `msg.hdr`, `scenario.hdr` and `master.hdr` index the database
  family; `scenario.dbs`, `newgame.dbs`, `pcfile.dbs` and `msg.dbs` hold the
  game tables, messages and character state.
- `SOUND00.SND` through the numbered sound files are the Amiga audio corpus.

## Platform relationship

The DOS build is not a simple byte-for-byte copy: its `.PIC` files add a block
RLE layer and its executable uses a DOS overlay architecture. The platform
variants are still valuable because the shared file names, dimensions, table
shapes and loader conventions constrain one another.

The SNES version should not be forced into the Amiga schema. Its useful shared
concept is the game content — dungeon levels, monsters, messages and view art —
while its storage is native SNES tile/VRAM/PPU data.
