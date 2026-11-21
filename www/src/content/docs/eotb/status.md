---
title: Status & Open Work
description: What is solved and what remains open in the Eye of the Beholder I project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/eotb/dosvga/screens/title-v.png" alt="Eye of the Beholder title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted DOS/VGA title screen.</figcaption>
</figure>

| Area | Status |
|------|--------|
| DOS/VGA resources | CPS/VCN, palettes, levels and the major data containers are confirmed; EGA, INF operand widths and ITEM JSON wiring remain. |
| Amiga resources | VCN rendering and the shared DEC layout are confirmed; save data, special compression and multi-palette call-site work remain. |
| First-person walker | A real Amiga walker is shipped with a bespoke per-8×8-tile mosaic compositor; DOS-family renderer work is also represented in the tools. |

## Open work

- Wire the DOS EGA pipeline and the confirmed `ITEM.DAT`/`ITEMTYPE.DAT` fields.
- Resolve the monster CPS palette through its owning level/wall set.
- Finish the Amiga `.INF` walk to the wall/decoration mapping stream rather than
  relying on the current safe generic-wall fallback.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/eotb/TODO.md)
for the full evidence and the walker closure notes.
