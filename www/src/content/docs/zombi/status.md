---
title: Zombi — Status & Open Work
description: What is solved and what remains open for Zombi (Amiga), the picture-per-location crawler.
---

As of 2026-11-21: one recon commit (`182be74`) and one extraction commit
(`fa5decf`). The raw ledger is
[`docs/zombi/TODO.md`](https://github.com/Shaid/crawl/blob/main/docs/zombi/TODO.md).
The [overview](../) has the evidence behind each row.

| Area | Status | Evidence |
|---|---|---|
| Location grid (`plan`) | **Confirmed structure**: 6 floors × 7 × 8; ids 1–86 each appear once | `data-structure.md` § plan |
| Exits (`i-lieux` bytes 0–5) | **Confirmed**: 162/162 open exits land on a location and are matched by it; 6/6 vertical links line up. Compass names are open | § i-lieux |
| Other `i-lieux` fields (6–9, 10–41, 42–49) | Byte 9 (picture override) **confirmed from code**; the rest hypothesis | § i-lieux |
| Location → picture | **Confirmed from code** (`LAB_0275` `+0x5088`, table `+0x50B4`): 90 ids → 77 frames. Not cross-checked in play | § picture map |
| Cyber Paint `.seq` (11 files, 210 frames) | **Extracted**: shared decoder plus test, 0 decode failures, null fails 191/191 | § SEQ |
| Palettes | **Confirmed**: ST channel ×2, found in the executable near `+0x13BB8` | § SEQ correction |
| Sound effects (21 `.SON`) | **Extracted** as WAV, header confirmed 21/21 | § SON |
| Music (`zombi.mus`, `zombi2.mus`) | Standard ProTracker `M.K.`; not exported | § Inventory |
| Objects (`i-objets`, sprite placement) | Hypothesis only | § i-objets |
| `zombi.sys` | Deferred, low value | § Inventory |
| Walker | Not built. Needs the compass orientation; the shape is a picture viewer with exits | `plan.md` |

## Open questions

- `zombi-exit-orientation`: Do `plan` rows count upward or downward, which
  makes bytes 0–3 of `i-lieux` either N, E, S, W or S, E, N, W? And which of
  bytes 4/5 is up?
- `zombi-ilieux-fields`: What do `i-lieux` byte 6 (values 0/1/2, counts
  42/40/8), byte 7 (`00`/`FF`/`80`/`A0`, which looks like an area class), the
  32-byte slot table at 10..41 and bytes 42..49 mean? And what do the special
  exits `F0`/`FA`/`1E` mean?
- `zombi-objects`: Why does `i-objets` have 66 records when `objet.seq` has 67
  frames? And where do objects and zombies go over the location picture?
- `zombi-sys` (deferred, low value): How is `zombi.sys` laid out? It holds a
  re-strided copy of `plan` from `+0x68`.

## What you can check in-game

The raw notes list no in-game checks yet. They do say that the location →
picture map is "not yet cross-checked against live play". The cheapest way to
check it is to visit car-park locations 72, 77 and 82. The `i-lieux` byte-9
override says all three should show the same picture (frame 76). Their
neighbours should show the shared pictures from the `+0x50B4` table.
