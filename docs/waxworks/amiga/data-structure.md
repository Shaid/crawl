# Waxworks (Amiga) — data structure reference

Horrorsoft/Adventure Soft, 1992. AGOS-family engine (ScummVM `GType_WW`).
First-contact pass, 2026-09-02.

Container + codec: **`docs/agos-pkd-format.md`** (shared by Elvira, Elvira
II, and Waxworks — read that doc first). Implementation:
`tools/shared/agos-vga.ts` + `tools/shared/agos-vga-export.ts`. Extractor:
`tools/waxworks/amiga/export-data.ts`. Open items: `docs/waxworks/TODO.md`.

Raw data: `data/waxworks/amiga/data/` (297 zone `.pkd` + `icon.pkd` + 59 `.OUT`, zones
0-155, 4-digit filenames — `NNN1.pkd`/`NNN2.pkd`/`NNN3.OUT`), plus
`Manual`, `Solution`, `ReadMe` (out of scope) and `Waxworks.Slave`
(WHDLoad slave).

## 1. Zone inventory — the largest corpus of the three games

156 zones, ids 0-155 fully contiguous. **15 zones have only a type-1
file** (zones 10, 20, 21, 22, 24, 32, 34, 35, 85, 89, 91, 92, 93, 95, 96).
Of the remaining 141 with both files, 140 decode with real pictures (one has
no valid table entry).

> **Correction (2026-11-18):** (a) the type-1-only zones are **not**
> "pure-text/dialogue" zones. They are exactly the zones where ScummVM's
> `zoneTable[]` = 3 (`zones.cpp:43-86`): they load their `vga2` from zone 18
> (zones < 85) or zone 94 (zones >= 85), the shared first-person **maze**
> graphics. Their scripts draw 1,016 image numbers, all resolving to valid
> entries in `0182.pkd`/`0942.pkd`; zone 41's atlas is first-person corridor
> views. (b) the "15 more have empty `vga2` tables" claim came from the
> truncated table walk. (c) 46 zones declare 0 palette banks; 39 were
> previously exported with noise palettes from header bytes (now greyscale,
> no palette file). (d) the cited path `data/agos-pkd-format.md` never
> existed (it is `docs/agos-pkd-format.md`).

4,381 images decoded corpus-wide (first pass: 2,318 — truncated walk) — the largest single-game count of the
three. Container/codec/palette all identical to Elvira 1
(`docs/agos-pkd-format.md` §§1-3); filename digit width is the only real
difference (`pkdFilename('waxworks', ...)`, 3-digit zone id vs. Elvira's
2-digit).

**Visual verification** (`public/assets/waxworks/amiga/screens/`):
- `zone064_img3.png` — a gold-and-marble Egyptian tomb chamber with two
  sarcophagi/statues and a central altar — matches Waxworks' well-known
  Egyptian wax-exhibit setting.
- `zone147_img3.png` — a stone dungeon/prison wall with a barred window.
- `zone068_img3.png`, `zone044_img1.png`, `zone062_img4.png` — additional
  coherent scene renders among the 40 screen samples.

## 2. Additional un-probed resources

Waxworks' `data/` directory has a much richer non-`.pkd` file set than
Elvira 1/2, not examined this pass:

- `text01`-`text25` — plausibly dialogue/narrative text tables (the
  filename pattern strongly suggests this, but no format/encoding was
  checked).
- `tables01`-`tables16`, `xtable01`-`xtable04`, `tbllist`, `xtbllist` —
  plausibly index/lookup tables paired with the `text*`/`table*` files
  (the `tbllist`/`xtbllist` naming suggests a directory-of-directories).
- `MENUS.DAT`, `stripped.txt` (TEXT index, 25-byte entries) — un-probed.
- Music: `0tune`-`2tune`, `7tune`-`10tune`, `23tune`-`26tune` —
  `simon_decr`-compressed ProTracker modules (solved format; `2tune`/`8tune`/`9tune`/`10tune`
  hold several modules at ScummVM's `amigaWaxworksOffs` offsets).
- `gameamiga` (`simon_decr`-compressed game database: items/rooms/exits/
  subroutines — **not** the executable; `runit` is), `start`, `icon.pkd`, `saves/` (save games, out of scope).

This is the single most promising lead for a follow-up pass — a
`text*`/`table*` pair is a classic string-table + index-table shape, and
Waxworks' dialogue/narration would be genuine, well-documented-horror-genre
game content (a strong `domain-archetype-plausibility-oracle.md`-style
verification target once decoded).

## 3. Output

```
public/assets/waxworks/amiga/
  textures/zoneNNN.png + .json    -- pkd zone atlases (as Elvira 1)
  screens/zoneNNN_imgI.png        -- 40 largest-picture samples
  palettes/zoneNNN.json
  data/zones.json
```

## 4. Still open

See `docs/agos-pkd-format.md` §4 for the shared open items. Waxworks-
specific: the whole `text*`/`table*` family (§2) — the single largest
undecoded lead (Elvira II has the same `text*`/`tables*` family); `.OUT` sound
files (format identified, extractor pending — see `docs/agos-pkd-format.md` §4).
