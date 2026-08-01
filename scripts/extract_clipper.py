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

# Which atlas a named entry lands in. First match wins; unmatched named entries
# go to 'items' and unnamed (numeric/empty-name) ones fall through to the
# dimension-based rules below, and only reach 'misc' if none of those match either.
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
MARKER_GROUPS = (
    ('Start Keys', 'End Keys', 'keys'),
    ('Start Key Holes', 'End Key Holes', 'key-holes'),
    ('Start Floor Items', 'End Floor Items', 'floor-items'),
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


# Dimension-based rules for entries clipper.clp gives NO name to (empty or
# purely numeric — clipper's own directory just has nothing there, so
# keyword matching above can never fire for them). Most of the 751 images'
# "misc" bucket (505 of them) was actually unnamed real content, not
# genuinely uncategorizable junk — spot-checked by rendering every entry at
# a given (w, h) together: each size cluster turned out to be one coherent
# visual category (confirmed by eye, not from any clipper.clp metadata,
# since none exists for these entries):
#   24x24 (180 entries) - weapon/armor/food/jewelry/container icons, the same
#                          visual language as the 48 explicitly-named "items"
#                          entries (Sword, Dagger, Potion, ...) just without
#                          name strings in the archive
#   16x16 (73 entries)  - coloured starburst/orb spell-effect icons
#   32x29 (19 entries)  - coloured chest-armor icons (corrected from an
#                          earlier "heraldry/shield-crest emblem" guess —
#                          these are armor items, folded into 'items' below,
#                          not a separate decorative category)
# `keys`/`key-holes` (see MARKER_GROUPS above) are resolved before this
# table is ever consulted. Everything else unnamed (16x11, 16x15, 8x14
# outside the marker brackets, and other small/thin sizes) stays in `misc`
# — rendered but not confidently classified in this pass.
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


def pick_palette(name, palettes, default):
    """Pick the palette an image was authored against, by name hint."""
    n = name.lower()
    if any(k in n for k in ('automap', 'map')):
        return palettes.get('Automap Palette', default)
    if any(k in n for k in ('char', 'portrait', 'guild')):
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
        rgba = to_rgba(e, pick_palette(e['name'], palettes, default_pal))
        if rgba is None:
            stats['images_skipped'] += 1
            continue
        label = e['name'].strip() or f'entry_{e["index"]:04d}'
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
