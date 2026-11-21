# Zombi (Amiga) — data structure

Recon 2026-11-21 (re-recon). Game id `zombi` (not yet registered in
`src/game-id.ts`). Retail files stay at `data/zombi/amiga/data/`
(WHDLoad install by Sting, 24-Dec-2013; slave supports EN/FR/DE, this copy
carries `francais.txt` but its strings are English).

## Identification

| Item | Value |
|---|---|
| Title | Zombi — Ubi Soft, Amiga conversion 1990 of the 1986 original |
| Credits (`francais.txt`) | Game Yannick Cadin, graphics Patrick Daher, scenario Alexandre Bonan, music Alain Da Silva, SFX David Peres, conversion Alexander Yarmitsky |
| Executable | `zombi` — AmigaOS HUNK (`0x3F3`), 8 hunks, sha1 `b2c125bf991ce1b000684ec398097faac367afd3`; contains every data filename as a literal string (`plan`, `i-lieux`, `lieux.seq`, ...) plus `!!CopyRights : PERES DAVID !!` (sound driver) |
| Art lineage | Every `.seq` is an **Atari ST Cyber Paint sequence** (magic `0xFEDB`, ST 3-bit `0x0RGB` palettes, frame names `FLICKERS.n`) — the art was drawn on the ST and shipped unconverted |

Key hashes: `LIEUX.SEQ` `f52e89c9b7f80100a6c1c9b25113767bcd55b220`,
`i-lieux` `0766023ca4e88b2541a04251819c3e9782f1adf4`,
`plan` `d79d5c2fafaf775f771babc874dae32a8b4676bd`,
`i-objets` `d0d3ea883f4fc423157a44dc40ebbec8406ec5be`,
`objet.seq` `2cdb888709c5f6ba6203e8627aff344ba0781dea`,
`z.seq` `88dd914744352e0cf1423bf729c3cbacdae81d59`,
`zombi.sys` `bc5e75cd246dce8ecb6f3d09acfa7f6590ed435e`,
`zombi.mus` `9b81e1f79c97abe1dfdab7bbc89928de8ac9ab7f`,
`zombi2.mus` `0d7f50a698f3dbd7b7fe219231ccad3034585434`.

Probe scripts (throwaway, not committed): session scratchpad `unx/zombi/`
(`seq.py`, `dec.py`, `render.py`, `exits.py`, `recip.py`).

## Inventory

| File(s) | Size | Family | Role | Status |
|---|---|---|---|---|
| `plan` | 336 | map | 6 floors × 7 rows × 8 cols of location ids | **confirmed structure** (§ plan) |
| `i-lieux` | 4,500 | map | 90 × 50-B location records (exits, flags, slots) | exits **confirmed**, rest hypothesis (§ i-lieux) |
| `LIEUX.SEQ` | 334,400 | Cyber Paint SEQ | 82 frames 160×80 — location pictures (+2 binocular masks, 2 horde shots) | **decoded** (§ SEQ) |
| `objet.seq` | 18,022 | SEQ | 67 small object sprites (3×5 … 46×46) | decodes, closure 67/67 |
| `i-objets` | 264 | table | 66 × 4 B object records | hypothesis (§ i-objets) |
| `z.seq`, `skins.seq` | 19,932 / 19,198 | SEQ | 22 + 22 zombie / "skins" figures (23–76 px) | decodes, closure 22/22 each |
| `tetes.seq` | 6,448 | SEQ | 11 heads (32×~31) — party portraits? | decodes, 11/11 |
| `SCREEN.SEQ` | 7,314 | SEQ | 320×200 main UI frame | decodes |
| `PRESENT.SEQ` | 16,874 | SEQ | 320×195 title | decodes |
| `MASK.SEQ`, `button.seq` | 2,684 / 918 | SEQ | 176×160 mask, 17×89 button strip | decodes |
| `echec.seq`, `victoire.seq` | 9,718 / 9,794 | SEQ | 288×112 lose / win pictures | decodes |
| `zombi.mus`, `zombi2.mus` | 58,806 / 65,398 | MOD | ProTracker `M.K.` | standard (prior triage: tracker loads them) |
| `*.SON` / `*.son` (21) | 608–18,656 | PCM | BE u32 length + BE u16 rate (Hz) + signed 8-bit mono | **confirmed** 21/21 (§ SON) |
| `zombi.sys` | 6,960 | state | starts `000D 0000 0068 …`; holds a copy of `plan`'s ids from `+0x68` with a slightly different row stride | hypothesis: initial/saved game state |
| `francais.txt` | 869 | text | credits + UI strings, newline-separated (English despite the name) | plain |
| `keymap` | 854 | text | `#0xNN = |a |b` keyboard table | plain |
| `system-configuration` | 232 | Amiga prefs | standard AmigaOS `system-configuration` | ignore |

## plan — location grid (confirmed structure)

336 B = **6 floors × 56 B**, each floor 7 rows × 8 columns, one byte per
cell, `0` = no location. Ids 1..86 each appear exactly once. Every floor's
row 0 is empty (border), consistent with a 7×8 block per floor.

| Floor (byte range) | Ids | Content of their pictures (from `LIEUX.SEQ`, frame ≈ id−1 — hypothesis) |
|---|---|---|
| 0 (`0x00`–`0x37`) | 1–17 | brick service corridors, basement (frame 0 = room with a staircase) |
| 1 (`0x38`–`0x6F`) | 18–34, 63–86 | mall ground level (18–34) + outdoor car-park ring (63–86, grass/walls) |
| 2 (`0x70`–`0xA7`) | 35–47 | mall level ("Niveau 1/2" escalators) |
| 3 (`0xA8`–`0xDF`) | 48–58 | upper mall level |
| 4 (`0xE0`–`0x117`) | 59, 60 | escalator top / landing |
| 5 (`0x118`–`0x14F`) | 61, 62 | terrace + helicopter (roof) |

Vertical links (from `i-lieux` bytes 4/5, below) all join cells at the
**same (row, col)** on adjacent floors: 1↔18 at (5,1); 25↔45↔57↔60↔61 at
(4,5) — the elevator shaft. 6/6 links, zero deviation.

## i-lieux — location records

4,500 B = **90 × 50 B**. Record `i` describes location id `i+1`
(ids 87–90 are not in `plan`; their pictures are vehicle interiors, see
§ SEQ — hypothesis).

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0..3 | 4×1 | horizontal exits | see below — **confirmed** |
| 4 | 1 | vertical exit A | `00` open, `0A` blocked. Open on 18 (lower end of the stair) and the shaft cells |
| 5 | 1 | vertical exit B | ditto; open on 1 (stair room) and the shaft |
| 6 | 1 | ? | values 0/1/2 (42/40/8) — hypothesis: zombie density or light |
| 7 | 1 | flags | `00`/`FF`/`80`/`A0`; `FF` on ids 2–17 (basement), `80` mall, `A0` exterior + vehicles — looks like an area class |
| 8 | 1 | always 0 | |
| 9 | 1 | picture override | non-zero = 1-based `LIEUX.SEQ` picture used instead of the default (`0x4D` on ids 72, 77, 82) — **confirmed** (§ SEQ, picture map) |
| 10..41 | 32 | slot table | mostly `FF`; values recur in pairs exactly 10 B apart (e.g. id 20: `+11=0x36`, `+21=0x37`) — hypothesis: object/hotspot slots, two parallel arrays |
| 42..49 | 8 | ? | mostly 0; a few small values |

**Exit bytes 0..3.** Values: `00` open (120), `14` open-door-ish (42),
`0A` blocked (151), `FE` map edge facing outdoors (27, only on car-park
cells with no neighbour), and four one-offs (`F0` ×2 on id 36/39, `FA` on
id 46, `1E` on id 59) — special exits, hypothesis.

Byte order: bytes 0,1,2,3 lead to plan cells **(row+1, col), (row, col+1),
(row−1, col), (row, col−1)**. That is N,E,S,W if `plan` rows count
*upward* (or S,E,N,W if rows count downward on screen) — which compass name
applies is unverified.

Verification (probes `exits.py`, `recip.py`):
- Every open exit (`00` or `14`) lands on an occupied plan cell:
  **162/162**. Shuffled-position null: 85–101/162.
- Every open exit is reciprocated by the neighbour with the **same value**:
  **162/162**. Null: 20–28 of the 85–101 that land.
- Best direction permutation scores 279/344 on "open ⇔ neighbour exists";
  the remaining 65 are all walls between adjacent cells (`0A` with a
  neighbour, 34) or the `FE`/special values — no open exit into empty space.
- `0A` between adjacent cells is common (shop walls) — so adjacency in
  `plan` does **not** imply passage; the face value is authoritative.

Model: **per-cell** faces (each location stores all four of its own exits +
up/down), placed on a grid from a separate file. Converts directly to the
`@seer-project/dungeon` per-cell model.

## SEQ — Atari ST Cyber Paint sequence (decoded, standard)

All 12 `.seq` files share one format (no sibling coverage in crawl or other
seer projects — grep for `FEDB`/Cyber Paint found nothing; public spec:
the ST picture-format notes, and RECOIL decodes `.SEQ`).

File header (128 B): `+0` u16 magic `0xFEDB`, `+2` u16 version (0), `+4` u32
frame count, `+8` u16 speed (0x190 or 0x5DC here), rest zero. `+0x80`:
u32 BE absolute frame offsets × count.

Frame header (128 B): `+0` u16 `0xFFFF`, `+2` u16 resolution (0 = low),
`+4` 16 × u16 ST palette (`0x0RGB`, 3 bits/channel), `+0x24` 12-B name,
`+0x30` 3 × u16 colour-cycle fields, `+0x36` u16 x, `+0x38` y, `+0x3A`
width, `+0x3C` height, `+0x3E` u8 operation, `+0x3F` u8 storage
(0 raw, 1 compressed), `+0x40` u32 data length. Data follows.

Compressed data: word stream, token `c`: `c & 0x8000` → copy `c & 0x7FFF`
literal words; else → repeat the next word `c` times. Output is
**column-major**: `4 × ceil(w/16)` word-columns of `h` words, ordered
plane-major (`col = plane × wordsWide + x`). Bit 15 = leftmost pixel.
Raw (storage 0) frames are `ceil(w/16) × h × 8` bytes, laid out as
**ST screen words: row-major, 4 interleaved plane words per 16 px**
(confirmed 2026-11-21: the 5 raw `tetes.seq` heads and 14 raw `objet.seq`
frames render as clean pictures; reading them column-major gives noise).

Verification: compressed-token walk yields exactly `4·ceil(w/16)·h` words
on **every** compressed frame of all 12 files (LIEUX 82/82, objet 53, z 22,
skins 22, tetes 6, singles 7); the 14 objet + 5 tetes frames that do not
are exactly the `storage=0` frames, whose length equals `ceil(w/16)·h·8`.
Each frame's stored length equals the gap to the next offset (LIEUX 81/81;
last frame +26 B file padding). The plane-major column order renders all
82 LIEUX frames as clean pictures (the interleaved order gives
recognisable-but-shredded images — that was the null). 
> **Correction (2026-11-21):** the earlier "×36 per 3-bit step" scaling was
> provisional and wrong for the Amiga. The executable stores `PRESENT.SEQ`'s
> and `SCREEN.SEQ`'s 16-word palettes (and the `echec`/`victoire` ones, bar
> entry 0) with every 3-bit channel **doubled** (`n → 2n`, i.e. Amiga nibble
> `0x0..0xE`, so ST white `777` → Amiga `EEE`); an exact 32-byte search finds
> that scaling at `zombi+0x13BB8`-ish for both pictures and finds the raw ST
> words nowhere (**confirmed**; null = unscaled words absent). Exporter
> colours = `2n × 17`. LIEUX/objet/z/skins frames use the same ST palette,
> whose entry 0 is `222` (Amiga `444`) rather than SCREEN's `111`.

Committed decoder: `tools/shared/cyberpaint-seq.ts` (reusable, public format);
exporter `tools/zombi/amiga/export-data.ts` (`npm run zombi:export`) →
`sprites/{lieux,objet,z,skins,tetes}.png+json`, `screens/{present,screen,mask,
button,echec,victoire}.png`, `palettes/*.json`. **Only 11 `.seq` files exist
in the retail data** (210 frames: LIEUX 82, objet 67, z 22, skins 22, tetes 11,
six singles), not 12. Verification (test `cyberpaint-seq.test.ts`): every
compressed frame decodes to exactly `4·ceil(w/16)·h` words with every input
byte consumed (comp. frames: 0 failures); raw frames match their size exactly;
null control — starting the stream 2 bytes late — fails on **all** compressed
frames (191/191). Palette is one per file (same 16 words in every frame).


`LIEUX.SEQ` frame catalogue (rendered): 0–16 brick basement corridors;
17–60 mall interiors (shops "Mac Gropak", "Opticiens Rissac", "Atari",
"Sports 3000", "Contact Ubi Soft", escalators "Niveau 1/2/3", lifts);
60 terrace; 61 helicopter; 62–73 car park (grass, walls); 74–77 vehicle
views (truck cab, truck "Marché transport", car); 78–79 binocular masks;
80–81 zombie horde. 

### Location id → picture (solved from the executable, 2026-11-21)

`LAB_0139` (`zombi` S_0 `+0x2B72`, opens `lieux.seq` via `25282(A4)`)
loads frame `n−1` for a **1-based picture number `n`** (offset table
`25140(A4)[n−1]`). The per-location picture number is built in `LAB_0275`
(`+0x5088`) and kept at `25085(A4)`:

1. start with the location id (1-based; `i-lieux` is read as ids 1..90
   into 65-byte memory records at `18716(A4)`, file record `id−1`);
2. an 18-entry id table at `+0x50B4` remaps the car park: 71→`0x46`;
   72–74→`0x47`; 75,76→`0x48`; 77–81→`0x49`; 82–86→`0x4A` (ids 62 and 34
   take special branches but keep their own number, 62 = helicopter);
3. ids 87–89 → `0x4B`, id 90 → `0x4C` (vehicle views, `+0x5F4A`..`+0x5F7A`);
4. **`i-lieux` record byte 9, when non-zero, overrides** (`LAB_0284`
   `+0x51C8`) — this is what the `0x4D` on ids 72, 77, 82 is (picture 77,
   frame 76).

So 24 car-park cells share 12 pictures (frames 62–73, 76), exactly as the
exit pattern suggests. Table emitted as `data/location-pictures.json`
(`frames[id−1]`, 77 distinct frames). Other fixed calls: `LAB_0139(62)` at
start (helicopter), `81` (horde), `71`/`78` (`+0x4760`/`+0x476C`, frames 70/77).
Confidence: **confirmed from code**; not yet cross-checked against live play.
`i-lieux` bytes 10..41 are read as four 10-byte pieces into memory
offsets 22/33/44/55 (`+0x0626`..), with +10..21 filled at run time.

## i-objets (hypothesis)

264 B = 66 × 4 B: `u8 a, u8 b, u16 LE value` — `a,b ∈ {1,2}`, value
steps by `0x40`·(a·b)-ish (`0x0000, 0x0080, 0x0100, 0x0140 …` ending
`0x17C0`). Looks like per-object cell-size + offset into a packed buffer.
`objet.seq` has 67 frames — check the off-by-one.

## SON — sound effects (confirmed)

`+0` u32 BE sample count (= file size − 6, **21/21**), `+4` u16 BE sample
rate in Hz (3700–9900; 8363 and 8400 common), then signed 8-bit mono PCM.

## Paths tried

| Item | Approach | Result | Why |
|---|---|---|---|
| SEQ pixels | column-major, plane-interleaved (`x·4+plane`) | shredded but recognisable | wrong column order |
| SEQ pixels | column-major, plane-major (`plane·wc+x`) | clean 82/82 | adopted |
| i-lieux ↔ plan | id = record index (off 0) vs index+1 (off 1), all 24 direction permutations | off 1, (row+1, col+1, row−1, col−1) best | see § i-lieux |
| LIEUX ↔ locations × facings | 86 × 4 = 344 pictures expected if per-facing | 82 frames, 78 of them locations | one picture per location, no facings |
