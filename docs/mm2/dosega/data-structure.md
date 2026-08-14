# Might & Magic II (PC DOS) — data structure

Format documentation for `data/mm2/dosega/` (GOG release: `MM2.EXE` +
`CGA.DRV`/`EGA.DRV` + `.OVL` overlays + `.4`/`.16` graphics + `.DAT` files).

The PC DOS `.4`/`.16` graphics formats were reverse-engineered by Vairn/MM2
(see `54-pc-dos-graphics-formats.md` there; this project's TypeScript port is
in `tools/mm2/pc-gfx.ts`, written with the author's permission). The
`.DAT` files are the same Amiga formats (the GOG `*.DAT` are LZW-compressed
on disk but decompress to the Amiga files — not yet ported; see
`docs/mm2/TODO.md`).

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

- GOG `*.DAT` on-disk LZW wrapper (decompresses to the Amiga `.dat` files;
  codec is the same `lzwDecompress` — the wrapper is a filename-mapped
  container, see Vairn's `pc_dat_lzw.py`).
- The walker-facing paired CGA/EGA silhouette masks (outdoor/sky/overlay
  renders) from the reference are documented but not ported.
