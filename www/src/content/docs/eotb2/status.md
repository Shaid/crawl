---
title: Status & Open Work
description: What is solved and what remains open in the Eye of the Beholder II project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/eotb2/dosvga/screens/intro.png" alt="Eye of the Beholder II title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted DOS/VGA title screen for <em>The Legend of Darkmoon</em>.</figcaption>
</figure>

| Area | Status |
|------|--------|
| DOS/VGA graphics and data | `.DCR`, `.DEC`, alternate `.EGA` palettes, items, text, CPS/VCN and level resources are format-confirmed. |
| DOS/VGA walker | Real level maps and the EOB-family per-tile mosaic compositor are wired. |
| Amiga release | Manuals, maps and solution material are present, but an Amiga extraction pass has not started. |

## Open work

- Wire the six confirmed formats into `extract_eotb2_dosvga.py`.
- Resolve the optional second wall-set palette field and remaining fallback CPS
  palette selection.
- Replace the token-scanned INF header workaround with a format-level account of
  the EOB2 preamble.
- Begin the deferred Amiga pass when the DOS/VGA status is no longer the priority.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/eotb2/TODO.md)
for the exact format and walker evidence.
