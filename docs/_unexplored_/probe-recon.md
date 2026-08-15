# `data/_unexplored_/` — corpus triage

First-contact triage of all 14 unexplored games (2,158 files, 74 MB),
produced with `seer-probe`'s classifier and container scanner (whole
corpus classified in ~4 s). Everything below is **hypothesis** unless
marked confirmed. Confirmed here means: a container parsed with its own
header (real sample rates, valid MOD size closure), or a magic verified
by eye — not gameplay-verified.

## Cross-corpus wins (confirmed)

- **Perihelion** stores its audio as IFF `8SVX` banks **embedded at
  non-zero offsets** inside hash-named files (e.g.
  `PerihelionData/000316B00105D570`: 8 voices at offsets 0x6–0x8a78,
  real VHDR rates 3,151–35,093 Hz). `seer-probe audio <file>` extracts
  every voice to WAV directly. 44 embedded-container hits across the
  game's extensionless files.
- **Zombi**'s `.mus` files are plain ProTracker MODs (`M.K.`, size
  closure holds, tracker loads them: "zombie", "zombie 2"). Its 21
  `.son` files look like length-prefixed raw signed-8 mono PCM
  (sweep: roughness 0.069, lag-1 autocorr 0.76 — real-audio band).
- **Dungeon Master 2**'s `data/music/*.MOD` are NOT ProTracker — magic
  `P41A` = **The Player 4.1A packed modules** (known packer; prowiz-class
  converters exist). Also ships `sample_palette.IFF` (real ILBM).
- **Plain ILBMs hiding in odd places**: Elvira 2 `Pics/` level pictures,
  Hired Guns `game/Characters/*` portraits, Evil's Doom
  `Runecasting`/`Secret`/`Spells`. All parseable with `@seer-project/iff`
  today.
- **Liberation CD32** uses a custom IFF `FORM O3DG` for its 3D vector
  objects (38 `.x3g` files — bank/city/room/shop/droid vectors), and a
  custom `AmSp` magic for its 71 `Wall*.VGM` graphics files (11.9 MB —
  compressed payload after the header). `.sam` files (1.6 MB) profile as
  raw PCM. 22 HUNK executables in the extensionless set.

## Per-game profiles

| Game | Files | MB | Shape |
|---|---|---|---|
| AbandonedPlaces | 5 disks | 4.3 | **5 × 901,120 B = standard 880 KB ADFs with `DOS\0` bootblocks** — mountable AmigaDOS filesystems, not trackload blobs. Parse the filesystem first. |
| AbandonedPlaces2 | 8 | 3.1 | `.000`–`.003` etc. — likely images too (unverified) |
| ChaosStrikesBack | 3 disks | 2.7 | `disk.1/2/3` also `DOS\0` ADFs. DM-engine formats are community-documented (dmweb encyclopaedia) |
| CrystalDragon | 221 | 2.2 | hex-named extensionless small files — index/archive pattern (unprobed) |
| DungeonMaster | 17 | 0.7 | `.ftl`/`.dat` — the extensively community-documented DM format |
| DungeonMaster2 | 44 | 5.5 | `.dat`/`.ftl` + P41A music + IFF palette |
| Elvira | 161 | 3.4 | 130 × `.pkd`; header shape `8009 0600 …` |
| Elvira2 | 244 | 5.0 | 200 × `.pkd` (different header than Elvira 1) + plain-ILBM `Pics/` |
| EvilsDoomAGA | 394 | 11.2 | extensionless + `.bin`/`.dat`; 3 plain ILBMs |
| HiredGuns | 184 | 3.2 | `.gfx` ×38 + character ILBMs |
| LiberationCD32 | 174 | 15.4 | `AmSp` walls, `O3DG` vectors, `.sam` PCM, `.sty` packed |
| Perihelion | 100 | 4.3 | hash-named files, embedded 8SVX banks |
| Waxworks | 421 | 5.8 | 298 × `.pkd`; **same `8009 0600 …` header shape as Elvira 1** |
| Zombi | 43 | 0.8 | MOD music + raw-PCM `.son` + `.seq` |

## Format-family hypotheses worth testing first

1. **Elvira 1 ↔ Waxworks share a `.pkd` packing scheme** (identical
   header shape; both Horrorsoft, same era). Crack once, unlock ~430
   files across two games. Elvira 2's `.pkd` differs — likely a later
   revision of the same packer.
2. **DM / CSB / DM2** need no discovery pass at all — the Dungeon
   Master formats are among the best-documented on the platform; go
   straight to a decoder against the published specs. CSB + Abandoned
   Places ship as plain ADFs, so file extraction is a filesystem walk.
3. **Liberation's `AmSp` + `O3DG`** are self-describing IFF-adjacent
   containers with clean magics — chunk-walk `O3DG` with
   `@seer-project/iff` first; `AmSp`'s payload is compressed
   (entropy ≈ 6.9 in 256 B windows at the head).

## Reproduce

```
node <seer>/packages/probe/bin/seer-probe.mjs map <file>       # segment
node <seer>/packages/probe/bin/seer-probe.mjs audio <file>     # containers + PCM sweep
node <seer>/packages/probe/bin/seer-probe.mjs gfx <file> --regions <map.json>
```

The corpus-wide batch triage script lives in the probe session
scratchpad (`corpus-triage.mjs`) — it is throwaway by design; rerun it
from the probe API (`classifyRegions` + `scanContainers`) if needed.
