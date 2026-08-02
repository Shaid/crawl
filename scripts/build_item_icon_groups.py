#!/usr/bin/env python3
"""Group the `sprites/items` icon atlas for viewer browsing.

`scripts/extract_items.py` writes 180 anonymous icons (`item000` .. `item179`).
`scripts/extract_bcdfs_items.py` separately walks every placed item record in
`bcdfs` and resolves each `gfxNumber` to its real in-game name(s), its icon
index (0-179), and its confirmed engine `itemType` byte — `data/item-names.json`.

This script joins the two: it labels each icon frame with its real name(s)
where known, and buckets the atlas by `itemType` (`bclib.ITEM_TYPE_NAMES`) so
the viewer can browse "all shields", "all potions", etc. instead of one flat
180-icon grid. Icons with no placed-item record (never instantiated on any of
the 13 maps — 55 of 180) get an honest "Unplaced icons" bucket rather than a
guessed name.

Run after both `extract_items.py` and `extract_bcdfs_items.py`.

Output: `public/assets/blackcrypt/amiga/data/item-icon-groups.json`,
registered as `sprites/items`' `groupsFile`.

    python3 scripts/build_item_icon_groups.py
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib

ROOT = Path(__file__).resolve().parents[1]


def main():
    names_path = bclib.asset_dir('data') / 'item-names.json'
    if not names_path.exists():
        print(f'No {names_path} — run scripts/extract_bcdfs_items.py first')
        return

    catalog = json.loads(names_path.read_text())['catalog']

    # icon index -> every gfxNumber catalog entry that resolves to it (usually one).
    by_icon = defaultdict(list)
    for e in catalog:
        if e['iconIndex'] is not None:
            by_icon[e['iconIndex']].append(e)

    frame_labels = {}
    by_type = defaultdict(list)
    unplaced = []
    for icon in range(180):
        frame = f'item{icon:03d}'
        entries = by_icon.get(icon)
        if not entries:
            unplaced.append(frame)
            continue
        # Multiple gfxNumbers can share one icon (e.g. a generic quest-item
        # sprite); show every base name so the label stays honest about that.
        names = []
        for e in entries:
            for n in e['names']:
                if n not in names:
                    names.append(n)
        frame_labels[frame] = ' / '.join(names)
        types = sorted({t for e in entries for t in e['itemTypes']})
        for t in (types or [None]):
            by_type[t].append(frame)

    groups = []
    for t in sorted(k for k in by_type if k is not None):
        label = bclib.ITEM_TYPE_NAMES.get(t)
        name = f'{label} (type {t})' if label else f'Type {t}'
        groups.append({'name': name, 'frames': by_type[t]})
    if None in by_type:
        groups.append({'name': 'Unknown type', 'frames': by_type[None]})
    if unplaced:
        groups.append({'name': 'Unplaced icons (no map instance found)', 'frames': unplaced})

    out = bclib.asset_dir('data') / 'item-icon-groups.json'
    bclib.write_json(out, {
        'source': ('data/item-names.json (bcdfs record walk, gfxNumber -> name '
                    'and itemType) joined against sprites/items.json by icon '
                    'index; itemType labels from bclib.ITEM_TYPE_NAMES'),
        'frameLabels': frame_labels,
        'groups': groups,
    }, pretty=True)

    bclib.set_groups_file('sprites/items', 'data/item-icon-groups.json')
    print(f'  data/item-icon-groups: {len(groups)} groups, '
          f'{len(frame_labels)}/180 icons named, {len(unplaced)} unplaced')


if __name__ == '__main__':
    main()
