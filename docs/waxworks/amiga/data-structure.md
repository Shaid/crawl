# Waxworks (Amiga) — data structure reference

Horrorsoft/Adventure Soft, 1992. AGOS-family engine (ScummVM `GType_WW`).
First-contact pass, 2026-09-02.

Container + codec: **`docs/agos-pkd-format.md`** (shared by Elvira, Elvira
II, and Waxworks — read that doc first). Implementation:
`tools/shared/agos-vga.ts` + `tools/shared/agos-vga-export.ts`. Extractor:
`tools/waxworks/amiga/export-data.ts`. Open items: `docs/waxworks/TODO.md`.

Raw data: `data/waxworks/amiga/data/` (298 `.pkd`/`.OUT` files, zones
0-155, 4-digit filenames — `NNN1.pkd`/`NNN2.pkd`/`NNN3.OUT`), plus
`Manual`, `Solution`, `ReadMe` (out of scope) and `Waxworks.Slave`
(WHDLoad slave).

## 1. Zone inventory — the largest corpus of the three games

156 zones, ids 0-155 fully contiguous. **15 zones have only a type-1
file** (no picture at all — `data/agos-pkd-format.md`'s picture-less-zone
convention, here at a higher rate than Elvira 1/2: zones 10, 20, 21, 22,
24, 32, 34, 35, 85, 89, and 5 more — likely pure-text/dialogue or
transitional "rooms"). Of the remaining 141 zones with both files, 126
decode with at least one real picture (15 more have empty `vga2` tables).

2,318 images decoded corpus-wide — the largest single-game count of the
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
- `MENUS.DAT`, `stripped.txt` — un-probed.
- Music: `0tune`-`2tune`, `7tune`-`10tune`, `23tune`-`26tune` (same
  un-probed family as Elvira 1's `*tune`).
- `gameamiga` (likely the AmigaOS executable), `runit`/`start` (likely
  launch scripts), `saves/` (save games, out of scope).

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
undecoded lead across all three games; `.OUT` sound files (same undecoded
format as Elvira 1/2, present here as `NNN3.OUT`).
