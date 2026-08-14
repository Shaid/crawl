# MM2 (Amiga) — data structure reference

Might & Magic II: Gates to Another World, Amiga port. Formats ported into
crawl from the **Vairn/MM2** ground-truth repo (https://github.com/Vairn/MM2 — a
*finished* reverse engineering of this exact game), whose source documents are
cited per section. Codec implementations live in `tools/mm2/` and are verified
against the retail files in `data/mm2/amiga/data/` where present (see
`docs/mm2/TODO.md` for the verification ledger).

Ground truth provenance per format:

| Format | Source doc(s) in Vairn/MM2 (`EXTRACTED/docs/`) |
|--------|------------------------------------------------|
| `.32` image | `55-graphics-formats-reference.md` §2–§3 |
| `.anm` TV | `55-graphics-formats-reference.md` §4 |
| `items.dat` | `18-items-dat-format.md` |
| `monsters.dat` | `16-monster-ability-format.md` |
| `roster.dat` | `06-roster-format.md` |
| `spells.dat` | `19-spells-and-item-use.md` |
| `str.dat` | `07-dat-files-and-formats.md` |
| `map.dat` | `21-map-dat-format.md` |
| `attrib.dat` | `12-attrib-dat-format.md` |
| `event.dat` | `06-event-dat-format.md` |

**Endianness rule:** Amiga graphics (`.32`/`.anm`) are big-endian; the `.dat`
record files are **little-endian on disk** (the 68000 runtime byte-swaps
word/long fields on load — e.g. items gold at asm `0x26030`, roster stats at
`0x3290`). The two exceptions are `event.dat`'s location headers (big-endian)
and `attrib.dat`'s 16-bit "complex id" pair (big-endian, though read
byte-wise).

---

## 1. `.32` — image sheet / shared Image Chunk

The shared bitmap container used by `.32` files (at offset 0) and by `.anm`
files (after the TV header). All fields big-endian.

```
+0       u16be       frame_count
+2       u16be       depth_or_mode    -- sheet category tag, NOT a plane count
+4       FrameInfo[] frame_count × 6 bytes
+P       u16be[32]   palette (Amiga 0x0RGB, 4 bits/channel)
+Q       byte[]      one nibble-RLE stream per frame, back to back
```

`FrameInfo` = `{ u16be width, u16be height, u16be flags }`. `flags` is an
opaque blit-variant tag (0 = front-facing, 3 = lateral wall / outdoor
horizon); it must be preserved on round-trip but is ignored for pixel decode.

Every frame is exactly **5 bitplanes**, rows word-aligned:

```
bytes_per_row = ((width + 15) >> 3) & ~1
rassize(w, h) = height * bytes_per_row
frame_bytes   = 5 * rassize(width, height)
```

Pixel index at `(x, y)`: bit `7 - (x & 7)` of byte `y*bytes_per_row + (x>>3)`
in each plane `p` contributes `1 << p`. **Index 0 is the transparency key**
at blit time.

**Nibble-RLE** (flat nibble stream packed MSB-first into output bytes):

```
read byte p; high nibble H = p >> 4
  H == 0x0 or 0xF:  emit nibble H repeated (p & 0x0F) + 1 times   (run)
  otherwise:        emit nibble H, then nibble p & 0x0F            (literal pair)
```

Decoder stops exactly at `frame_bytes`; the encoder reproduces runs of 0x0/0xF
nibbles and literal pairs otherwise.

**Non-image `.32` files:** `globe.32` and `disk.32` are XOR-obfuscated data
blobs, not image chunks — `decodeImage32` rejects them and the exporter
skips them.

### `.32` sheets seen in the retail data

| File | Frames | Role |
|------|--------|------|
| `town.32` | 32 | town walls 0–15 + torch variants 16–31 |
| `townf.32` | 1 | town floor backdrop strip |
| `townt.32` | 27 | town ceiling pieces |
| `intro.32` | 1 | title background |
| `introclips.32` | 11 | title animation cels |
| `desert.32`/`ocean.32`/`outdoor1-3.32`/`swamp.32`/`tundra.32` | 20ish | outdoor horizon layers |
| `book.32` | 1 | spellbook icon (wiki hero image) |
| `outb.32`/`townb.32` | — | auto-map / cartography tiles |

---

## 2. `.anm` — TV animation (combat / world sprites)

```
+0x00  u16be   reserved (0 in retail)
+0x02  u16be   magic "TV" (0x54 0x56)
+0x04..+0x2F   prelude: 11 slots × 4 bytes { x, y, width, height }
               slot i describes stored frame i+1; 0xFF-filled slots unused
+0x30  u8      seq_a  (unknown; observed 19–75; preserve)
+0x31  u8      seq_b  (sequence hint + 0x80 flag — NOT reliable; parse by scanning)
+0x32  u8      seq_c  (unknown; usually 0; preserve)
+0x33..        sequence stream, runs to the `FF 00` marker
FF 00          image-chunk marker — the chunk header begins at the `00` byte
...            standard Image Chunk (§1)
```

**Sequence stream grammar:** `(frame_index, delay)` pairs; each block ends with
`0xFF`. Blocks may be additionally prefixed by `0xFF`; an `FF FF` pair ends all
sequences. `frame_index` is the **composed** state `k` (see below), `0` = base
frame only; `delay` is hold time in game ticks (~60 Hz, 0 = advance next tick).
The parser scans for `FF 00` rather than trusting `seq_b`: retail `02.anm` has
`seq_b = 1` but 5 blocks.

**Composition** (stored frames ≠ displayed frames except frame 0):

```
compose(k):
  draw stored_frame[0] at (0,0), full size
  if k == 0: done
  slot = prelude[k - 1]
  clear canvas[slot.x .. +width, slot.y .. +height]
  blit stored_frame[k] at (slot.x, slot.y), pen 0 transparent
```

Monster `picture id` = `monsters.dat` byte `0x15` masked `& 0x7F` → file
`NN.anm`.

**Verified:** our decoder of the retail `51.anm` reproduces the ground-truth
Vairn/MM2 `EXTRACTED/anm_decoded/51/meta.json` byte-for-byte — image-chunk
offset 76, decode start 180, per-frame RLE consumption
`[1535, 1326, 1321, 1342, 1336, 1328]`, both sequence blocks, and the 5 prelude
slots — and every decoded plane byte-matches the ground-truth's own `planeN.bin`
files (see `tools/mm2/__tests__/real-data.test.ts`).

---

## 3. `items.dat` — 256 × 20 bytes = 5120

| Off | Field | Notes |
|-----|-------|-------|
| `0x00` | name | 12-byte ASCII, space-padded |
| `0x0C` | separator | editor writes 0 |
| `0x0D` | forbidden-class mask | **set bit = class CANNOT use**; `K P A C S R N B` = `0x80..0x01` |
| `0x0E` | bonus | hi nibble = type (0 Might … 15 AC), lo nibble = amount (0 = none) |
| `0x0F` | effect | **flat spell index**, NOT a type/amount pair (see §6) |
| `0x10` | damage | weapon damage |
| `0x11` | pad | editor writes 0 |
| `0x12` | gold | `u16le` shop price |

Class restriction is validated byte-exact against the retail file: Small Club /
Large Club = `0x00` (everyone), Katana/Nunchakas = `0x7D` (Knight + Ninja),
Holy Cudgel = `0xAF` (Paladin + Cleric), and every blade sets `0x10` (Clerics
can't wield blades) while every blunt weapon leaves it clear.

---

## 4. `monsters.dat` — 256 × 26 bytes = 6656

| Off | Field | Meaning (ASM-confirmed) |
|-----|-------|--------------------------|
| `0x00` | name | 14 bytes, each char `& 0x7F` (stored as char + 128) |
| `0x0E` | hp code | `HP = ((c & 0x3F) + 1) * hpmul[(c >> 6) & 3]`, hpmul = {1, 10, 100, 1000} |
| `0x0F` | xp code | `XP = ((c & 0x1F) + 1) * xpmul[(c & 0x60) >> 5]`, ×1000 if bit 7 |
| `0x10` | treasure | reward pack (not a combat ability) |
| `0x11` | pabil | group attack: low 5 = verb index, bits 5–7 = use-chance tier |
| `0x12` | sabil | single attack: low 5 = effect, bit 5 misc, bit 6 archer, bit 7 undead |
| `0x13` | oabil | low nibble+1 (×10 if bit 4) = reinforcement count; bits 5–6 flee tier; bit 7 multiplies |
| `0x14` | speed | low nibble+1, high nibble+1 |
| `0x15` | picture | `& 0x7F` → `NN.anm`; bit 7 = placement/size flag |
| `0x16` | ac | low 5+1 (×10 if bit 5), bits 6–7 flags |
| `0x17` | damage | low 5+1 (×10 if bit 5, capped 250) |
| `0x18` | speed2 | low 5+1 (×10 if bit 5, capped 250) |
| `0x19` | mres | bits 0–2 flags, bits 3–4, bits 5–7 → table |

Pabil low 5 indexes the group-attack verb table (master `[40..71]`: "sprays
poison" … "frenzies" … "swarms"); Sabil low 5 indexes the victim-status table
(master `[10..39]`). Cuisinart (#212) has `Pabil = 0x3D` → verb 29 = "frenzies".

**Verified:** retail decode reproduces the FAQ cross-check rows (Creepy Crawler
5 HP/150 XP, Zombie 20/400, Cuisinart 1000/20,000,000, Mega Dragon
64000/32,000,000, Devil King 5000/30,000,000, …) — see
`tools/mm2/__tests__/real-data.test.ts`.

---

## 5. `roster.dat` — 48 chars × 130 + 2080 global = 8320

```
$0000  characters 0..47    48 × $82 = 6240 bytes
$1860  global stream       2080 bytes (packed quest/calendar/combat state)
```

The editor's round-trip container views the global blob as slots 48–63
(16 × 130) of the same file. Full record layout in
`tools/mm2/roster.ts` (ported from `06-roster-format.md`); highlights:

| Off | Field |
|-----|-------|
| `$00` | name, 11 bytes, NUL-terminated/space-padded |
| `$0B` | town/inn (low 7), bit 7 = "in party" |
| `$0C`..`$0F` | sex, alignment, race, class |
| `$10`..`$15` | current stats (might/int/personality/speed/accuracy/luck) |
| `$28`..`$4B` | **structure-of-arrays** item slots: 6 ids, 6 charges, 6 flags (equipped `$28/$2E/$34`, backpack `$3A/$40/$46`) |
| `$4C`..`$57` | spellbook bitmask |
| `$58`..`$61` | u16le SP max / SP cur / gems / HP max / HP temp |
| `$62`..`$69` | u32le XP / gold |
| `$6A`..`$73` | base alignment/stats/level/spell-level/endurance |
| `$74` | u16le HP current |
| `$79` | class-quest / guild mask (has the `$7E`-OR bug documented in Vairn) |

Enums: race 0..4 = Human/Elf/Dwarf/Gnome/Half-Orc; class 0..7 =
Knight/Paladin/Archer/Cleric/Sorcerer/Robber/Ninja/Barbarian; town 1..5 =
Middlegate/Atlantium/Tundara/Vulcania/Sandsobar.

**Verified:** retail `roster.dat` record 0 is "Sir Felgar"; the shipped
Vairn test artifact `tools/mm2/fixtures/roster_create_test.dat` (same 8320-byte
shape) round-trips byte-exact through `encode(decode(file))`.

---

## 6. `spells.dat` + item effect byte — 96 × 2 + 64 trailing = 256

Both schools share the per-level counts `7 7 6 6 5 5 4 4 4` (48 spells each).
`spells.dat` records 0..47 = Sorcerer, 48..95 = Cleric, flat order matching the
item effect index; the last 64 bytes are leftover/unused data preserved
verbatim. Per-record (`byte0`, `byte1`):

| Byte | Meaning |
|------|---------|
| `byte0` | `0x40` combat-only, `0x80` non-combat-only, `0x10` special cost (hard-coded in code), low nibble = gem cost |
| `byte1` | `0x80` outdoor-only, bits 6–4 = per-level SP multiplier (X in "X/L"), low nibble = flat SP (0 ⇒ per level) |

The `items.dat` `0x0F` byte is a **flat spell index**:

```
0x00          no use power
0x01..0x7F    stat boost, nibble packed (kind {0 MaxHP, 1 Might, 2 Speed, 3 Accuracy, 5 Level, 6 SpellLevel}, amount)
0x81..0xB0    Sorcerer spell #(byte-0x80)
0xB1..0xE0    Cleric   spell #(byte-0xB0)
```

Worked retail examples (all verified in `tools/mm2/__tests__/spells.test.ts`):
Wakeup Horn `0x81`→S1/1 Awaken, Lantern `0x85`→S1/5 Light, Web Caster `0x93`→
S3/5 Web, Hourglass `0x9A`→S4/6 Time Distortion, Disruptor `0x9B`→S5/1 Disrupt,
Magic Mirror `0xA6`→S7/2 Duplication, Meteor Bow `0xAB`→S8/3 Meteor Shower,
Antidote Ale `0xC1`→C3/3 Cure Poison, Cure-all Wand `0xCF`→C5/5 Remove
Condition, Moon Rock `0xD7`→C7/3 Moon Ray, Holy Cudgel `0xDE`→C9/2 Holy Word.

---

## 7. `str.dat` — XOR-0x1C text

Byte transform `decoded = (encoded + 0x1C) & 0xFF`; `0x01` = newline/line
break. Retail Amiga `str.dat` is 7808 bytes (the GOG PC `STR.DAT` decodes to
7707 — a different platform string table). The decode yields the in-game text
jokes/shops/prompts verbatim (`decodeStr` output matches `11-str-decoded.txt`).

---

## 8. `map.dat` — 60 screens × 512 bytes = 30720

Each screen = page 0 (visual) + page 1 (collision), 16×16 grid, 256 bytes each.
Row 0 on disk = south; auto-map draws north-up.

**Page 0 — visual** (drives the 3D hood): four 2-bit wall fields per cell,
N/E/S/W: `0` open, `1` wall, `2` door, `3` wall+torch.

> **Correction:** earlier text said `2` wall+torch / `3` door. Wrong — the
> ASM-traced walker implementations (`view3d_indoor.py`: "code=2 door,
> code=3 torch") and the collision page confirm `2`=door (passable doorway
> faces), `3`=torch (blocked wall faces). The `.32` wall sheets reserve
> frames 0x10–0x1B for door art and the torch sheets hold the wall+torch
> overlays — matching code 2/3 respectively.

```
N = byte & 3,  E = (byte >> 2) & 3,  S = (byte >> 4) & 3,  W = (byte >> 6) & 3
```

**Page 1 — collision**: per direction `(dark << 1) | wall` (low bit wall, high
bit darkness). **West has no dark slot — bit `0x80` is the event flag**
(verified: every `event.dat` triplet sits on a collision cell with `0x80` set).

```
bits 0-1 N, 2-3 E, 4-5 S, bit 6 W wall, bit 7 event
```

---

## 9. `attrib.dat` — 60 × 64 bytes = 3840

Per-screen environment/world-adjacency/roof table parallel to `map.dat`.

| Off | Field | Status |
|-----|-------|--------|
| `0x00` | area_id (= record index) | confirmed |
| `0x01` | map_category (1 town, 2 cavern, 3 dungeon, 4 castle) | confirmed |
| `0x02` | tileset_id (town `0x21`, cavern `0x32`, dungeon `0x53`, castle `0x44`) | confirmed |
| `0x03` | env_type (`0x11` town, `0x12` cavern, `0x13/0x14` castle) | confirmed |
| `0x04` | surface_flag (0 interior; nonzero overland terrain class) | confirmed |
| `0x05`–`0x08` | neighbour ids N/E/S/W (interiors set all four = self; overland table is fully symmetric) | confirmed |
| `0x0E` | entry_coord, packed `(Y<<4)|X` spawn/safe square | ASM-confirmed |
| `0x0F` | era_gate (event interpreter compares to current era) | ASM-confirmed |
| `0x15` | label / complex_id high | strong |
| `0x16` | recall_coord, packed `(Y<<4)|X` | ASM-confirmed |
| `0x17` | level/floor (interior) | strong |
| `0x18` | recall_screen | ASM-confirmed |
| `0x1A` | flags bitfield (bit 6 gates the `0x18` transition) | ASM-confirmed |
| `0x20`–`0x3F` | roof_bits: 256-bit bitmap, 1 bit per tile | confirmed |

---

## 10. `event.dat` — 71 location records = 95687

```
+0x000  71 × 6-byte header (big-endian): { u32be data_offset, u16be data_length }
+0x1AA  per-location data (contiguous: entry[n].offset + .length == entry[n+1].offset)
```

Standard location record:

```
Tile Event Table   3-byte triplets { pos = (y<<4)|x, handler_id, cond }
                     ... terminated by 00 00 00
String offset      u16le word — relative from the word's own position to the
                     string table (string_table_offset = word_pos + value)
Script bytecodes   ~51-opcode interpreter stream, 0xFF-terminated
String table       0xFF-terminated strings; '@' (0x40) = line break in the
                     text renderer
```

Triplet condition flags: `0x10` always fires, `0x20` directional, `0x40`
special/interact, `0x80` enter/step-on, `0xF0` any direction.

Locations 60–70 use alternate layouts. Retail decode: 60 standard, 8 mixed
pools, **3 castle blobs at locations 63/65/68** (no `00 00 00` terminator) —
matching the Vairn doc exactly. The decoder classifies and returns raw bytes
for non-standard records.

---

## 11. Cross-file index

| How a sprite/palette is reached |
|---------------------------------|
| Monster art: `monsters.dat[#].picture & 0x7F` → `NN.anm` |
| Dungeon/town walls: `.32` sheets per `attrib.dat` tileset_id |
| Auto-map tiles: `outb.32` / `townb.32` |
| Event triggers: `map.dat` collision page bit `0x80` ↔ `event.dat` triplets |
| Item "use power": `items.dat[#].effect` → flat spell index into `spells.dat` |
