---
title: Disk Layout
description: Which files ship on which floppy disk.
---

# Disk Layout

The game shipped on three 880 KB floppy disks. The layout is a hard constraint
that corroborates how the tilesets are selected: the disk a level's tileset
lives on always matches the level's own disk.

| Disk 1 (`GAMEDISK1:`) | Disk 2 (`GAMEDISK2:`) | Disk 3 (`GAMEDISK3:`) |
|----------------------|----------------------|----------------------|
| `bcdfa`, `bcdfo` | `bcdfb`, `bcdfc`, `bcdfd` | `bcdff`, `bcdfg`, `bcdfh` |
| `bcdfp`, `bcdfq` | `bcdfe`, `bcdfm`, `bcdfn` | `bcdfi`, `bcdfj`, `bcdfk` |
| `bcdfr`, `bcdfs`, `bcdft` | `bcdfu`, `bcdfv`, `bcdfx` | `bcdfl`, `bcdfy`, `bcdfz` |
| `bcdfw` (icon) | — | — |
| `configuration.dat` | — | — |

## Why the disk layout matters

The per-level monster stores (`bcdfb`–`bcdfn`) and the tilesets are opened by
name from the decompressed `bcdft` image, using a patched `"bcdf?"` template.
The two volume strings `"GAMEDISK2:"` and `"GAMEDISK3:"` also live in that
decompressed image, and the level-entry routine `PEA`s whichever one the
current level needs before opening its tileset.

Notice the pattern:

- **GAMEDISK2** carries `bcdfb`–`bcdfe`, `bcdfm`, `bcdfn` (levels 1–4, 12, 13)
  and exactly one tileset, **`bcdfx`**.
- **GAMEDISK3** carries `bcdff`–`bcdfl` (levels 5–11) and exactly two tilesets,
  **`bcdfy`** + **`bcdfz`**.

No level ever needs a tileset from the other disk.

## ADF images

Three ADF images exist at `data/blackcrypt/amiga/adf/`, each 901,120 bytes
(standard 880 KB DD). They have a valid Amiga OFS/FFS filesystem with the root
block at sector 880.

## `bcdfw` — the odd one out

`bcdfw` (457 B) starts with the bytes `E3 10 00 01` — the standard AmigaOS
`DiskObject` magic (`0xE310`) + version 1. It's a **Workbench drawer icon**, not
tileset data. The installer program `InstallCrypt` copies it to the destination
during setup so the newly created game folder gets a custom Workbench icon. It
is never opened by the running game.