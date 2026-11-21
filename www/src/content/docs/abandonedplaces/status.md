---
title: Status & Open Work
description: What is solved and what remains open for Abandoned Places - A Time for Heroes (Amiga) - the ArtGame container and packer are done; the level record, renderer, palettes and art are not.
---

Abandoned Places has had one recon pass (2026-11-21) and one committed tool,
the shared ArtGame unpacker (commit `09a59a1`). The container and packer are
finished. Everything that depends on reading pixels or game code is open.

| Area | Status | Evidence |
|---|---|---|
| Disk layout (DIC images, `AP1n` tags, kernel at `Disk.1+0x404`) | **Confirmed** | 5/5 disk tags; directory at `Disk.1+0x5800` |
| ArtGame directory (454 records, 5 sections) | **Confirmed** | 454/454 records unpack or are stored-exact; 0 contiguity breaks |
| ArtGame packer (backward LZ) | **Confirmed, committed** | 427/427 AP1 and 262/262 AP2 packed records: `chk == 0`, input consumed, size exact. `tools/shared/artgame-kernel.ts` |
| Directory group field (0–9) | Hypothesis | Looks like a load/purge class |
| Level grid (32×32 words) | **Rendered** | 44/44 records with solid borders; coherent at width 32 |
| Wallset id at level `+2048` | Hypothesis | Wallset-to-disk split holds for 36/36 dungeon levels |
| Rest of the level record (8,866 B) | Open | Not decoded |
| First-person renderer | Hypothesis (slot table) | Art is headerless; no geometry found |
| Palettes | Open | Candidate 64-B `ABIC.*DATA` files not yet tested |
| Wallset art, monsters, `bpl.*`, `ABIC.*`, fonts | Open | Sizes and families listed; no pixels decoded |
| Text | Standard | Plain ASCII once unpacked |
| Music / SFX | Standard | TFMX `mdat.*`/`smpl.*` pairs |
| Published assets | None | No image family decoded yet |

## Open work

- What does the 10,916-byte level record hold past the 32×32 grid: is `+2048`
  the wallset id, where are the objects, monsters, events and start pose, and
  what do the cell flags `0x4000` and `0x2000` mean? `ap1-level-record`
- Where is the first-person slot table (the destination of each piece per depth
  and side) for the headerless `wallN.M`/`blockN.M`/`doorN.M` art: in the
  21,330-byte `moduleN` files or in `module`? `ap1-renderer-slots`
- Where are the dungeon, town and cut-scene palettes: the 64-byte `*DATA` files,
  or tables in the code? `ap1-palettes`
- How are `monsterN` (22,040 B), `bpl.*` (small header), `ABIC.*` (40,064 =
  64 + 40,000?), `sp*`, `icon*` and the fonts laid out? `ap1-gfx-families`
- What does the directory's u16 group field (0–9) mean? `ap1-group-field`

## What you can check in-game

The notes do not list in-game checks for this title yet. The plan names in-game
automap screenshots as the oracle for the level grid, and screenshots or the
manual's colour plates for the palettes.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/abandonedplaces/TODO.md)
for evidence pointers, and [the overview](../) for the format details.
