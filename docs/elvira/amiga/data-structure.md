# Elvira: Mistress of the Dark (Amiga) — data structure reference

Horrorsoft/Adventure Soft, 1990. AGOS-family engine (ScummVM `GType_ELVIRA1`).
First-contact pass, 2026-09-02.

Container + codec: **`docs/agos-pkd-format.md`** (shared by Elvira, Elvira
II, and Waxworks — read that doc first; this page only covers what's
specific to Elvira 1). Implementation: `tools/shared/agos-vga.ts` +
`tools/shared/agos-vga-export.ts`. Extractor:
`tools/elvira/amiga/export-data.ts`. Open items: `docs/elvira/TODO.md`.

Raw data: `data/elvira/amiga/data/` (130 `.pkd`/`.out` files + several
`*tune` files), plus `Manual`, `Maps`, `Cluebook`, `Solution`, `ReadMe`
(scanned text/manual resources, out of scope) and `Elvira.slave` (a
WHDLoad slave — no format info per `whdload-slave-no-format-info.md`).

## 1. Zone inventory

65 zones (`data/elvira/amiga/data/NN1.pkd` + `NN2.pkd`, zone ids observed:
1, 2, 3, and a contiguous run 6-74 — not perfectly contiguous from 1,
matching however Elvira's scene graph actually numbers its rooms; ids
4-5 simply have no `.pkd` pair). All 65 zones have both a type-1 and
type-2 file; 62 decode with at least one real picture (3 zones' `vga2`
anim tables are empty — text/sound-only rooms, e.g. inventory or dialogue
screens with no static background).

`.out` "type 3" sound files present for a handful of zones (`013.out`,
`033.out`, `093.out`, `243.out`, `253.out`, `263.out`, `273.out`,
`283.out`, `313.out`, `413.out`, `503.out`, `513.out`, `543.out`,
`563.out`, `573.out`, `613.out`, `643.out`, `663.out`, `693.out`) — see
`docs/agos-pkd-format.md` §4, undecoded.

`1tune`, `4tune`, `7tune`, `8tune`, `9tune`, `10tune`, `14tune` — un-probed,
likely tracker-module music, not part of the `.pkd` naming scheme. Also
present and unexamined: `gameamiga` (likely the AmigaOS executable),
`icon.dat`, `runit`/`start` (likely launch scripts).

## 2. Pictures — CONFIRMED, 1,124 images decoded across 62 zones

Format, codec, palette scale: all identical to `docs/agos-pkd-format.md`
§§1-3 — nothing Elvira-1-specific needed. `colorDepth = 4` (16 colours)
throughout; every sampled image uses palette bank 0.

Image sizes range from small UI/inventory icons (16x21, 16x11) up through
full 224x127 scene pictures. Zone 64 (`641.pkd`/`642.pkd`) is a 16-frame,
224x127 sequence — almost certainly a cutscene or ambient-animation loop
(a moving element inside an otherwise-static jungle backdrop), not
individually confirmed as such since no VC-opcode script trace was done
this pass.

**Visual verification** (see `public/assets/elvira/amiga/screens/`):
- `zone022_img1.png` / `zone023_img1.png` — a garden path and a walled
  flowerbed courtyard, consistent with Elvira's gothic-mansion setting.
- `zone064_img1.png` — a jungle/swamp scene with reeds and water
  reflections (the specific render also used to settle the palette-scale
  question — see `docs/agos-pkd-format.md` §2).

## 3. Output

```
public/assets/elvira/amiga/
  textures/zoneNNN.png + .json   -- one atlas per zone, every image in
                                     that zone's vga2 anim table (shelf-
                                     packed, tools/shared/atlas-pack.ts)
  screens/zoneNNN_imgI.png       -- the single largest image from the 40
                                     biggest zones (quick visual sample)
  palettes/zoneNNN.json          -- each zone's 16-colour bank-0 palette
  data/zones.json                -- full zone/image table (id, offset,
                                     w/h, flags, compressed)
```

## 4. Still open

See `docs/agos-pkd-format.md` §4 for the shared open items (`.out` sound
format, `vga1` non-palette content, palette multi-slot compositing) — all
apply here unchanged. Elvira-1-specific: `*tune` music files (see §1);
zone-graph/room-name semantics (which zone id is which named room — no
script trace done); the 16-frame zone-64 animation's real playback
mechanism.
