#!/usr/bin/env python3
"""Extract clipper.clp — the DOS/VGA resource archive — into public/assets.

Format:
  [2 bytes]  Entry count (uint16 LE)
  [816 x 56 byte entries]
  [Raw data]

Entry (56 bytes):
  +0x00: char[40]  Null-terminated name
  +0x28: uint8     Type (1=marker, 2=image, 3=palette, 4=sound, 5=speedfx)
  +0x2A: uint32    Data size
  +0x2E: uint32    Data offset (from start of file)
  +0x34: uint16    Width (for images)
  +0x36: uint16    Height (for images)

Images are raw 8-bit indexed pixels, uncompressed. Palettes are 768 bytes
(256 x RGB). Sounds carry WAV or IFF headers, or none at all.

The 751 images are packed into a few semantic atlases rather than one file per
sprite; each frame keeps its original archive name, so nothing is lost.
"""
import argparse
import struct
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib

GAME, PLATFORM = 'blackcrypt', 'dosvga'
DEFAULT_CLP = bclib.data_dir(GAME, PLATFORM) / 'clipper.clp'

# Background colours the archive uses as transparency keys.
#   brown (95,67,51) on monster/item/UI sprites
#   cyan  (0,255,255) on sky and wall tiles
KNOWN_BG = ((95, 67, 51), (0, 255, 255))

# Which atlas a *named* entry lands in when no MARKER_GROUPS bracket claims it
# first. First match wins; unmatched named entries go to 'items'. Unnamed
# entries never reach this table — all 505 of them sit inside a marker bracket
# (see MARKER_GROUPS), which is why the 'misc' bucket no longer exists.
GROUPS = [
    ('dungeon', ('wall', 'door', 'floor', 'ceiling', 'pillar', 'stairs',
                 'alcove', 'plaque', 'pit', 'button', 'pressure plate',
                 'pull chain', 'panel', 'fountain', 'ram block')),
    ('monsters', ('rock eye', 'two head')),
    ('ui', ('font', 'bar', 'box', 'arrow', 'symbol', 'spell', 'page', 'face',
            'cg ', 'auto map', 'automap', 'options', 'depth', 'castor', 'gem',
            'skull', 'north', 'east', 'south', 'west', 'stat', 'hands',
            'scroll', 'line dissolve', 'ghost', 'mouse', 'bubble', 'stone',
            'small', 'death box', 'leader', 'weapon hit', 'fire animation')),
]

# clipper.clp's own directory brackets several runs of otherwise-unnamed
# entries with explicit type=1 "Start X"/"End X" marker entries — a far more
# precise classifier than dimension clustering, since it doesn't collide
# with unrelated entries that happen to share a size (see MARKER_GROUPS'
# docstring below). Index ranges are resolved once per `parse_clp` call in
# `marker_group_ranges` and consulted by `group_for` before the dimension
# fallback.
#
# `Start Keys`/`End Keys` (313-341, 29 x 8x14) is the DOS counterpart of the
# Amiga `bcdfa` key-icon bank (`bclib.bcdfa.key_icon_sprites`,
# `SLOT_TEXT_RESOURCE` tail at chunk offset 0x7CA0) — confirmed
# byte-identical in silhouette, 3,248/3,248 px (100.000%) across 29/29
# frames (see docs/blackcrypt/amiga/data-structure.md, "the 29 key icons").
#
# `Start Key Holes`/`End Key Holes` (344-430, 87 = 29 x 3 depths, 16x20/
# 16x15/16x11) is the DOS counterpart of the Amiga `bcdfb`-`bcdfn`
# wall-decoration bank (`sprites/wall-decorations.*`, 39 groups x 3 depths,
# 117 sprites) — not just a size coincidence (flagged but unconfirmed in an
# earlier pass, see this file's "Correction" block above): a per-entry
# greyscale correlation against every Amiga wall-decoration frame of the
# same depth finds a >=0.95 match for **29/29** DOS entries at all three
# depths (several Amiga (map, decoration) pairs reuse the same art, which is
# why more than 29 Amiga frames correlate in total). This is why the
# wall-decoration bank's contents (lock plates, a red-cross panel, a
# gargoyle face) are keyhole surrounds — the DOS archive names the whole
# category outright. See docs/blackcrypt/dos/data-structure.md for the
# verification numbers.
#
# `Start Floor Items`/`End Floor Items` (652-798, 147 = 49 groups x 3
# depths) was already a **confirmed** match to the Amiga floor-item bank
# before this pass (147/147 (w,h) pairs exact at the same group index,
# 99.992% silhouette agreement — see data-structure.md's "Amiga item-name
# cross-reference" correction blocks) but was never wired into this
# extractor's bucketing: the 49 named (depth-0) entries fell through into
# `items` and the 98 unnamed depth-1/2 entries into `misc`, split apart from
# each other and from unrelated content. Routed here as one `floor-items`
# bucket instead, mirroring the Amiga side's own `sprites/floor-items.*`.
#
# `Start CG Numbers`/`End CG Numbers` (208-220, 11 x 8x7, unnamed) is the
# character-generation numeral font, and it is **byte-identical** to the
# Amiga `bcdfo` numeral bank (`scripts/render_all.py`'s `numerals`,
# 0xF286...0xF5CE, 11 glyphs x 16x7 with the shared 1-bit mask at 0xF278):
# that mask is `11111111 00000000` on every row, so the Amiga glyph only
# ever occupies its left 8 columns, and cropping it there reproduces the
# DOS entry's *palette indices* exactly — 616/616 px (100.000%) across
# 11/11 glyphs, same ink registers 27/28/29 on the same background 30.
# Slot 0 is a blank glyph, slots 1-10 are digits `0`-`9`, matching the
# Amiga bank's documented "one blank slot + digits 0-9". Routed to `ui`,
# next to `CG Font`/`CG Options`/`CG Guild N`.
#
# `Start Throwing Items`/`End Throwing Items` (432-445, 12 entries) is the
# in-flight projectile sprite bank: **four** weapons x 3 shrinking view
# depths, only the near-depth entry of each named (`Arrow` 16x11, `Dagger`
# 16x7, `Sword` 32x15, `Hammer` 16x13) — the archive's usual "name the
# first of N" convention, which is why the 8 mid/far entries used to fall
# into `misc` while their 4 named near siblings scattered into `ui`
# (keyword `arrow`) and `items`. The first six shapes are the DOS
# counterpart of the Amiga `bcdfa` entry-12 bank (16x11/16x8/16x5 arrow,
# 16x7/16x5/16x3 dagger — 6/6 exact); `Sword` and `Hammer` are
# **DOS-exclusive**: the Amiga bank is closed at 2 weapons (12 descriptors
# tiling 1,092 B with zero slack, a 2-way `TST.W D0` weapon-type branch in
# the flight animator at S_1 `+0x21A78`, and a 12-B-per-weapon hot-spot
# table with 2 rows). This art is distinct from the same weapons'
# `floor-items` sprites, which are 2-5x wider (a sword lying on the floor
# is 80x9; the thrown one is 32x15).
#
# The five remaining brackets below hold entries the *dimension* fallback
# already bucketed correctly, but by eye rather than by evidence. Routing
# them through their markers makes the classification archive-driven and
# leaves membership unchanged, while independently confirming the earlier
# visual calls with zero deviation:
#   Speed Graphics (227-301) = 73 entries, all 16x16 == the whole 16x16
#     unnamed cluster the doc labelled `spell-effects` by eye
#   Items (446-622) = 175 + Misc (623-629) = 5, all 24x24 == the whole
#     180-entry 24x24 cluster the doc labelled `items` by eye
#   Chest (630-650) = 19, all 32x29 == the whole 19-entry 32x29 cluster,
#     first guessed `heraldry`, then corrected to chest armor by eye —
#     `Chest` is the equipment slot, so the correction was right
#   Monsters (800-815) = 14, exactly the 14 the `rock eye`/`two head`
#     keywords already caught
MARKER_GROUPS = (
    ('Start CG Numbers', 'End CG Numbers', 'ui'),
    ('Start Keys', 'End Keys', 'keys'),
    ('Start Key Holes', 'End Key Holes', 'key-holes'),
    ('Start Throwing Items', 'End Throwing Items', 'throwing-items'),
    ('Start Speed Graphics', 'End Speed Graphics', 'spell-effects'),
    ('Start Items', 'End Items', 'items'),
    ('Start Misc', 'End Misc', 'items'),
    ('Start Chest', 'End Chest', 'items'),
    ('Start Floor Items', 'End Floor Items', 'floor-items'),
    ('Start Monsters', 'End Monsters', 'monsters'),
)


def marker_group_ranges(entries):
    """``{entry_index: group}`` for every entry inside a `MARKER_GROUPS` bracket."""
    markers = {e['name'].strip(): e['index'] for e in entries if e['type'] == 1}
    out = {}
    for start_name, end_name, group in MARKER_GROUPS:
        start, end = markers.get(start_name), markers.get(end_name)
        if start is None or end is None:
            continue
        for i in range(start + 1, end):
            out[i] = group
    return out


# Residual safety net, kept but **no longer reachable for this build of
# clipper.clp**: with `MARKER_GROUPS` above covering every bracket, all
# **505/505** unnamed image entries (empty or purely-numeric name — clipper's
# own directory just has nothing there, so the keyword classifier can never
# fire for them) now resolve through a type-1 marker bracket, zero deviation,
# and the `misc` bucket is empty. This table is what used to sort them, by
# rendering every entry of a given (w, h) together and calling the cluster by
# eye; each of those three visual calls is now independently confirmed by the
# bracket that turns out to contain exactly that cluster and nothing else:
#   24x24 (180) -> `items`          == Start Items (175) + Start Misc (5)
#   16x16  (73) -> `spell-effects`  == Start Speed Graphics (73)
#   32x29  (19) -> `items`          == Start Chest (19)  ["Chest" is the
#                  equipment slot, so the earlier `heraldry` guess really was
#                  wrong and its correction to chest armor really was right]
# Left in place only so a different clipper.clp (e.g. the full retail archive
# rather than this demo) with an unbracketed run still lands somewhere sane.
UNNAMED_DIMENSION_GROUPS = {
    (24, 24): 'items',
    (16, 16): 'spell-effects',
    (32, 29): 'items',
}


def parse_clp(path):
    """Parse clipper.clp into a list of entry dicts."""
    data = Path(path).read_bytes()
    num = struct.unpack_from('<H', data, 0)[0]
    entries = []
    for i in range(num):
        off = 2 + i * 56
        entries.append({
            'index': i,
            'name': data[off:off + 40].split(b'\x00')[0].decode('ascii', errors='replace'),
            'type': data[off + 40],
            'size': struct.unpack_from('<I', data, off + 42)[0],
            'data_offset': struct.unpack_from('<I', data, off + 46)[0],
            'width': struct.unpack_from('<H', data, off + 52)[0],
            'height': struct.unpack_from('<H', data, off + 54)[0],
        })
        e = entries[-1]
        e['data'] = data[e['data_offset']:e['data_offset'] + e['size']]
    return entries


# Marker brackets whose (unnamed) entries were authored against a palette the
# name-hint rules in `pick_palette` can't see, because the entries carry no
# name at all. `Start CG Numbers` is the character-generation numeral font:
# every glyph is drawn purely out of registers 27/28/29 on background 30 —
# the same accent ramp `CG Symbol 1`-`4` and `CG Stat Area` use, and the same
# registers the Amiga bank the glyphs are byte-identical to draws them in.
# Under the default `Palette` that ramp is a muddy brown (83,67,35 ->
# 131,115,83); under `Character Gen Palette` it is the intended orange
# (192,64,0 -> 240,112,48).
MARKER_PALETTES = {
    'Start CG Numbers': 'Character Gen Palette',
}


def marker_palette_ranges(entries):
    """``{entry_index: palette_name}`` for every entry in a `MARKER_PALETTES` bracket."""
    markers = {e['name'].strip(): e['index'] for e in entries if e['type'] == 1}
    out = {}
    for start_name, pal_name in MARKER_PALETTES.items():
        start, end = markers.get(start_name), markers.get('End ' + start_name[6:])
        if start is None or end is None:
            continue
        for i in range(start + 1, end):
            out[i] = pal_name
    return out


# Atlas frame labels for brackets whose entries carry no name of their own but
# whose contents are individually identified (see the DOS data-structure doc).
# Without these the frames read `434_entry_0434`, which loses everything the
# identification established.
#
# `Start Throwing Items` uses the archive's "name the first of N" convention:
# each weapon's near-depth entry is named and its mid/far siblings are not, so
# the near name propagates forward with a depth suffix. Verified against the
# Amiga bank for the first six (silhouette 624/624 px, 100.000%).
#
# `Start CG Numbers` is a blank glyph followed by digits 0-9 — byte-identical
# to the Amiga `bcdfo` numeral bank cropped to its mask's left 8 columns
# (616/616 palette indices, 100.000%).
DEPTH_SUFFIXES = ('near', 'mid', 'far')
DEPTH_LABELLED_BRACKETS = ('Start Throwing Items',)
CG_NUMBER_LABELS = ('blank',) + tuple(str(d) for d in range(10))


def derived_labels(entries):
    """``{entry_index: label}`` for unnamed entries this project has identified."""
    markers = {e['name'].strip(): e['index'] for e in entries if e['type'] == 1}
    by_index = {e['index']: e for e in entries}
    out = {}

    for start_name in DEPTH_LABELLED_BRACKETS:
        start, end = markers.get(start_name), markers.get('End ' + start_name[6:])
        if start is None or end is None:
            continue
        stem, depth = None, 0
        for i in range(start + 1, end):
            name = by_index[i]['name'].strip()
            if name:
                stem, depth = name, 0
            elif stem is None:
                continue    # unnamed run before any named entry — nothing to inherit
            else:
                depth += 1
            if depth < len(DEPTH_SUFFIXES):
                out[i] = f'{stem}_{DEPTH_SUFFIXES[depth]}'

    start, end = markers.get('Start CG Numbers'), markers.get('End CG Numbers')
    if start is not None and end is not None and end - start - 1 == len(CG_NUMBER_LABELS):
        for n, i in enumerate(range(start + 1, end)):
            out[i] = f'CG Number {CG_NUMBER_LABELS[n]}'
    return out


def pick_palette(name, palettes, default, forced=None):
    """Pick the palette an image was authored against, by name hint.

    `forced` (a palette name from `marker_palette_ranges`) wins outright — it
    comes from clipper.clp's own section markers, which cover the entries that
    have no name for the hints below to match on.
    """
    if forced and forced in palettes:
        return palettes[forced]
    n = name.lower()
    if any(k in n for k in ('automap', 'map')):
        return palettes.get('Automap Palette', default)
    # `cg ` (character generation) before the `options` rule below, so
    # `CG Options` gets the chargen palette its 26-30 accent ramp is drawn in
    # rather than the standalone options screen's.
    if n.startswith('cg ') or any(k in n for k in ('char', 'portrait', 'guild')):
        return palettes.get('Character Gen Palette', default)
    if any(k in n for k in ('title', 'logo', 'raven')):
        return palettes.get('Title Palette', default)
    if 'options' in n:
        return palettes.get('Options Palette', default)
    return default


def group_for(entry, marker_ranges=None):
    # A `MARKER_GROUPS` bracket wins outright — it's a more precise, more
    # complete signal than either the keyword or dimension classifiers below
    # (it applies to *every* entry in the bracket, named or not, so e.g. all
    # 147 Floor Items stay together instead of splitting 49 named / 98
    # unnamed across two unrelated buckets).
    if marker_ranges and entry['index'] in marker_ranges:
        return marker_ranges[entry['index']]
    n = entry['name'].lower().strip()
    if not n or n.replace(' ', '').isdigit():
        # clipper.clp gives this entry no name at all — fall back to a
        # dimension-based guess (see UNNAMED_DIMENSION_GROUPS) before giving
        # up and calling it 'misc'.
        return UNNAMED_DIMENSION_GROUPS.get((entry['width'], entry['height']), 'misc')
    if n.startswith('title '):
        return 'screens'
    for group, keywords in GROUPS:
        if any(k in n for k in keywords):
            return group
    return 'items'


def to_rgba(entry, pal_bytes):
    """Indexed pixels + 768-byte palette → (h, w, 4) RGBA, background keyed out."""
    w, h = entry['width'], entry['height']
    if w == 0 or h == 0 or len(entry['data']) < w * h:
        return None
    idx = np.frombuffer(entry['data'][:w * h], dtype=np.uint8).reshape(h, w)

    pal = np.zeros((256, 3), dtype=np.uint8)
    if pal_bytes and len(pal_bytes) >= 768:
        pal = np.frombuffer(bytes(pal_bytes[:768]), dtype=np.uint8).reshape(256, 3).copy()

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, :3] = pal[idx]
    out[:, :, 3] = 255
    for bg in KNOWN_BG:
        out[:, :, 3][np.all(out[:, :, :3] == np.array(bg, dtype=np.uint8), axis=2)] = 0
    return out


def main():
    ap = argparse.ArgumentParser(description='Extract clipper.clp into public/assets')
    ap.add_argument('clp', nargs='?', default=str(DEFAULT_CLP))
    args = ap.parse_args()

    clp = Path(args.clp)
    if not clp.exists():
        print(f'  {clp} not found — skipping DOS assets')
        return

    entries = parse_clp(clp)
    stats = Counter()
    marker_ranges = marker_group_ranges(entries)
    marker_pals = marker_palette_ranges(entries)
    labels = derived_labels(entries)

    palettes = {e['name']: e['data'] for e in entries if e['type'] == 3}
    default_pal = next(iter(palettes.values()), None)

    # Palettes as JSON, for runtime remapping.
    pal_dir = bclib.asset_dir('palettes', GAME, PLATFORM)
    for name, raw in palettes.items():
        safe = name.replace('/', '_').replace('\\', '_').replace(' ', '_') or 'palette'
        colors = [{'r': raw[i * 3], 'g': raw[i * 3 + 1], 'b': raw[i * 3 + 2]}
                  for i in range(min(256, len(raw) // 3))]
        bclib.write_json(pal_dir / f'{safe}.json', {'colors': colors}, pretty=True)
        stats['palettes'] += 1

    # Images, bucketed into atlases.
    buckets = {}
    for e in entries:
        if e['type'] != 2:
            continue
        rgba = to_rgba(e, pick_palette(e['name'], palettes, default_pal,
                                       marker_pals.get(e['index'])))
        if rgba is None:
            stats['images_skipped'] += 1
            continue
        label = (labels.get(e['index'])
                 or e['name'].strip()
                 or f'entry_{e["index"]:04d}')
        buckets.setdefault(group_for(e, marker_ranges), []).append((f'{e["index"]:03d}_{label}', rgba))
        stats['images'] += 1

    manifest_entries = []
    for group, sprites in sorted(buckets.items()):
        # The four 320x200 "Title N" entries are full screens, not sprites.
        category, name = ('screens', 'title') if group == 'screens' else ('sprites', group)
        sheet, frames = bclib.pack_atlas(sprites)
        manifest_entries.append(bclib.write_atlas(
            name, sheet, frames, category=category,
            game=GAME, platform=PLATFORM, register=False))
        print(f'  {category}/{name}: {len(frames)} frames ({sheet.shape[1]}x{sheet.shape[0]})')

    # Sounds, kept in whatever container they ship in.
    snd_dir = bclib.asset_dir('audio', GAME, PLATFORM)
    for e in entries:
        if e['type'] != 4:
            continue
        d = e['data']
        ext = '.wav' if d[:4] == b'RIFF' else '.iff' if d[:4] in (b'FORM', b'8SVX', b'AIFF') else '.raw'
        safe = e['name'].replace('/', '_').replace('\\', '_').replace(' ', '_') or f'sound_{e["index"]:04d}'
        (snd_dir / f'{safe}{ext}').write_bytes(d)
        stats['sounds'] += 1

    bclib.write_manifest(manifest_entries, GAME, PLATFORM)
    bclib.write_platform_index([(GAME, PLATFORM)])
    print('  ' + ', '.join(f'{k}: {v}' for k, v in sorted(stats.items())))


if __name__ == '__main__':
    main()
