# Pool of Radiance — open work

Single status surface for this game (Amiga only so far). See
`docs/poolofradiance/amiga/data-structure.md` for format details — this file
only tracks what's still open, never restates findings.

First of four sibling Gold Box titles staged in this repo. The other three
(Curse of the Azure Bonds, Secret of the Silver Blades, Pools of Darkness)
were opened in a later pass (2026-08-30) — see `docs/curseoftheazurebonds/TODO.md`,
`docs/secretofthesilverblades/TODO.md`, `docs/poolsofdarkness/TODO.md`, and
the shared `docs/goldbox-glib-format.md`. Their container format ("GLIB") is
**confirmed different** from this game's `.dax` (no compression, a
cumulative-offset directory instead of per-entry length fields), while the
156-byte wall-slice/10-view compositor geometry this doc's §3 describes
**is confirmed to transfer byte-for-byte unchanged** across all three
sibling titles.

## 2026-08-30 — container + codec + wall-tile renderer solved; FPV hypothesis answered

- `.dax` container format **CONFIRMED**: 2-byte BE `headerSize` + N×10-byte BE
  directory entries + concatenated compressed blocks. 843/843 entries across
  all 23 real `.dax` files chain with zero deviation and close the file size
  exactly (`data-structure.md` §1).
- Decompression codec **CONFIRMED**: a custom backward-reading, bit-oriented
  LZ77 variant with an embedded XOR checksum — **not** real ByteKiller,
  despite the source wiki's "ByteKiller 2.0" label (checked against
  `ancient`'s real `ByteKillerDecompressor`: 0/843 pass). 843/843 entries
  decompress with a passing checksum and exact declared-length match
  (`data-structure.md` §2).
- `walldef.dax` + `8x8d.dax` wall-tile-composite mechanism **CONFIRMED**
  structurally (156-byte slice stride, 10-view geometry table summing to
  exactly 156 bytes, three independent ID-arithmetic cross-checks against
  `8x8d.dax`'s own directory — `data-structure.md` §3).
- **First-person-view hypothesis in `docs/walker-map-format-future-decision.md`
  is ANSWERED: REFUTED.** Pool of Radiance's dungeon view is a true
  per-depth/per-view composited tile render (same strategy as every other
  game in this corpus), not a static pre-drawn scene-picture library. Visual
  evidence: 105 rendered wall-view PNGs in
  `public/assets/poolofradiance/amiga/textures/`, non-degenerate and
  structurally coherent (crenellation borders, a repeated door/torch
  feature reused identically across two different wallset ids, a distinct
  plain masonry-brick wall texture) — see `data-structure.md` §3 for the
  specific files and descriptions.
- `pic.dax`/`cpic.dax` **negative finding**: confirmed NOT to match any of
  Gold Box Explorer's six DOS-side picture-block shape checks (0/59, 0/118
  pass even the coarse EGA/VGA dimension pre-checks — `data-structure.md`
  §4). Real content format still unknown.

### Paths tried

| Approach | Result | Why it failed / status |
|---|---|---|
| Byte-stride guess for directory entries (`[u16][u16 id][u32 offset][u16 len]`, no leading `headerSize`) | Chained self-consistently (`fileSize - 2` remainder every time) | Wrong — a 2-byte phase-shifted alias of the real layout. Corrected via `pooldata.py`'s real field order; corrected model closes with **zero** remainder, not `fileSize-2`. |
| `ancient identify` / hand-checked real ByteKiller algorithm against raw/extracted blobs | Negative on every file tried | The wiki's "ByteKiller 2.0" label doesn't match the real algorithm (0/843 pass ByteKiller's own header/checksum check) |
| Python2 `array('L')` for the backward longword stream | Garbage decompressed-length values (`array('L')` is 8 bytes on this 64-bit host, not 4) | Fixed by dropping `array` for `struct.unpack('>NI', ...)` |
| Gold Box Explorer's DOS-side EGA/VGA/sprite picture-block specs applied to `pic.dax`/`cpic.dax` | 0/59, 0/118 pass | Real negative — the Amiga port doesn't share the DOS port's picture format. `pic.dax`/`cpic.dax` content still open. |
| Speculative "vector/geometric draw-command stream" hypothesis for `pic.dax` (periodicity, doubling-value pairs) | Inconclusive, not pursued further | Recorded as a lead only, not a finding — set aside once `walldef.dax` answered the FPV question directly |

## Open items

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| por-pic-format | open | What do `pic.dax`/`cpic.dax` actually contain? Confirmed NOT any Gold Box Explorer DOS picture-block shape (0/59, 0/118 pass) | `amiga/data-structure.md` §4 | 2026-08-30 |
| por-dungcom-semantics | open | `dungcom.dax` decompresses cleanly (~7.5 KB) but its field layout/semantics (dungeon/maze command data, per its filename) are undecoded | `amiga/data-structure.md` §5 | 2026-08-30 |
| por-8x8d-header | open | `8x8d.dax`'s 4-byte per-tile-block leading header (meaning undecoded; tile pixel decode past it is only "rendered", not disassembly-confirmed) | `amiga/data-structure.md` §3 | 2026-08-30 |
| por-full-catalog | open | Most `.dax` files' contents (sprites, bodies/heads, monsters, items, `ecl.dax`, `final.dax`, etc.) not catalogued this pass — explicitly deferred per task scope (container+codec+FPV question was the goal, not a full catalog) | `amiga/data-structure.md` (container/codec sections apply to all files; only walldef/8x8d/pic/cpic/dungcom examined) | 2026-08-30 |
