# Abandoned Places: A Time for Heroes (Amiga) — data structure

Recon, 2026-11-21. Retail files stay where they are, at
`data/abandonedplaces/amiga/`. All file offsets below are **byte offsets into
the `Disk.N` image file**, unless a line says otherwise.

This doc also holds the **ArtGame kernel container + packer spec** (§2–§3). Abandoned
Places 2 uses the same container and packer:
`docs/abandonedplaces2/amiga/data-structure.md` points here, so this is the only
copy.

## 0. Identification

| Item | Value |
|---|---|
| Title | Abandoned Places: A Time for Heroes (EN; the WHDLoad ReadMe says DE was tested too) |
| Developer / publisher | ArtGame (Hungary) / Electronic Zoo, 1992 |
| Engine | **ArtKernal V1.1** ("Developed & (C)by Steve Fabian", string at `Disk.1+0x554`). It is a bootblock-launched trackloader kernel with its own file directory |
| Media | WHDLoad install by Wepl (slave v1.3, 1998). `Disk.1`–`Disk.5` are **DIC sector images**, 901,120 B each. They are *not* AmigaDOS volumes: only `Disk.1` has a `DOS\0` bootblock, and no disk has a root block at 880 |
| Manual (naming oracle) | `~/Development/amigadocs/game-manuals/Abandoned Places - A Time for Heroes (1992)(Electronic Zoo)[1000].pdf` (+ DE edition `[0999]`) |

| File | Size | sha1 |
|---|---|---|
| `Disk.1` | 901,120 | `c455a6e7453eb741d08d29106434f41b995c946e` |
| `Disk.2` | 901,120 | `386ec2a3b5f294f5a00f45f16210bbc0b363f48b` |
| `Disk.3` | 901,120 | `2e9d37ba1bc774e91fc76f242d0979ac215fa78c` |
| `Disk.4` | 901,120 | `986d40f284ee430823e136e3a219d992bb18eb8f` |
| `Disk.5` | 901,120 | `48d327095de60797253b751df0db2daee067501c` |
| `AbandonedPlaces.slave` | 3,344 | `86ad177fc24270580b9da6bb53f0f7cfc72f73e7` |
| unpacked `code` (dir sec 1) | 68,380 | `ac0b3859b4b55676e6d6888619a16214f5658d5b` |
| unpacked `module` (dir sec 2) | 120,104 | `f98f69e86acdb4f4c27ab1749d5ee40a5f6ce698` |
| unpacked `dungeon1`/`2`/`3` | 131,072 each | `b97c7fa5…`, `10c312be…`, `c1d1bfae…` |

## 1. Disk layout — **confirmed** (structural)

| Disk offset | Content | Confidence |
|---|---|---|
| `Disk.1+0x000` | Bootblock (`DOS\0`, "BOOT BY ARTGAME...") | confirmed |
| `Disk.N+0x400` | 4-byte disk tag `AP1n` (n = `0`–`4` for Disk.1–5) | confirmed 5/5 |
| `Disk.1+0x404` | Kernel: a HUNK_HEADER whose `0x3F3` magic is replaced by the tag (1 hunk, `0x1452` longs = 20,808 B of code; the code body starts at `Disk.1+0x420`) | rendered |
| `Disk.1+0x5800`–`0x90C8` | **File directory** (§2). The kernel reads it as the file `"DIRECTORY OF AP1"` (string at `Disk.1+0x1164`) | confirmed |
| `Disk.1+0x9800`… / `Disk.2–5+0x404`… | File bodies, packed back to back | confirmed |
| sectors filled with `DOS DOS!DOS"…` | Unused filler (11 sectors on Disk.2, 2 each on Disk.3/4) | hypothesis |

`Disk.3` and `Disk.4` share 611 identical 512-B sectors. That is expected, because the
directory places several identical files on more than one disk (`smpl.effect`,
`mdat.effect`, `block1.1`).

## 2. ArtGame kernel directory (shared with AP2) — **confirmed**

The directory is a list of 32-byte big-endian records. A 2-byte `0000` separator
starts each new disk section.

| Offset | Size | Field | Notes |
|---|---|---|---|
| +0x00 | 16 | name | ASCII, NUL-padded (e.g. `bpl.city0`, `monster26`, `ABIC.CASTLE`) |
| +0x10 | 4 | offset | Byte offset into **that section's disk image** |
| +0x14 | 4 | stored size | |
| +0x18 | 4 | unpacked size | Equals the stored size when not packed |
| +0x1C | 2 | packed flag | `1` = ArtGame packer (§3), `0` = stored |
| +0x1E | 2 | group | AP1: 0–9. It looks like a load/purge class (9 = intro/cut-scene `ABIC.*`, 1 = wallset art, 2 = monsters/walls/stairs, 4/5 = TFMX audio). Hypothesis. AP2 has 0 in every record |

AP1 has **454 records in 5 sections** (90 / 96 / 76 / 92 / 100). Section *k* is
`Disk.(k+1)`. Every section is contiguous: each `offset` equals the previous
`offset + stored`, with 0 breaks. Each section's last byte falls inside its disk.
Sections 1–4 start at `+1028` (= 0x404, just after the tag). Section 0 starts at
`0x9800` (38,912), after the kernel and the directory.

**Verification:** every one of the 427 packed records unpacks with checksum 0, input
fully consumed and output size exact (§3). The 27 stored records have
stored = unpacked. This is 454/454, which only works if the offsets are disk-image
byte offsets and the section-to-disk mapping is right.

## 3. ArtGame packer (shared with AP2) — **confirmed**

**Reader:** `AP2` kernel hunk 0 `+0x22BE` (`LAB_01C2` in an IRA dump of
`data/abandonedplaces2/amiga/data/AP2`; file offset `+0x22E6`). AP1's kernel
has an older implementation of the same grammar at about `Disk.1+0xA20` (a dispatch
on `D3>>3` through a byte table, without the Duff's-device copy). This is a
**backward** byte-oriented LZ: it reads from the end of the packed data and writes
from the end of the output.

**Trailer** (last 4 bytes of the stored data): `chk`, then the unpacked size as a
24-bit **little-endian-ordered** value (`size = b[n-1]<<16 | b[n-2]<<8 | b[n-3]`).
`chk` is XORed with every control byte. A valid stream ends with `chk == 0` (the
kernel otherwise returns 0 = failure).

**Loop:** peek the next control byte `c` and up to 3 operand bytes `d4 d5 d6`. Read
them backward, from just below the current source pointer, after any pending
literals. Select the handler with `c>>3`:

| `c` | consumes | match length | distance−1 | literals after the match |
|---|---|---|---|---|
| `00–1F` | 1 | — | — | `(c&0x1F)+1` |
| `20–3F` | 2 | — | — | `((c&0x1F)<<8 \| d4) + 0x21` |
| `40–5F` | 2 | `((c>>2)&7)+3` | `(c&3)<<8 \| d4` | 0 |
| `60–6F` | 1 | 2 | `c&0xF` | 0 |
| `70–77` | 3 | `(c&7) + (d4&0x80 ? 12 : 4)` | `(d4&0x7F)<<8 \| d5` | 0 |
| `78–7F` | 4 | `((c&7)<<8 \| d4) + 5` | `d5<<8 \| d6` | 0 |
| `80–BF` | 2 | `((c>>2)&3)+3` | `(c&3)<<8 \| d4` | `((c>>4)&3)+1` |
| `C0–FF` | 3 | `((c&3) \| ((d4&0xC0)>>4)) + 4` | `(d4&0x3F)<<8 \| d5` | `((c>>2)&0xF)+1` |

The match is copied first, `out[p] = out[p + dist]` with the output written
downward, and then the literals, copied byte by byte downward from the source. The
loop stops when the output pointer reaches the start of the buffer.

> **Committed (2026-11-21):** `tools/shared/artgame-kernel.ts` (`parseArtDirectory`,
> `unpackArtGame`, `unpackArtGameStrict`, `loadArtVolume`), test
> `tools/shared/__tests__/artgame-kernel.test.ts`, CLI `tools/abandonedplaces/unpack.ts`
> (→ `build/cache/<game>/`: AP1 443 files / 8.7 MB, AP2 593 files / 5.9 MB; the 11 AP1
> names repeated across disks are byte-identical). AP1's directory is parsed from
> `Disk.1+0x5800` up to `0x9800`; AP2's `ap2.dir` starts with a record (no leading
> separator); AP2 section 4 (save files) has no shipped image and is skipped.
> AP2 totals: 617 shipped records in sections 0–3 (63/160/194/200). Null controls in the
> test: flipping the first control byte, or dropping the last byte (trailer shift), fails
> every sampled record. (Flipping a *literal* byte is not detectable — chk covers
> control bytes only.)

**Verification:** the port decodes **427/427 AP1 and
262/262 AP2** packed records. Each passes with `chk == 0`, all stored bytes consumed
and output length equal to the directory's unpacked size. Null controls: flipping
one byte gives `chk = 0x55`, and shifting the stream by one byte leaves input
unconsumed; both fail. `ancient` does not recognise the format ("Unknown").

## 4. Inventory by family (unpacked contents)

Sizes are unpacked. "sec" is the directory section, so the disk is sec+1.

| Family | Members | Evidence | Status |
|---|---|---|---|
| Code | `code` (sec1, HUNK 68,380), `module` (sec2, HUNK 120,104, probably the dungeon engine), `intro`/`title`/`start`/`main`/`selection`/`gameover`/`theend`/`templeruins`/`vulcan`/`crown`/`*assem` (small HUNKs; cut-scene players) | `000003F3` at +0 | standard (HUNK) |
| **Dungeon levels** | `dungeon1`/`2`/`3` (sec2, 131,072 each = **12 × 10,916-B level records** + 80 zero bytes), `level_forest1`–`8` (10,916 each) | §5 | structured-unknown |
| Wallset art, per set N = 1–11 | `wallN.M` (12,215), `blockN.M` (18,490), `doorN.M` (9,120), `gateN` (10,040), `stairsN` (42,890), `switchN` (6,550), `buttonN` (1,200), `carpetN.M` (5,595), `cupboardN` (14,470), `backgndN` (13,824 = 192×144×4 planes?), `moduleN` (21,330, unknown — geometry table?) | Headerless (leading zero rows); every member of a family has the same size | structured-unknown |
| Monsters | `monster1`–`38` (22,040 each, spread over sec2–4) | Fixed size | structured-unknown |
| Town / UI | `bpl.city0–12`, `bpl.village0/1`, `bpl.tower0/1`, `bpl.church0–2`, `bpl.graveyard` (25,606 each), `bpl.council`/`herbal`/`pub`/`smith`/`train`/`jewelry`/`shop`/`temple` (12,006 each), `bpl.panel`, `bpl.map` (204,806), `bpl.pergamen`, `bob.*`, `spr.*`, `icon0/1`, `sp0`–`sp20` (10,336), `dat.font*` | `bpl.city0` starts `0480 0014 0080 …` — a small header | structured-unknown |
| Intro/cut-scene images | `ABIC.*` / `abic.*` (77 records, sec0/1/4; many 40,064 = 64 + 40,000 = palette + 320×200×5?) | `ABIC.CHURCHDATA`/`crowndata`/`STARTDAT` = 64-B palettes stored beside the picture | hypothesis |
| Text | `ABIC.TXTTITLE` ("A Time for Heroes"), `ABIC.OLDMANTXT*`, `ABIC.STARTTXT*`, `ABIC.DEATHTXT0` | Plain ASCII once unpacked | standard |
| Music / SFX | `mdat.*` + `smpl.*` pairs (L1–L6, city1–3, outer1/2, part1.x/2.x, Temple, effect, encounter) | `TFMX-SONG ` magic: Chris Hülsbeck TFMX (libxmp/uade play it) | standard |
| Map item | `map` (640 B) | Looks like 8×8 1bpp tiles (automap glyphs) | hypothesis |

## 5. Dungeon level record (10,916 B) — **rendered**

| Offset | Size | Field | Notes |
|---|---|---|---|
| +0 | 2048 | grid | **32 × 32 big-endian words**, row-major. `0x0001` = solid wall square, `0x0000` = open. `0x4000`, `0x2000` and `0x4001` are the only other values seen across all 44 records |
| +2048 | 2 | wallset id | Hypothesis. dungeon1/2 use {1,3,4,7} and dungeon3 uses {2,5,6,8,9}; the art for those sets sits exactly on Disk.4 and Disk.5 respectively. Forest levels use 10/11 (`module10/11`, `block10/11.x`, `backgnd10/11` on Disk.3) |
| +2050… | 8,866 | unknown | Object, monster and event tables. The second word looks like a start position |

Evidence:
- All 44 records (36 dungeon + 8 forest) have a fully solid border (124/124 cells).
- Rendering at width 32 gives coherent corridors and rooms. Width 64 shears them.
- The wallset-id ↔ disk split holds for 36/36 dungeon levels.

**Wall model:** type-derived (solid squares, like Dungeon Master). A face is a wall
when the neighbouring square is solid. The `0x4000` cells line room edges and pillar
rows (the `H` runs in renders), so they are probably a per-square decoration or
feature flag (hypothesis).

### Paths tried
| Approach | Result | Why it failed / status |
|---|---|---|
| Word grid at width 64 | Two half-mazes per line | Wrong width; 32 is right |

## 6. First-person renderer — hypothesis

The art is prepared per wallset, per depth and per side (`wallN.1–.4`, `blockN.1–.3`,
`doorN.1/.2`, `carpetN.1/.2`, plus single-file `gateN`/`stairsN`/`switchN`/`buttonN`/
`cupboardN`), over a `backgndN` 192×144 backdrop. AP1 files carry **no geometry
header**, so the slot positions must come from code (`module`) or from the
21,330-byte `moduleN` files. The working assumption is a **slot table** (pre-drawn
bitmaps blitted at fixed positions, like Black Crypt/DM), by analogy with AP2, whose
`.def` files carry the geometry explicitly. Confidence: medium-low until the `module`
reader is traced.

## Open families — paths tried (empty until game-re works them)

| Family | Approach | Result | Notes |
|---|---|---|---|
| wallset art geometry | — | — | |
| `bpl.*` header | — | — | |
| `ABIC.*` pictures | — | — | |
| palettes | — | — | |
