---
title: Status & Open Work
description: What is solved and what remains open in the Wizardry 6 reverse-engineering project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/wizardry6/amiga/screens/titlepag.png" alt="Wizardry 6 title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted Amiga title screen for <em>Bane of the Cosmic Forge</em>.</figcaption>
</figure>

Wizardry 6 is a substantial, multi-platform extraction rather than a finished
reimplementation. The table below is the website-sized summary of
`docs/wizardry6/TODO.md`; the raw TODO and platform data-structure documents
carry the full evidence and session history.

## Current boundary

| Area | Current state |
|------|---------------|
| Amiga resource formats | Most major formats confirmed and rendered: `.PIC`, `.EGA`, `mazedata.ega`, fonts, portraits, headers, messages and core databases. |
| Amiga dungeon view | Real 14-level maps and a cell-driven first-person renderer are exported; deferred `.PIC` cel tokens and several overlay semantics remain. |
| DOS/EGA | Shared resources, endian conversion, overlays, platform graphics and the resident loader are substantially documented. |
| SNES graphics/data | Opening sequence, palettes, tile banks, creature sprites, spell animations, maze data and the dungeon composer are extracted; a few runtime semantics remain. |
| Audio | Amiga sound files are catalogued; SNES SPC upload, module directory and BRR banks are structurally identified. |

## Open items

| ID | Status | Question |
|----|--------|----------|
| `maze-plane-semantics` | open | What do most of the 16 Amiga/SNES wall feature codes mean beyond the now-confirmed open, doorway, solid-wall and closed-door values? |
| `dungeon-walker-cell-render-dispatch` | open | How are deferred kind-1/kind-2 queue records resolved from `.PIC` cel tokens to actual frames in the Amiga walker? |
| `dungeon-walker-m6-wiring` | open | Can the remaining Black Crypt-specific entity/prop assumptions be removed from the shared walker package and replaced with Wizardry 6's own schema? |
| `walker-flag-overlays` | open | Wire the per-level skip-ceiling, skip-floor, alternate-floor and fog/view-blocker flags into the Amiga walker. |
| `monster-stat-block` | open | Resolve the remaining monster-stat bytes and the unconfirmed hit-location distribution tables. |
| `pcfile-character-fields` | open | Finish naming the large unresolved spans of the Amiga `PCFILE.DBS` character record. |
| `snes-maze-wall-source` | open | Resolve the remaining SNES feature-byte flags and runtime wall-content semantics that are not needed for the current static render. |
| `snes-creature-frame-semantics` | open | Name the five SNES creature-record type values and finish promoting composed colour poses into the extractor output. |

## Confidence rule

Rendered art is useful evidence but is not automatically format proof. A result
is promoted to confirmed when it is backed by the game's own reader, a complete
file-size/record invariant, an independent platform oracle, or a decisive
render whose inputs are independently understood.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/wizardry6/TODO.md)
for the current row-level evidence.
