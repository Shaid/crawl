# Elvira: Mistress of the Dark (Amiga) — data structure reference

Horrorsoft/Adventure Soft, 1990. AGOS-family engine (ScummVM `GType_ELVIRA1`).
First-contact pass, 2026-09-02.

Container + codec: **`docs/agos-pkd-format.md`** (shared by Elvira, Elvira
II, and Waxworks — read that doc first; this page only covers what's
specific to Elvira 1). Implementation: `tools/shared/agos-vga.ts` +
`tools/shared/agos-vga-export.ts`. Extractor:
`tools/elvira/amiga/export-data.ts`. Open items: `docs/elvira/TODO.md`.

Raw data: `data/elvira/amiga/data/` (130 `.pkd` + 19 `.out` files + several
`*tune` files), plus `Manual`, `Maps`, `Cluebook`, `Solution`, `ReadMe`
(scanned text/manual resources, out of scope) and `Elvira.slave` (a
WHDLoad slave — no format info per `whdload-slave-no-format-info.md`).

## 1. Zone inventory

65 zones (`data/elvira/amiga/data/NN1.pkd` + `NN2.pkd`, zone ids:
1-3, 6-9 and 17-74; ids 4-5 and 10-16 have no `.pkd` pair). All 65 zones
have both a type-1 and type-2 file and **all 65 have pictures**.

> **Correction (2026-11-18):** this section said "a contiguous run 6-74"
> and that 3 zones' `vga2` tables were empty. Both wrong: the ids are 1-3,
> 6-9, 17-74 (zones 10-16 missing), and the "empty" tables came from the
> truncated early-stop table walk (`docs/agos-pkd-format.md` §3 correction).
> The full-table walk finds pictures in 65/65 zones.

`.out` "type 3" sound files present for a handful of zones (`013.out`,
`033.out`, `093.out`, `243.out`, `253.out`, `263.out`, `273.out`,
`283.out`, `313.out`, `413.out`, `503.out`, `513.out`, `543.out`,
`563.out`, `573.out`, `613.out`, `643.out`, `663.out`, `693.out`) — see
`docs/agos-pkd-format.md` §4, undecoded.

`1tune`, `4tune`, `7tune`, `8tune`, `9tune`, `10tune`, `14tune` —
`simon_decr`-compressed ProTracker modules (format solved 2026-11-18,
`docs/agos-pkd-format.md` §4; extractor pending). `gameamiga` is the game
database (items/rooms/exits/subroutines), **not** the executable — that is
`runit`; `icon.dat` is the icon file, `start` the rest file (§4 there).
`.out` files: 12-byte BE records `[u16 0][u16 size][u16 0][u16 id][u32 offset]`
of signed 8-bit PCM (19/19 tile to EOF).

## 2. Pictures — CONFIRMED, 1,654 images decoded across 65 zones

> **Correction (2026-11-18):** previously "1,124 images across 62 zones" —
> truncated by the early-stop table walk; see `docs/agos-pkd-format.md` §3.
> Colours: per-zone bank-0 palette is *rendered*, not verified against the
> scripts (Elvira 1 loads 13 zone colours + the engine's `extraColors`;
> `docs/agos-pkd-format.md` §2 correction).

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


## Walker groundwork — `gameamiga` and VC dialect probes (2026-11-21)

Not decoded; findings so far (Elvira II's walker, `docs/elvira2/amiga/data-structure.md` §5, was built first):

- `data/gameamiga` (218,977 B) is stored **plain** (`simonDecr` throws) and has the Elvira II header: `u32 itemCount-2 = 0x36B`, `u32 0x80`, a junk word, `u32 stringCount = 0x2B1`, `u32 textSize = 0x48C5`, text, then items from `file+0x48D9`.
- Items are **variable length**, not Elvira II's record. First fixed part: `u32 name, u16 adjective, u16 noun, u16 state, u16 ?, 3 x u32 item refs (next/child/parent), u32 ?`, then a child tail whose first word counts 1, 2, 3, 4 ... down the first items and which holds a `0x26` flag word and further `u16` values. The `readGamePc` item reader does **not** parse it (a fixed 44-byte stride fails: 875 items would end at `+0xDF3D` in the middle of items).
- `runit` holds a 242-entry operand-grammar table at the same signature (`readGrammarFromExe` works unchanged); ops 1-7 are one item operand, so it is not Elvira II's table.
- VC scripts: see the 2026-11-21 follow-up below -- the table now **converges (750/750)** and is committed.


## Walker follow-up -- VC table solved, `gameamiga` layout refined (2026-11-21, later)

**VC opcode lengths -- confirmed 750/750.** `ELVIRA1_VC_PARAM_BYTES`
(`tools/shared/agos-vc.ts`): coordinate ascent (ops 1-79, 0-14 parameter bytes,
re-scoring all 750 segments of the 65 zones per trial) from the better of the
Waxworks/Elvira II tables ends every script exactly on its successor's start
(750/750). The first pass stalled at 747 because it only varied a subset of ops;
the converged table differs from both other dialects on ~40 ops (the Waxworks
table scores 54/750 here, Elvira II's 57; a wrong draw length 594; a wrong
`setPalette` length 705 -- `tools/walker/__tests__/games-elvira.test.ts`).
Visual check: composing zone 22's ten picture scripts (2200-2209) with it gives
coherent garden pictures (stone walls, hedge arches, plank doors, brick tunnel),
so the draw/palette/conditional lengths are right. Ops that only drive timing or
animation are pinned by the termination oracle alone.

**No 8-bit-opcode script block exists in any Elvira 1 data file.** Scanning
`gameamiga` (every even offset from the item start), `start`, `icon.dat` and
`runit` with `readSubroutineBlock` under nine operand-width variants (item
operand u16 / special+u16 / special+u32, text likewise) finds no block (best 4-5
subroutines of noise; `runit` +0xC48E "72 subs" is the executable's 68k jump
table). `start` is a saved-state image (same `0000 036C` item-count header).

**`gameamiga` layout (refined, still undecoded).**
- Items start at `+0x48D9` (**odd offset**: every record is at an odd file offset). Record = `u32 name, u16 adj, u16 noun, u16 state, u16 0, 3 x u32 item refs` (24 B) + a tail of 6-80 B whose commonest length is 70-72 B. Every tail carries a pointer word pair `0026 xxxx` (heap address `0x267FBC`, `0x267FFC`, ... increasing with the item index; later `0027 b11c`...) whose successive differences (0x40, 0x10, 0x6C, ...) look like the original runtime sizes of each item's child blocks -- an oracle available for any proposed child grammar (not yet used). Type-2 objects use the Waxworks scheme: `0002, u32 flags, popcount(flags) u16 values, u16 0` (flags `0x1DF` => `u32` + 7 `u16`) -- tiles item tails exactly in the cases checked by hand.
- From about `+0x15F40` to EOF the records change character: **4,013 aligned `0x2710` words** (10000) in 0x15F61-EOF, each ending a short run of words (`0087 0001 0001 0000 027C 0030 0001 0062 2710`). **Hypothesis:** 10000 is the old AGOS end-of-line marker of 16-bit-opcode script lines and this tail is the subroutine block (the `elvira-gamepc` note "then 16-bit-opcode subroutine blocks"). Parsing it with u16 opcodes and u16 operands per the `runit` grammar finds no block from any start, so the operand widths (or the line/sub framing) differ from the guess.
- The `0x00E0 <2200..>` property pairs inside that tail (e.g. `00E0 0898 0004`) carry zone-22 picture ids (2200-2209, 0x898-0x8A1): the room -> picture association is in this tail, so the walker needs it.

**Walker status: blocked.** Pictures (VC scripts) now compose, but the room graph
(room children of the items) and the room -> picture selection are in the
undecoded tails/script block. Smallest next step: decode the tail grammar
using the `0026 xxxx` pointer deltas as the size oracle, then re-read the
`0x2710` region.
