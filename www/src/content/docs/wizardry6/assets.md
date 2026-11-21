---
title: Extracted Assets
description: Rendered Wizardry 6 screens, maps, monsters, portraits, spells and dungeon views.
---

# Extracted Assets

These are representative views into the generated asset trees. The complete
machine-readable manifests and sidecars remain under `public/assets/wizardry6/`
in the repository; this page keeps the documentation focused on the formats
and the evidence each render provides.

## Amiga screens and sprites

<div class="asset-grid">
<figure><img src="/assets/wizardry6/amiga/screens/titlepag.png" alt="Wizardry 6 Amiga title screen" /><figcaption>Title page.</figcaption></figure>
<figure><img src="/assets/wizardry6/amiga/screens/dragonsc.png" alt="Wizardry 6 Amiga dragon scene" /><figcaption>Dragon scene.</figcaption></figure>
<figure><img src="/assets/wizardry6/amiga/screens/graveyrd.png" alt="Wizardry 6 Amiga graveyard scene" /><figcaption>Graveyard scene.</figcaption></figure>
</div>

<figure>
<img src="/assets/wizardry6/amiga/sprites/wport1.png" alt="Wizardry 6 Amiga portrait strip" style="image-rendering:pixelated;width:100%;max-width:700px;" />
<figcaption>One of the three 14-portrait Amiga `WPORT` strips.</figcaption>
</figure>

## SNES opening and gameplay art

<div class="asset-grid">
<figure><img src="/assets/wizardry6/snes/screens/logo.png" alt="Wizardry 6 SNES opening logo" /><figcaption>Opening logo.</figcaption></figure>
<figure><img src="/assets/wizardry6/snes/screens/dungeon-view-sample.png" alt="Wizardry 6 SNES dungeon view" /><figcaption>First-person dungeon view.</figcaption></figure>
<figure><img src="/assets/wizardry6/snes/sprites/ui-icons.png" alt="Wizardry 6 SNES UI icon bank" /><figcaption>UI icon bank.</figcaption></figure>
</div>

<figure>
<img src="/assets/wizardry6/snes/sprites/creature-sprites.png" alt="Wizardry 6 SNES creature sprite atlas" style="image-rendering:pixelated;width:100%;max-height:36rem;object-fit:contain;background:#08080b;" />
<figcaption>The extracted SNES creature bank. Its colour composition is understood; the remaining open work is naming the record-type variants and promoting the composed poses into a smaller catalogue.</figcaption>
</figure>

<style>
{`
.asset-grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(12rem,1fr)); }
figure { margin:1.25rem 0; }
.asset-grid img { background:#08080b; image-rendering:pixelated; max-height:16rem; object-fit:contain; width:100%; }
figcaption { color:var(--sl-color-gray-3); font-size:.86rem; margin-top:.4rem; }
`}
</style>
