# Might & Magic II (PC DOS) — data structure

Format documentation for `data/mm2/dosega/` (GOG release: `MM2.EXE` +
`CGA.DRV`/`EGA.DRV` + `.OVL` overlays + `.4`/`.16` graphics + `.DAT` files).

The PC DOS `.4`/`.16` graphics formats were reverse-engineered by Vairn/MM2
(see `54-pc-dos-graphics-formats.md` there; this project's TypeScript port is
in `tools/mm2/pc-gfx.ts`, written with the author's permission). The `.DAT`
files are **not uniformly LZW-wrapped** — status is per-file, verified
against the retail bytes:

| File | Status |
|------|--------|
| `STR.DAT`, `MONSTERS.DAT`, `ATTRIB.DAT` | LZW-wrapped (`u32LE` decompressed-size header + `lzwDecompress` body, same codec as the graphics files) — decompresses **byte-exact** to the Amiga `.dat` file (0 mismatches, full length); genuinely unported |
| `ITEMS.DAT` | **not** LZW — plain, already Amiga-format bytes (byte-identical size to Amiga `items.dat`, 5120 B; readable directly, e.g. `"Small Club"` at record offset 20) — decodable today with the existing `tools/mm2/items.ts` Amiga codec, no new work needed |
| `ROSTER.DAT` | **not** LZW — plain, Amiga-format-shaped (`"Sir Felgar"` at offset 0) but 8292 B vs Amiga `roster.dat`'s 8320 B (28-byte delta, cause not yet investigated) |
| `MAP.DAT`, `SPELLS.DAT`, `EVENTSI.DAT`, `EVENTSO.DAT` | **unverified** — first 4 bytes are not a plausible `lzwDecompress` size header (e.g. `MAP.DAT` reads as ~37M, `SPELLS.DAT` as ~25M), so this is a different format, not the same LZW wrapper; not yet classified |

See `docs/mm2/TODO.md` for the open-work breakdown.

## Verification ledger

The TS port was diffed against Vairn's reference Python implementation
(`decode_pc_gfx.py` + `mm2_lzw.py`) running on the **same retail files**:
**2029/2029 sha256 keys byte-identical** — every wall sheet's LZW
decompressed payload and every frame's pixel bytes, every `MONSTERS.*`
blob's decompressed payload and every monster sprite grid (0xFF = transparent
flattening). 60/60 wall sheets decode (matching the reference's 60/60 LZW
round-trip), 0 skipped; `MONSTERS.16` = 59/74 non-empty pictures,
`MONSTERS.4` = 53/74 (documented counts); spider = picture id 1.

## LZW container (all `.4` / `.16` blobs) — confirmed

| Field | Size | Notes |
|-------|------|-------|
| `uncompressed_size` | u32 LE | expected decompressed byte count |
| LZW stream | rest | 9→12-bit codes, early-change growth, clear `0x100`, stop `0x101`; root char = `expand(code)[0]` |

Ported to `tools/mm2/pc-gfx.ts::lzwDecompress`; byte-exact against the
reference on all 60 + 111 blobs.

## Wall / environment sheets (`THROW`, `TOWN`, `CASTLE`, `SKY`, ...) — confirmed

```
u32 LE uncompressed_size
LZW stream @ +4
decoded:
  u8  frame_count = dec[0] & 0x3F   ; top 2 bits = format class
  u8  flags @ +1
  offset table @ +2 — auto-scored between:
     packed u32  (end<<16)|start  (MASTER.16, CASTLE, TOWN, ...)
     plain u32
     u16          (grouped sheets interleave [start,end] pairs)
  per frame @ offset:
    u16 LE width, u16 LE height
    pixels: CGA (.4) (w+3)/4 B/row, 2bpp MSB-first, 4 px/byte, palette 1
            EGA (.16) (w+1)/2 B/row, 4bpp linear, hi nibble = left pixel
```

Frames are complete images (no compositing). Transparency: indoor front
panels (frames 0–3, 16–19) opaque; side-wall cones (4–11, 20–27) keyed on
EGA pen 8 / CGA pen 1; outdoor front panels key index 0 (the walker-facing
paired CGA/EGA silhouette masks from the reference are not ported — see
`renderWallFrameRGBA`'s basic colour-key rule).

**`GLOBE.*`/`DISK.*` are real images on DOS** (unlike Amiga, where
`globe.32`/`disk.32` are XOR-obfuscated copy-protection blobs — see
`amiga/data-structure.md`). Decoded through the same wall-sheet parser as
any other `.4`/`.16` file, with no errors and no fallback heuristics
triggered: `GLOBE.16`/`GLOBE.4` are a clean 12-frame, uniform 56×73
animation (a spinning globe icon — background-index pixel count is
constant ±1 across all 12 frames while the other colour indices vary
smoothly frame-to-frame, consistent with a rotating sprite, not noise);
`DISK.16`/`DISK.4` are a single clean 88×67 frame with a small, consistent
colour histogram between the CGA and EGA versions. Exported to
`textures/globe16.png` / `globe4.png` / `disk16.png` / `disk4.png`.

## Monster combat atlas (`MONSTERS.4` / `MONSTERS.16`) — confirmed

```
u32 LE[75] blob file offsets   ; u32[0] = 300 = header size; picture id N
                                ; → entry N-1; 0 = empty slot
per blob:
  u32 LE decompressed_size
  LZW stream
decoded:
  u8  frame_count = dec[0] & 0x3F
  u8  flags @ +1
  u16 LE[frame_count] inner frame offsets @ +2
  animation script sequences (byte pairs (frame_index, delay), 0xFF ends a
    sequence, 0xFF 0xFF ends all) — between the offset table and first frame
  per frame @ offset:
    u8 x, u8 y, u8 w, u8 h    ; position/size on the 96×96 combat canvas
    nibble-RLE stream:
      token: high nibble = run count (run len = count+1), low nibble = code
      CGA: code 0-3 = colour, 4-15 = transparent
      EGA: code 5 = transparent, else colour = xlat[code]
      xlat = [0,1,2,9,6,8,10,3,4,5,7,11,12,13,14,15]
```

Frame 0 = full base sprite; later frames = delta patches (clear `(x,y,w,h)`
then blit). Compositing and script selection: `tools/mm2/pc-gfx.ts`
(`compositeCombatFrame`, `parseMonsterScripts`). Script frame indices can
exceed the picture's own frame count (e.g. pic 1 script `(133, 0)`) — those
steps composite base-only (safe fallback; semantics per Vairn's combat
overlay notes).

## Overlays (`.OVL`)

Flat code overlays loaded by `MM2.EXE`'s overlay manager; combat logic lives
in `2COMBAT.OVL`. The sprite decode itself is in `CGA.DRV`/`EGA.DRV`.
Not analysed here.

## Still open

- GOG `STR.DAT`/`MONSTERS.DAT`/`ATTRIB.DAT` LZW wrapper: confirmed
  byte-exact vs the Amiga `.dat` files (see the table above) but not yet
  ported to a TS decoder/export path.
- `ITEMS.DAT` (and likely `ROSTER.DAT`, pending its 28-byte size delta)
  are **not** LZW-wrapped and could be exported today with the existing
  Amiga-format codecs (`tools/mm2/items.ts`/`roster.ts`) — no wrapper work
  needed, just wiring a DOS export path.
- `MAP.DAT`/`SPELLS.DAT`/`EVENTSI.DAT`/`EVENTSO.DAT`: not the same LZW
  wrapper as STR/MONSTERS/ATTRIB (implausible size header) — format
  unclassified.
- The walker-facing paired CGA/EGA silhouette masks (outdoor/sky/overlay
  renders) from the reference are documented but not ported.
