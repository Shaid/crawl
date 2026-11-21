---
title: Status & Open Work
description: What is solved and what remains open in the Lands of Lore project.
---

# Status & Open Work

<figure style="margin:1.5rem 0 2rem;text-align:center;">
<img src="/assets/landsoflore/dosvga/screens/title.png" alt="Lands of Lore title screen" width="320" height="200" style="display:block;width:100%;max-width:640px;height:auto;margin:0 auto;image-rendering:pixelated;" />
<figcaption>Extracted DOS/VGA title screen for <em>The Throne of Chaos</em>.</figcaption>
</figure>

| Area | Status |
|------|--------|
| Kyra containers and level data | PAK, CMZ, VCN, VMP, WLL and level/script data are decoded or disassembled; the real-art walker is wired. |
| Wall palette | The embedded 128-colour VCN palette is confirmed and renders coherent level art. |
| EMC2 scripts | The 190-entry syscall table and real level-init script disassembly are extracted; execution is out of scope. |
| Monster/UI SHP | Shape containers decode, but monster/UI atlases still need the original 8-level recolour path applied. |

## Open work

- Reproduce the screen-page semantics in `loadMonsterShapes` to restore SHP
  colour instead of shipping greyscale output.
- Extract the remaining ISO PAK/TLK breadth beyond the representative subset.
- Resolve the exact per-tile VCN brightness-subtable selection formula.

See the [repository TODO](https://github.com/Shaid/crawl/blob/main/docs/landsoflore/TODO.md)
for the current narrowed questions and walker notes.
