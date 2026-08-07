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
  * factor=1.4 reproduced map 1's ORIGINAL 4-way split (Two Head 7 / a
    unidentified 64x71 singleton / Rock Eye+tail 6) with zero tuning specific
    to map 1 — it falls out of the same rule applied uniformly.
  * for maps 2-13, the resulting cluster COUNT matches the file header's
    "Graphics & sound effects ID" count (the number of distinct monster types
    the game itself says are on that level) exactly. With map 1's corrected
    2-way split (below) that is now 13/13 maps, and main() asserts it.
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
    identical-dimension colour recolours of one humanoid, only one of which
    (0xb8) is ever placed on the map).

CLUSTER -> GRAPHICS ID
----------------------
Cluster i is the i'th graphics ID in the bcdfb-n file header (+4/+6/+8). Those
words are stored in **sprite-store order, not sorted** (bcdfj reads `c4, bf`
and bcdfl reads `be, c6, bd`), which is what makes the binding positional and
useful. It is cross-checked three ways: against map 1's DOS ground truth,
against the 214-byte secondary table's trailing 3 x 12 per-creature hitbox
blocks (whose degenerate slots land exactly on the degenerate clusters — see
data-structure.md), and against per-ID behaviour in `bcdfs` (map 7's
one-sprite cluster is the movement-type-1 "stationary" ID). `main()` asserts
cluster count == header ID count for all 13 maps, so a segmenter regression
breaks the build rather than silently relabelling creatures.

NAMING
------
Real creature names require an oracle beyond geometry; there is no bestiary
table anywhere in bcdft/bcdft-S2/bcdfs (confirmed negative). Three oracles:

  * DOS `clipper.clp`'s developer-authored entry names, which cover map 1
    only ("Rock Eye 1 N" ... "Two Head A 0", 7 entries per creature).
  * The official Black Crypt Manual & Clue Book, which names creatures per
    *dungeon level* — turned into a per-file, per-cluster name by MAP_LEVELS
    above. This is where Dragonlich / Ram Demon / Ram Lord / Waterlord /
    Medusa / Statue come from, several of them pinned by an exact match
    between a clue-book note's item list and the monster record's own carried
    sub-chain (the Ram Lord's four items are the clue book's four items).
  * `bcdfu`'s ending epilogue, which names the six unique bosses and supplies
    the Ogre <-> EMERALD KEY link that identifies map 1's "Two Head".
  * DOS `crypt.exe`'s own 26x180-byte creature-name table
    (0x430898-0x431ae0), decoded during the DOS full-game-restoration
    planning pass (full-game-restoration-plan.md SS "1D"/"3.4"). DOS's
    creature gfxId shares the same identifier space as the Amiga bcdfs
    monster record's own +0x01 monster-type byte (SS "0.4"), so this table's
    26 names are real names for the Amiga creatures too, not DOS-only art
    labels. It supplied the 15 previously-unnamed clusters' real names
    outright, and independently confirmed (or, for the Possessor pair,
    corrected) all 11 already-named clusters.

See NAMED_CLUSTERS for the per-cluster evidence and data-structure.md,
"Creature names from DOS crypt.exe's own creature table", for the full
write-up.

All 26 of the 26 clusters (204 of the 204 sprites) are named. 11 came from
the Manual & Clue Book / epilogue pass; the other 15 came from DOS
crypt.exe's own creature-name table, which also independently confirmed
(and, once, corrected — the Possessor / Possessor Body pair) the first 11.

Output: public/assets/blackcrypt/amiga/data/monster-names.json
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from bclib import bcdfs
from extract_monsters import LETTERS, read_directory

BPR_FACTOR = 1.4
BPR_WINDOW = 2

# Map 1 is already solved (DOS clipper.clp silhouette match) — reuse the
# verified table rather than re-derive it. See data-structure.md,
# "Verified Sprite Table (bcdfb, map 1)".
#
# CORRECTION (2026-08-02): the bpr segmenter over-split map 1 into FOUR
# blocks; the trailing three are one creature. DOS `clipper.clp`'s own
# developer-authored entry names settle it byte-for-byte — its
# `Start Monsters`/`End Monsters` bracket holds exactly 14 entries,
# 7 per creature:
#     Rock Eye 1 N / 1 E / 1 S / 2 S / 3 S / A 0 / A 1     (7)
#     Two Head 1 S / 1 E / 2 S / 2 E / 3 S / 3 E / A 0     (7)
# (`<tier> <facing>` = near/mid/far x S/E/N, `A n` = attack pose.) The Amiga
# map-1 store likewise holds 7 + 7 sprites, so the old
# "Unidentified"(1) + "Rock Eye"(4) + "Projectile/Effect"(2) = 7 are all
# Rock Eye. Rendering agrees: 45206 is a mid-size open star-eye and
# 65394/66290 are the closed stone ball at far range.
MAP1_GROUPS = [
    ('Two Head (the Ogre)', [0, 10836, 21252, 31836, 36260, 40796, 42980]),
    ('Rock Eye', [45206, 49182, 56154, 59234, 62314, 65394, 66290]),
]

# bcdfb-bcdfn map index -> the dungeon levels that map covers. One `bcdfs`
# "map" is a *load unit* holding several clue-book levels, told apart by each
# square's own 4-bit level nibble; nibble k is that map's k-th level.
# Established against the official Manual & Clue Book — see data-structure.md,
# "Map <-> dungeon-level mapping".
MAP_LEVELS = {
    1: [1, 2], 2: [3, 4, 5], 3: [6, 7, 8, 9], 4: [10, 11, 12], 5: [13],
    6: [14, 15], 7: [16, 17, 18, 19], 8: [20], 9: [21, 22], 10: [23],
    11: [24, 25, 26], 12: [27], 13: [28],
}

# Creature names resolved beyond geometry, keyed by (map, cluster index).
# Cluster order == the order of the three graphics IDs in the bcdfb-n file
# header (+4/+6/+8) == the block order of the 214-byte secondary table; see
# data-structure.md, "Cluster -> graphics-ID binding". Every entry below is
# backed by an external oracle (clue book / ending epilogue / DOS labels) —
# full evidence in data-structure.md, "Creature names from the Clue Book".
NAMED_CLUSTERS = {
    # gfx 0x50, level 10. No static placement at all (its only bcdfs record is
    # a row-0 prototype) because it is *summoned*: clue book L10 note 10
    # "PLACE IDOLS OF TEMIN HERE TO OPEN THE WAY TO THE DRAGON LICH", epilogue
    # "USING 3 EVIL IDOLS, YOU SUMMONED AND DEFEATED THE DREADED DRAGONLICH".
    # DOS crypt.exe's own creature-name table (gfx 0x50, "Lich Dragon") is a
    # second, independent confirmation (see data-structure.md, "Creature
    # names from DOS crypt.exe's own creature table"); the Amiga-sourced
    # "Dragonlich" name (matching the clue book/epilogue's own word order) is
    # kept as the display name.
    (4, 2): 'Dragonlich',
    # gfx 0xb7 / 0xb8, movement type 5 = "Possessor" (the only such record in
    # the corpus) on 0xb8, which carries the game's only SOUL KEY — clue book
    # L15 note 2: "POSSESSOR HAS THE KEY AND MUST BE KILLED FOR IT".
    #
    # CORRECTED (this pass): DOS crypt.exe's own 26x180-byte creature table
    # (0x430898-0x431ae0) names these "Possessor" (0xb7, unplaced recolour
    # variant) and "Possessor Body" (0xb8, placed, SOUL KEY carrier) — the
    # *reverse* of which one this project's earlier thematic-only guess
    # treated as the "primary" name ("Possessor Demon" on 0xb8, "Possessor
    # Demon (variant)" on 0xb7). The DOS names are literal directory-entry
    # strings the game's own draw code resolves, not a guess, so they
    # supersede the old pair. See data-structure.md's correction block.
    (6, 0): 'Possessor',
    (6, 1): 'Possessor Body',
    # gfx 0xb5: the only key-holding monster on level 17 (an IRON KEY) —
    # clue book L17 note 2 "RAM MINOR DEMON - HOLDS KEY TO DOOR AT (10,4,17)".
    # DOS crypt.exe independently names gfx 0xb5 "Ram Demon" too (11 unique
    # frames vs. Amiga's 10 — see the correction block for the Δ).
    (7, 0): 'Ram Demon',
    # gfx 0xb6, level 20, 550 HP. Its four carried items are, byte for byte,
    # clue book L20 note 2's list: "RAM LORD - HOLDS KEYS TO TWO LOCKED DOORS
    # AS WELL AS AMULET OF POWER (+2 AC, +4 STRENGTH), AND BELT OF SUSTENANCE".
    # DOS crypt.exe independently names gfx 0xb6 "Ram Lord" too (exact frame
    # count match, 10 == 10).
    (8, 0): 'Ram Lord',
    # gfx 0xbc, level 23, 375 HP, carries RING OF LOCATION + a key — clue book
    # L23 note 3 "WATERLORD, HOLDS KEY TO DOOR AT (4,5,23), AND RING OF LOCATION".
    # DOS crypt.exe independently names gfx 0xbc "Water Lord" too (exact frame
    # count match); "The Great Waterlord" (matching the clue book's own
    # epithet) is kept as the display name.
    (10, 0): 'The Great Waterlord',
    # gfx 0xbe: the only unique monster on level 24, the Medusa level. DOS
    # crypt.exe independently names gfx 0xbe "Medusa" too (exact frame count
    # match, 10 == 10).
    (11, 0): 'Medusa',
    # gfx 0xbd is NOT a monster: 0x00BD is the *Statue* structure gfxNumber,
    # and map 11 is the only map carrying type-0x2F statue records (9 of them,
    # all on level 24 = "PREVIOUS ADVENTURERS WERE PLACED HERE WHEN TURNED TO
    # STONE"). It owns no monster record anywhere and its 214-byte block is
    # all zeros. DOS crypt.exe's own creature table also carries gfx 0xbd as
    # "Statue" (3 frames == Amiga's 3), independently confirming it is not a
    # creature the DOS side treats specially either.
    (11, 2): 'Statue (petrified adventurer)',
    # gfx 0xc5, level 28, 350 HP — the final boss, already special-cased in
    # code as gfx word 0x80C5. DOS crypt.exe independently names gfx 0xc5
    # "Estoroth" too (exact frame count match, 11 == 11); "Estoroth
    # Paingiver" (matching the epilogue's own epithet) is kept as the display
    # name.
    (13, 0): 'Estoroth Paingiver',

    # --- Below: 15 clusters newly named this pass from DOS crypt.exe's own
    # 26x180-byte creature-name table (0x430898-0x431ae0, file offset == VA -
    # 0x400000). DOS's creature gfxId field is confirmed (full-game-
    # restoration-plan.md SS "0.4") to share the same identifier space as the
    # Amiga bcdfs monster record's own +0x01 monster-type byte, so these are
    # real names for the Amiga creatures, not just DOS-port art labels. See
    # data-structure.md, "Creature names from DOS crypt.exe's own creature
    # table", for the full cross-reference (gfxId, frame-count match/Δ,
    # evidence) per cluster.
    (2, 0): 'Magnito',        # gfx 0x4f, Amiga n=7 vs DOS n=10 (mirror-aliased)
    (2, 1): 'Green Guy',      # gfx 0xb0, n=4 == 4
    (2, 2): 'Maggot',         # gfx 0xb1, n=10 == 10
    (3, 0): 'Druid Watcher',  # gfx 0x4d, n=10 == 10
    (3, 1): 'Ironhead',       # gfx 0x4e, n=10 == 10
    (3, 2): 'Slime',          # gfx 0xc7, n=4 == 4
    (4, 0): 'Big Glop',       # gfx 0x4b, Amiga n=7 vs DOS n=10 (mirror-aliased)
    (4, 1): 'Little Glop',    # gfx 0x4c, Amiga n=7 vs DOS n=10 (mirror-aliased)
    (5, 0): 'Plant',          # gfx 0xba, n=10 == 10
    (5, 1): 'Spider',         # gfx 0xc3, n=10 == 10
    (7, 1): 'Cloaker',        # gfx 0xb9, Amiga n=1 vs DOS n=2
    (9, 0): 'Merman',         # gfx 0xc4, n=10 == 10
    (9, 1): 'Squid',          # gfx 0xbf, n=10 == 10
    (11, 1): 'Spirit',        # gfx 0xc6, n=4 == 4
    (12, 0): 'Skeleton Lord',  # gfx 0xb4, n=10 == 10
}

LABELS = 'ABCDEFGH'


def header_gfx_ids(src, letter):
    """The bcdfb-n header's graphics IDs at +4/+6/+8, **in file order**.

    NOT sorted: bcdfj is `c4, bf` and bcdfl is `be, c6, bd`. The order is the
    order the creatures' sprites appear in the RLE stream, so ID i belongs to
    cluster i.
    """
    raw = (src / f'bcdf{letter}').read_bytes()
    ids = struct.unpack_from('>3H', raw, 4)
    return [i for i in ids if i]


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
              f'found {sorted(hex(g) for g in possessor_ids)} — Possessor/Possessor Body naming may be stale')

    groups = []
    idx = 0

    def m1_frame(off):
        prefix = f'm1_off{off}_'
        matches = [n for n in frame_names if n.startswith(prefix)]
        assert len(matches) == 1, (off, matches)
        return matches[0]

    map1_ids = header_gfx_ids(src, 'b')
    assert len(map1_ids) == len(MAP1_GROUPS), (map1_ids, len(MAP1_GROUPS))
    for bi, (name, offs) in enumerate(MAP1_GROUPS):
        groups.append({'index': idx, 'name': name,
                       'gfxId': f'0x{map1_ids[bi]:02x}', 'dungeonLevels': MAP_LEVELS[1],
                       'frames': [m1_frame(o) for o in offs]})
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

        # Cluster i <-> header graphics ID i. Asserting the counts match is the
        # same invariant the doc uses to validate the segmenter, and it is what
        # makes the positional ID binding safe: if a map ever segments into a
        # different number of blocks than it declares creatures, the binding
        # (and every name hanging off it) is wrong and this stops the build.
        ids = header_gfx_ids(src, letter)
        assert len(blocks) == len(ids), (
            f'map {mapno}: {len(blocks)} clusters vs {len(ids)} header graphics IDs')

        for bi, block in enumerate(blocks):
            frs = [f"m{mapno}_off{off}_{e['width']}x{e['height']}" for off, e in
                   (items[i] for i in block)]
            name = NAMED_CLUSTERS.get((mapno, bi), f'Map {mapno} Creature {LABELS[bi]}')
            groups.append({'index': idx, 'name': name,
                           'gfxId': f'0x{ids[bi]:02x}', 'dungeonLevels': MAP_LEVELS[mapno],
                           'frames': frs})
            idx += 1

    all_frames = [f for g in groups for f in g['frames']]
    assert len(all_frames) == len(set(all_frames)), 'duplicate frame across groups'
    missing = frame_names - set(all_frames)
    extra = set(all_frames) - frame_names
    assert not missing and not extra, f'coverage mismatch: missing={missing} extra={extra}'

    source = (
        "Clustering — map 1: DOS clipper.clp's own developer-authored entry names "
        "('Rock Eye 1 N ... A 1', 'Two Head 1 S ... A 0'), 7 entries per creature, "
        "matching the Amiga store's 7 + 7 sprites exactly. Maps 2-13: automated "
        "same-file offset-order segmentation — a new cluster starts where a sprite's "
        "bytes-per-plane (bpr, proportional to rendered area) exceeds 1.4x the max bpr of "
        "the 2 preceding entries (a size-ladder discontinuity: a fresh 'near' pose "
        "following a 'far' pose), with one hardcoded merge on map 9. Cluster count now "
        "equals the bcdfb-n header's graphics-ID count for 13/13 maps. "
        "Cluster -> graphics-ID binding: cluster i is header ID i (+4/+6/+8, which are "
        "stored in sprite-store order, NOT sorted — bcdfj is c4,bf and bcdfl is "
        "be,c6,bd); independently corroborated by the 214-byte secondary table, whose "
        "trailing 3 x 12 pair-blocks track each cluster's per-tier width/height and whose "
        "third block is all-zero exactly on bcdfl, whose third ID (0xbd) owns no monster "
        "record. "
        "Names — 11 clusters resolved against the official Black Crypt Manual & Clue Book "
        "plus bcdfu's ending epilogue, via the map<->dungeon-level mapping in "
        "docs/blackcrypt/amiga/data-structure.md: Two Head/the Ogre (carries the game's "
        "only EMERALD KEY, which the epilogue says is taken from 'THE OGRE'), Rock Eye, "
        "Dragonlich (summoned by the 3 Idols of Temin on level 10), Possessor / Possessor "
        "Body (level 14/15; only movement-type-5 record is on Possessor Body, which "
        "carries the only SOUL KEY), Ram Demon (only key-holder on level 17), Ram Lord "
        "(level 20; its 4 carried items are clue book L20 note 2's list byte for byte), "
        "The Great Waterlord (level 23; RING OF LOCATION + key), Medusa (only unique "
        "monster on level 24), Statue (gfx 0xbd is the Statue structure gfxNumber, not a "
        "creature) and Estoroth Paingiver (level 28 final boss). No per-graphics-ID "
        "creature name table exists anywhere in bcdft/bcdft-S2/bcdfs itself (confirmed "
        "negative), but DOS crypt.exe's own 26x180-byte creature table "
        "(0x430898-0x431ae0, decoded during the DOS full-game-restoration planning pass) "
        "shares the same gfxId space as the Amiga bcdfs monster record's +0x01 "
        "monster-type byte (full-game-restoration-plan.md SS 0.4) and supplied real, "
        "literal names for the other 15 clusters outright (Magnito, Green Guy, Maggot, "
        "Druid Watcher, Ironhead, Slime, Big Glop, Little Glop, Plant, Spider, Cloaker, "
        "Merman, Squid, Spirit, Skeleton Lord), while independently confirming (exact "
        "frame-count match on 9/11) or correcting (the Possessor pair, which the earlier "
        "thematic-only guess had backwards) the first 11. All 26 clusters / 204 sprites "
        "now carry a real creature name; see data-structure.md, 'Creature names from DOS "
        "crypt.exe's own creature table', for the per-cluster evidence."
    )

    out_path = bclib.asset_dir('data') / 'monster-names.json'
    bclib.write_json(out_path, {'source': source, 'groups': groups}, pretty=True)

    named = [g for g in groups if not g['name'].startswith('Map ')]
    real_named = sum(len(g['frames']) for g in named)
    print(f'  data/monster-names: {len(groups)} groups, {len(all_frames)} frames')
    print(f'  {real_named}/{len(all_frames)} frames carry a real creature name '
          f'across {len(named)}/{len(groups)} clusters')

    bclib.set_groups_file('sprites/monsters', 'data/monster-names.json')


if __name__ == '__main__':
    main()
