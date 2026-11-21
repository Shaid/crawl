---
title: Status & Open Work
description: What is verified and what remains open in the Might & Magic II project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/mm2/amiga/textures/intro.png" alt="Might & Magic II title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted Amiga title background: <em>Might and Magic, Book Two</em>.</figcaption>
</figure>

MM2 is one of the most mechanically complete projects in the repo: the retail
records and graphics are decoded and the verification ledger is unusually
strong. The remaining work is mostly semantics that the original ground-truth
project also left opaque.

| Area | Status |
|------|--------|
| `.32` sheets and `.anm` TV | All retail files parse; real-data consumption and frame bytes match the reference fixtures. |
| `.dat` records | Items, monsters, roster, spells, strings, maps, attributes and events decode from retail data. |
| Event VM | All real handler segments disassemble cleanly except the documented mixed Hall of Spells location. |
| DOS `.4`/`.16` graphics | LZW, wall and monster graphics are byte-compared against the reference implementation. |
| Browser/viewer | The generic walker integration exists in the repository; the site currently presents the extraction status rather than a full MM2 chapter. |

## Open work

| Question | Why it remains open |
|----------|--------------------|
| Which `.anm` sequence block is idle, walk or attack? | The longest-block showcase heuristic works, but combat selection is not traced. |
| What do the remaining TV-header bits mean? | `seq_a`, `seq_b` bit 7 and `seq_c` are preserved opaque fields in the source documentation. |
| What is the exact `FrameInfo.flags` bit layout? | Value-level roles are known, but individual bits remain undocumented. |
| What are the roster quest flags and residual `attrib.dat` parameters? | The ground-truth ASM notes preserve these as genuinely unresolved fields. |

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/mm2/TODO.md)
and [format notes](https://github.com/Shaid/crawl/blob/main/docs/mm2/amiga/data-structure.md)
for the verification ledger.
