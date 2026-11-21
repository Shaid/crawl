# Abandoned Places 2 (Amiga) — open work

Single status surface. Spec: `docs/abandonedplaces2/amiga/data-structure.md`. Plan: `docs/abandonedplaces2/plan.md`.

| ID | Status | Question (one line) | Evidence | Updated |
|----|--------|---------------------|----------|---------|
| ap2-dng-cells | open | Bytes 0.x/3.2/5.3-6 semantics, lists offs[1]/[2]/[3]/[6]/[8]/[9], obj/chest/water/fire record layouts | data-structure.md § 6.2 | 2026-11-21 game-re |
| ap2-misc-gfx | open | `.ani` (37,260), `bank*.bpl` + `.cfs`, `pic_NN`, `chrset*` fonts | data-structure.md § 2 | 2026-11-21 recon |
| ap2-ui-palettes | open | Plane map for UI-drawn images (`items` in the inventory, `icons`, `fspells`, fonts, `menu`, `dispadd`, `plheads`, `pleffect`): exported with the identity map, draw descriptors not traced. Dungeon families are solved (§5.1) | data-structure.md § 5.1 | 2026-11-21 palette pass |
| ap2-palette-ingame-check | open | User check: level 0 corridor = grey stone, darker with depth, no lime; level 2 (set 03) wooden beams on dark rubble; a skeleton = one tan/olive bone ramp. If lime shows in game, §5.1's plane-swap reading is wrong | data-structure.md § 5.1 | 2026-11-21 palette pass |
| ap2-entities | open | Draw monsters/items/objects/chests/water/fire/switches in the walker (draw routines at +0x6952/+0x6A32/+0x6E1C/+0x70BC.., tables undecoded) | § 6.3 | 2026-11-21 game-re |
| ap2-stairs-gates-anim | open | Follow offs[7] stairs between levels (needs start pose rules) and port the gate opening animation (+0x6C16/+0x7FC2) | § 6.2/6.3 | 2026-11-21 game-re |