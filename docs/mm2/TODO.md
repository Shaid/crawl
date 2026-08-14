# MM2 — open work

Single status surface for this game. Format details live in
`docs/mm2/amiga/data-structure.md` (ported from the Vairn/MM2 ground truth);
this file only tracks what's verified vs open, never restates format facts.

**Status key:** `verified-real` = checked against retail bytes in
`data/mm2/amiga/data/` (or the Vairn test fixtures shipped under
`tools/mm2/fixtures/`); `round-trip` = encode(decode(x)) == x on synthetic
data only; `documented-only` = ported from Vairn docs, no byte-level check
here.

| Format | Status | Verification ledger | Updated |
|--------|--------|---------------------|---------|
| `.32` image sheet | **verified-real** | All 27 retail sheets decode (excluding the documented `globe.32`/`disk.32` XOR blobs). The `51.anm` image chunk decodes with **byte-identical RLE consumption** and **byte-identical planes** vs the ground-truth `EXTRACTED/anm_decoded/51` artifacts. Encode(decode(x)) is byte-stable. | 2026-08-12 |
| `.anm` TV | **verified-real** | Header/sequence/marker parsing reproduces ground-truth `meta.json` for retail `51.anm` exactly (image-chunk offset 76, decode start 180, per-frame consumption `[1535,1326,1321,1342,1336,1328]`, 2 sequence blocks, 5 prelude slots). All 72 retail `.anm` parse. Compose algorithm exercised on synthetic + real frames. | 2026-08-12 |
| `items.dat` | **verified-real** | 256 records from retail file; "Small Club" etc. at expected indices. Class-mask and effect semantics byte-verified in Vairn's own docs; round-trip unit tests. | 2026-08-12 |
| `monsters.dat` | **verified-real** | 256 records; HP/XP formula spot-checks reproduce the FAQ table (Cuisinart 1000/20,000,000; Mega Dragon 64000/32,000,000; Devil King 5000/30,000,000). | 2026-08-12 |
| `roster.dat` | **verified-real** | Retail record 0 = "Sir Felgar". Shipped Vairn fixture `roster_create_test.dat` round-trips byte-exact. Global-stream + tail bytes preserved verbatim. | 2026-08-12 |
| `spells.dat` | **verified-real** | 96 records + 64 trailing bytes from retail; known-answer record decode matches the documented examples. | 2026-08-12 |
| `str.dat` | **verified-real** | Retail decode reproduces the joke/shop/prompt text verbatim. XOR-0x1C known answers + round-trip. | 2026-08-12 |
| `map.dat` | **verified-real** | 60 screens × 512 from retail; cell field decode known-answers; collision `0x80` event-flag mapping per doc. | 2026-08-12 |
| `attrib.dat` | **verified-real** | 60 records; area 0 = Middlegate (category 1, env 0x11). Neighbour/roof/coord fields parsed per ASM-confirmed doc. | 2026-08-12 |
| `event.dat` | **verified-real** | 71 locations; retail classification = 60 standard / 8 mixed / 3 castle-blob at locations 63/65/68 (matches Vairn doc). Triplet/script/string parse verified. | 2026-08-12 |
| `.anm` composed sequence GIFs | open | Composed frames render as PNG strips, but the combat engine's *which sequence block = idle/walk/attack* selection isn't traced (Vairn marks this unknown too). Longest-block heuristic is the showcase fallback. | 2026-08-12 |
| ~~PC DOS `.4`/`.16` codecs~~ | **verified-real** | LZW wrapper + wall/monster blobs ported to `tools/mm2/pc-gfx.ts` (direct port of Vairn's `decode_pc_gfx.py`/`mm2_lzw.py`, with his permission). GOG data at `data/mm2/dosega/` (the old "no GOG data present" note was stale). **2029/2029 sha256 keys byte-identical** to the reference implementation on the same retail files (60/60 wall sheets' LZW payloads + every frame's pixels; 59/59+53/53 monster blobs + every sprite grid); 60 sheets + 2 monster atlases decode, 0 skipped; documented counts hold (75-slot header = 300 B, MONSTERS.16 = 59/74, MONSTERS.4 = 53/74, spider = pic 1). `npm run mm2:pcgfx` → `public/assets/mm2/dosega/`. | 2026-08-12 |
| `globe.32` / `disk.32` XOR | open | Known to be XOR-obfuscated copy-protection blobs; decode documented in Vairn's `20-copy-protection-table.md`, not ported. | 2026-08-12 |
| `event.dat` opcode interpreter | open | The ~51-opcode script VM is documented (`07-event-script-opcodes.md`) but not implemented; our codec parses structure only. | 2026-08-12 |
| `seq_a`/`seq_c`/`seq_b` bit7 | open | Unknown TV-header bytes (preserve on round-trip); Vairn marks them Unknown too. | 2026-08-12 |
| `FrameInfo.flags` bit layout | open | Observed values 0/3 only; individual bits not decoded. Preserved on round-trip. | 2026-08-12 |
| Monster `0x14` speed | open | Decoded as (low+1, high+1) per doc; which is initiative vs action speed is not traced here. | 2026-08-12 |
| `roster.dat` `$1A..$20` quest flags | open | Not ASM-mapped in Vairn; preserved raw. | 2026-08-12 |
| `attrib.dat` `0x09..0x14` params | open | "Observed" fields; preserved raw. | 2026-08-12 |
