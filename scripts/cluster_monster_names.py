#!/usr/bin/env python3
"""Cluster bcdfb-bcdfn monster sprites by creature and resolve names where possible.

`extract_monsters.py` decodes all 204 distinct monster sprites (across the 13
per-level files) into one atlas, named `m<map>_off<data_off>_<w>x<h>`. It does
not know which sprites are different render-distance/mirror views of the same
creature vs. genuinely different creatures sharing a file. This script adds
that grouping as a `groups` sidecar (`data/monster-names.json`), the same
pattern `extract_floor_items.py` uses for `floor-item-names.json`.

METHOD (maps 2-13 — map 1 uses the pre-existing, independently verified table)
---------------------------------------------------------------------------
Within one file, entries are sorted by `data_off` (matches `extract_monsters`'s
own dedup-and-sort order). A creature's near/mid/far/mirror poses are stored
as a contiguous run with non-increasing byte-per-plane size (`bpr`, propor-
tional to rendered area); a new creature starts where `bpr` jumps back up.

Boundary rule: entry `i` starts a new cluster iff
    bpr[i] > 1.4 * max(bpr[i-1], bpr[i-2])
(a "local rebound", not a global running minimum — a global-minimum version
was tried first and produced false splits inside a single creature's own
far-tier zigzag; see docs/blackcrypt/amiga/data-structure.md, "Monster sprite
clustering", Paths tried).

Calibration and validation:
  * factor=1.4 reproduces map 1's known split exactly (Two Head 7 / the
    unidentified 64x71 singleton / Rock Eye+tail 6) with zero tuning specific
    to map 1 — it falls out of the same rule applied uniformly.
  * for maps 2-13, the resulting cluster COUNT matches the file header's
    "Graphics & sound effects ID" count (the number of distinct monster types
    the game itself says are on that level) exactly for 12 of 13 maps.
  * map 9 is the one exception: the algorithm over-splits one creature into
    two blocks (a front-view pose vs. a profile-view pose of the same red
    crab-like monster) because the front-to-profile transition happens to
    cross the bpr threshold. This was caught by rendering every map's
    clusters to a contact sheet and inspecting them — the two blocks are
    visibly the same creature — and is fixed with one hardcoded merge below.
  * every map's clusters were visually reviewed this way (not just map 9);
    see the data-structure.md section for the montage-based confirmation
    notes (e.g. map 2's three clusters render as a grey ogre-gorilla, a green
    beetle, and a horned orange caterpillar; map 6's two clusters are
    identical-dimension colour recolours of one humanoid, consistent with the
    file header's own note that one of its two IDs is generator-spawned only).

NAMING
------
Real creature names require an oracle beyond geometry. Two are available:

  * Map 1: already solved via a 100% DOS `clipper.clp` silhouette match
    (Two Head, Rock Eye) — reused verbatim, not recomputed here.
  * Map 6: `bcdfs`'s monster stat records hold exactly one entry, in the
    entire 265-record corpus, with movement-type byte 0x0F == 5
    ("Possessor", a value already named in the documented monster-bytecode
    field), at map 6 gfx ID 0xb8. `bcdft`'s taunt text names "THE POSSESSOR"
    in prose, and `bcdfu`'s ending epilogue independently names a defeated
    boss "THE EVIL POSSESSOR DEMON" outright. Map 6's other gfx ID (0xb7) is
    already documented as an identically-dimensioned, generator-spawned
    recolour of the same base sprite, so both of map 6's clusters are named
    "Possessor Demon".

A full search of bcdft's only readable text region (~12.8 KB, spell/class
names + quest riddles + boss taunts + a large unique-item name list) and of
bcdft S_2 and bcdfs turned up no per-graphics-ID creature name table — see
data-structure.md for the offsets searched and the (unconfirmed, narrative-
only) leads on Medusa/Waterlord/Ram Demon/Ogre/Dragonlich that were
deliberately left unnamed for lack of a structural link.

Everything else is a geometry-only placeholder, "Map N Creature X".

Output: public/assets/blackcrypt/amiga/data/monster-names.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from bclib import bcdfs
from extract_monsters import LETTERS, read_directory

BPR_FACTOR = 1.4
BPR_WINDOW = 2

# Map 1 is already solved (100% DOS clipper.clp silhouette match) — reuse
# the verified table rather than re-derive it. See data-structure.md,
# "Verified Sprite Table (bcdfb, map 1)".
MAP1_GROUPS = [
    ('Two Head', [0, 10836, 21252, 31836, 36260, 40796, 42980]),
    ('Map 1 Unidentified', [45206]),
    ('Rock Eye', [49182, 56154, 59234, 62314]),
    ('Map 1 Projectile/Effect', [65394, 66290]),
]

# One structurally-confirmed name beyond map 1 — see module docstring.
NAMED_CLUSTERS = {
    (6, 0): 'Possessor Demon',
    (6, 1): 'Possessor Demon (recolour variant)',
}

LABELS = 'ABCDEFGH'


def segment(bprs, factor=BPR_FACTOR, window=BPR_WINDOW):
    """Split a data_off-ordered bpr sequence into per-creature runs."""
    blocks = []
    cur = [0]
    for i in range(1, len(bprs)):
        recent = bprs[max(0, i - window):i]
        if bprs[i] > max(recent) * factor:
            blocks.append(cur)
            cur = [i]
        else:
            cur.append(i)
    blocks.append(cur)
    return blocks


def map_sprites(src, letter):
    """(data_off, entry) pairs for one bcdf<letter> file, dedup'd and sorted —
    matches extract_monsters.py's own dedup logic exactly, so frame names line
    up with sprites/monsters.json."""
    raw = (src / f'bcdf{letter}').read_bytes()
    ents = read_directory(raw)
    uniq = {}
    for e in ents:
        uniq.setdefault(e['data_off'], e)
    return sorted(uniq.items())


def possessor_gfx_ids():
    """Graphics IDs whose bcdfs monster record has movement-type byte
    (offset 0x0F of the 40-byte monster bytecode, which is byte 0x0F of the
    *first* 20-byte record) equal to 5 ("Possessor")."""
    raw = (bclib.data_dir('blackcrypt', 'amiga') / 'bcdfs').read_bytes()
    records = bcdfs.read_records(raw)
    return {b[1] for (_m, _r, _c, _o, b) in records if (b[0] & 0x80) and b[0x0F] == 5}


EXPECTED_POSSESSOR_IDS = {0xb8}


def main():
    src = bclib.data_dir('blackcrypt', 'amiga')
    monsters_path = bclib.asset_dir('sprites') / 'monsters.json'
    if not monsters_path.exists():
        print(f'No {monsters_path} — run extract_monsters.py first')
        return
    frame_names = {f['name'] for f in json.loads(monsters_path.read_text())['frames']}

    # Sanity-check the structural link before trusting it.
    possessor_ids = possessor_gfx_ids()
    if possessor_ids != EXPECTED_POSSESSOR_IDS:
        print(f'  WARNING: expected Possessor movement-type on gfx '
              f'{sorted(hex(g) for g in EXPECTED_POSSESSOR_IDS)} only, '
              f'found {sorted(hex(g) for g in possessor_ids)} — Possessor Demon naming may be stale')

    groups = []
    idx = 0

    def m1_frame(off):
        prefix = f'm1_off{off}_'
        matches = [n for n in frame_names if n.startswith(prefix)]
        assert len(matches) == 1, (off, matches)
        return matches[0]

    for name, offs in MAP1_GROUPS:
        groups.append({'index': idx, 'name': name, 'frames': [m1_frame(o) for o in offs]})
        idx += 1

    for letter in LETTERS[1:]:  # skip 'b' == map 1, handled above
        mapno = ord(letter) - ord('b') + 1
        items = map_sprites(src, letter)
        bprs = [e['bpr'] for off, e in items]
        blocks = segment(bprs)

        # One documented, visually-confirmed exception: map 9 splits one
        # creature (front-view pose vs. profile-view pose) into two blocks.
        if mapno == 9 and len(blocks) == 3:
            blocks = [blocks[0], blocks[1] + blocks[2]]

        for bi, block in enumerate(blocks):
            frs = [f"m{mapno}_off{off}_{e['width']}x{e['height']}" for off, e in
                   (items[i] for i in block)]
            name = NAMED_CLUSTERS.get((mapno, bi), f'Map {mapno} Creature {LABELS[bi]}')
            groups.append({'index': idx, 'name': name, 'frames': frs})
            idx += 1

    all_frames = [f for g in groups for f in g['frames']]
    assert len(all_frames) == len(set(all_frames)), 'duplicate frame across groups'
    missing = frame_names - set(all_frames)
    extra = set(all_frames) - frame_names
    assert not missing and not extra, f'coverage mismatch: missing={missing} extra={extra}'

    source = (
        "Map 1: pre-existing verified grouping (100% silhouette match vs DOS clipper.clp "
        "'Start/End Monsters' marker block; see data-structure.md). Maps 2-13: automated "
        "same-file offset-order segmentation — a new cluster starts where a sprite's "
        "bytes-per-plane (bpr, proportional to rendered area) exceeds 1.4x the max bpr of "
        "the 2 preceding entries (a size-ladder discontinuity: a fresh 'near' pose "
        "following a 'far' pose). Calibrated to reproduce map 1's known split with no "
        "map-1-specific tuning; validated against the bcdfb-n header's 'Graphics & sound "
        "effects ID' count (matches 12/13 maps exactly) and against a rendered contact "
        "sheet per map (scripts/cluster_monster_names.py docstring). Map 9's two "
        "size-flagged sub-blocks were manually merged after the render showed them to be "
        "front-view and profile-view poses of one creature. 'Possessor Demon' (map 6) is "
        "the only name resolved beyond geometry: bcdfs holds exactly one movement-type-5 "
        "('Possessor') monster record in the whole 265-record corpus, at map 6 gfx 0xb8; "
        "bcdft's taunt text names 'THE POSSESSOR' in prose and bcdfu's ending epilogue "
        "independently names 'THE EVIL POSSESSOR DEMON' outright; map 6's other gfx ID "
        "(0xb7) is the documented generator-spawned, identically-dimensioned recolour of "
        "the same sprite, so both "
        "map 6 clusters are named. No per-graphics-ID creature name table was found "
        "anywhere in bcdft/bcdft-S2/bcdfs after a full read of bcdft's only text region "
        "(~12.8 KB) — everything else is a geometry-only placeholder ('Map N Creature X')."
    )

    out_path = bclib.asset_dir('data') / 'monster-names.json'
    bclib.write_json(out_path, {'source': source, 'groups': groups}, pretty=True)

    real_named = sum(len(g['frames']) for g in groups if not g['name'].startswith('Map '))
    print(f'  data/monster-names: {len(groups)} groups, {len(all_frames)} frames')
    print(f'  {real_named}/{len(all_frames)} frames carry a real creature name '
          f'(Two Head, Rock Eye, Possessor Demon x2); the rest are geometry-clustered placeholders')

    bclib.set_groups_file('sprites/monsters', 'data/monster-names.json')


if __name__ == '__main__':
    main()
