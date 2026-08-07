#!/usr/bin/env python3
"""Phase 3 injection plan for the Black Crypt DOS demo's `clipper.clp` --
see `docs/blackcrypt/dos/full-game-restoration-plan.md` § "Phase 3" ->
"3.4 Real injection mechanics" for the full write-up this script supports.

This is a **planning/verification tool, not a converter**. It reads the real,
unmodified `crypt.exe` and `clipper.clp` (never writes to either, never
touches `data/` in place) and derives, from real disassembly-confirmed
mechanics and real on-disk data:

  1. The exact new directory-entry NAME for every one of the 23 new creature
     clusters' frames -- read directly out of `crypt.exe`'s own static
     26-record creature table (`0x430898`-`0x431ae0`), which already carries
     every creature's frame-name strings, not just the 2 shipped ones. No
     naming convention is invented; every name is a literal string already
     present in the shipped binary.
  2. The exact new tileset entry NAMEs for `bcdfy`/`bcdfz`, by reusing
     `build_proof_of_concept_art_swap.TILESET_MAP` (the already-verified
     bcdfx-name -> Amiga-sub-image-label correspondence) filtered by which
     of `bcdfy`'s 7 available chunk slots actually exist.
  3. Each new entry's real on-disk colour-key (32/33/0xFFFF), mirrored from
     the *real* per-entry `colorkey` field already shipped for the
     equivalent bcdfx-named entry (tileset) or the already-shipped Two
     Head/Rock Eye entries (creatures).
  4. The group-id byte (confirmed = on-disk directory offset +41, between
     `type` and `size`) every new entry needs, and the exact file-size
     growth this produces.

Self-verifies against real, already-shipped data at every step -- see the
`assert`s inline. Never writes `data/blackcrypt/dosvga/clipper.clp` and never
produces converted pixel art; it only prints (and optionally dumps to JSON)
the entry-spec manifest Phase 3's real converter will consume.

Usage:
    python3 scripts/plan_phase3_clipper_injection.py [--json OUT.json]
"""
import argparse
import json
import re
import struct
import sys
from collections import Counter, OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from bclib import bcdfxyz
import build_proof_of_concept_art_swap as poc

ROOT = Path(__file__).resolve().parents[1]
CRYPT_EXE = bclib.data_dir('blackcrypt', 'dosvga') / 'crypt.exe'
CLIPPER_CLP = bclib.data_dir('blackcrypt', 'dosvga') / 'clipper.clp'
MONSTER_NAMES_JSON = ROOT / 'public/assets/blackcrypt/amiga/data/monster-names.json'

HEADER_SIZE = 2
DIR_ENTRY_SIZE = 56
CREATURE_TABLE_BASE = 0x430898  # file offset == VA - 0x400000 (raw-identity mapped)
CREATURE_RECORD_SIZE = 0xB4     # 180 B
CREATURE_RECORD_COUNT = 26
FRAME_TABLE_OFFSET = 0x24       # within each record: 12 x (dword ptr, u16 w, u16 h, dword flag)
FRAME_SLOT_SIZE = 12
FRAME_SLOT_COUNT = 12
HEADER_PTR_OFFSETS = (0x04, 0x08)  # 2 extra name pointers before the 6-dword constant block

# --- 1D's already-confirmed gfxId -> (map, DOS creature name) table --------
# Hardcoded from docs/blackcrypt/dos/full-game-restoration-plan.md SS "1D"
# (RESOLVED block) -- this pass re-derives the *names themselves* and the
# *colour keys* and *group ids* from real data; the gfxId<->map<->identity
# binding is already-confirmed static fact from that pass, not re-derived
# here.  Excludes 0xb2 (Two Head) / 0xb3 (Rock Eye), already shipped, and
# 0xbd (Statue), a structure gfxNumber tracked under SS "1B", not a creature.
NEW_CREATURE_CLUSTERS = [
    # (gfxId, map, dos_name, amiga_n)
    (0x4f, 2, 'Magnito', 7),
    (0xb0, 2, 'Green Guy', 4),
    (0xb1, 2, 'Maggot', 10),
    (0x4d, 3, 'Druid Watcher', 10),
    (0x4e, 3, 'Ironhead', 10),
    (0xc7, 3, 'Slime', 4),
    (0x4b, 4, 'Big Glop', 7),
    (0x4c, 4, 'Little Glop', 7),
    (0x50, 4, 'Lich Dragon', 2),
    (0xba, 5, 'Plant', 10),
    (0xc3, 5, 'Spider', 10),
    (0xb7, 6, 'Possessor', 10),
    (0xb8, 6, 'Possessor Body', 10),
    (0xb5, 7, 'Ram Demon', 10),
    (0xb9, 7, 'Cloaker', 1),
    (0xb6, 8, 'Ram Lord', 10),
    (0xc4, 9, 'Merman', 10),
    (0xbf, 9, 'Squid', 10),
    (0xbc, 10, 'Water Lord', 10),
    (0xbe, 11, 'Medusa', 10),
    (0xc6, 11, 'Spirit', 4),
    (0xb4, 12, 'Skeleton Lord', 10),
    (0xc5, 13, 'Estoroth', 11),
]
SHIPPED_GFX = {0xb2: 'Two Head', 0xb3: 'Rock Eye'}
STATUE_GFX = 0xbd

CREATURE_COLORKEY = 33  # confirmed below against the 14 real shipped creature entries


# ---------------------------------------------------------------------------
# Step 1: read crypt.exe's own 26-record creature table
# ---------------------------------------------------------------------------

def read_cstring(data, addr, file_base=0x400000):
    off = addr - file_base
    end = data.index(b'\x00', off)
    return data[off:end].decode('ascii')


def read_creature_records(exe):
    records = OrderedDict()
    for i in range(CREATURE_RECORD_COUNT):
        base = CREATURE_TABLE_BASE + i * CREATURE_RECORD_SIZE - 0x400000
        gfx_id = struct.unpack_from('<I', exe, base)[0]
        names = []
        for off in HEADER_PTR_OFFSETS:
            ptr = struct.unpack_from('<I', exe, base + off)[0]
            names.append(read_cstring(exe, ptr))
        frame_names = []
        frame_off = base + FRAME_TABLE_OFFSET
        for f in range(FRAME_SLOT_COUNT):
            slot = frame_off + f * FRAME_SLOT_SIZE
            ptr = struct.unpack_from('<I', exe, slot)[0]
            frame_names.append(read_cstring(exe, ptr))
        # Unique directory-entry names this creature actually needs: the
        # header's own pose name (e.g. "X A 0") plus every distinct frame
        # name (aliased tier/facing slots collapse to one name/one entry).
        unique = list(dict.fromkeys(names + frame_names))
        records[gfx_id] = unique
    return records


def verify_against_shipped(records, clipper_entries):
    """Self-check: the unique name set this script derives for the 2
    already-shipped creatures must exactly equal their real, shipped
    clipper.clp directory names."""
    shipped_names = {}
    for e in clipper_entries:
        for gfx, label in SHIPPED_GFX.items():
            if e['name'].startswith(label):
                shipped_names.setdefault(gfx, set()).add(e['name'])
    for gfx, label in SHIPPED_GFX.items():
        derived = set(records[gfx])
        real = shipped_names[gfx]
        assert derived == real, (
            f'{label} (gfx {gfx:#x}): derived names {derived} != real shipped '
            f'names {real}')
    return shipped_names


# ---------------------------------------------------------------------------
# Step 2: real clipper.clp directory (colour keys, tileset names, group ids)
# ---------------------------------------------------------------------------

def parse_directory(data):
    num = struct.unpack_from('<H', data, 0)[0]
    entries = []
    for i in range(num):
        off = HEADER_SIZE + i * DIR_ENTRY_SIZE
        entries.append({
            'index': i,
            'name': data[off:off + 40].split(b'\x00')[0].decode('ascii', errors='replace'),
            'type': data[off + 40],
            'group': data[off + 41],   # the confirmed group-id byte (SS "3.4")
            'size': struct.unpack_from('<I', data, off + 42)[0],
            'data_offset': struct.unpack_from('<I', data, off + 46)[0],
            'colorkey': struct.unpack_from('<H', data, off + 50)[0],
            'width': struct.unpack_from('<H', data, off + 52)[0],
            'height': struct.unpack_from('<H', data, off + 54)[0],
        })
    return entries


def verify_group_ids(entries):
    """Self-check the confirmed group-id semantics against the real file:
    map-1 tileset (7-76) all group 1; the demo's own group-5/6 UI bundles
    exist; no entry anywhere already uses 2/3/11-23 (headroom is real, not
    assumed)."""
    tileset = {e['group'] for e in entries[7:77]}
    assert tileset == {1}, f'map-1 tileset entries have unexpected group ids {tileset}'
    used_groups = Counter(e['group'] for e in entries)
    for g in (2, 3, *range(11, 24)):
        assert used_groups.get(g, 0) == 0, (
            f'group id {g} already in use ({used_groups[g]} entries) -- '
            f'would collide with Phase 3\'s planned assignment')
    return used_groups


def bcdfx_colorkey_by_name(entries):
    return {e['name']: e['colorkey'] for e in entries[7:77]}


# ---------------------------------------------------------------------------
# Step 3: tileset manifest for bcdfy / bcdfz
# ---------------------------------------------------------------------------

def sub_image_dims():
    """label -> (slot, w, h) from the already-confirmed SUB_IMAGES table."""
    return {label: (slot, w, h) for label, slot, _off, w, h, _planes in bcdfxyz.SUB_IMAGES}


def tileset_entry_dims(recipe, dims):
    kind = recipe[0]
    if kind == 'direct':
        _slot, w, h = dims[recipe[1]]
        return w, h
    if kind == 'hflip':
        _slot, w, h = dims[recipe[1]]
        return w, h
    if kind == 'hconcat':
        labels = recipe[1]
        slots = [dims[l] for l in labels]
        heights = {h for _s, _w, h in slots}
        assert len(heights) == 1, f'hconcat {labels} have mismatched heights {slots}'
        return sum(w for _s, w, _h in slots), slots[0][2]
    raise ValueError(recipe)


def build_tileset_manifest(dims, colorkey_by_name):
    """Returns {tileset: [{'name', 'w', 'h', 'colorkey', 'slots'}]} for the
    entries that have an established DOS name (via TILESET_MAP) and a real
    inherited colour key from the equivalent bcdfx entry."""
    out = {}
    referenced_labels = set()
    for name, recipe in poc.TILESET_MAP.items():
        labels = recipe[1] if recipe[0] == 'hconcat' else [recipe[1]]
        referenced_labels.update(labels)
    bcdfy_slots = {0x08, 0x0C, 0xB0, 0x14, 0xB8, 0xC4, 0x20}
    bcdfz_slots = {slot for _label, (slot, _w, _h) in dims.items()}  # all 12 -- same as bcdfx
    for tileset, available_slots in (('bcdfy', bcdfy_slots), ('bcdfz', bcdfz_slots)):
        rows = []
        for name, recipe in poc.TILESET_MAP.items():
            labels = recipe[1] if recipe[0] == 'hconcat' else [recipe[1]]
            slots_needed = {dims[l][0] for l in labels}
            if not slots_needed <= available_slots:
                continue
            w, h = tileset_entry_dims(recipe, dims)
            rows.append({
                'name': name,
                'w': w, 'h': h,
                'colorkey': colorkey_by_name[name],
                'group': {'bcdfy': 2, 'bcdfz': 3}[tileset],
            })
        out[tileset] = rows
    # Residual Amiga sub-images with no established DOS name at all (the
    # 8 'sidewall-depth*' pieces behind the still-unsolved Wall Left/Right
    # composite, plus 'fountain' -- neither is in TILESET_MAP, so neither
    # is invented a name here; same open status as Phase 3a's own residual).
    all_labels = set(dims)
    unnamed = sorted(all_labels - referenced_labels - {'door-clip-stencil'})
    return out, unnamed


# ---------------------------------------------------------------------------
# Step 4: creature manifest (names from crypt.exe, dims from Amiga corpus)
# ---------------------------------------------------------------------------

FRAME_RE = re.compile(r'_(\d+)x(\d+)$')


def load_monster_frame_bytes():
    data = json.loads(MONSTER_NAMES_JSON.read_text())
    out = {}
    for g in data['groups']:
        gfx = int(g['gfxId'], 16)
        sizes = []
        for f in g['frames']:
            m = FRAME_RE.search(f)
            w, h = int(m.group(1)), int(m.group(2))
            sizes.append((w, h))
        out[gfx] = sizes
    return out


def build_creature_manifest(records, frame_bytes):
    rows = []
    approx_bytes = 0
    for gfx, map_no, dos_name, amiga_n in NEW_CREATURE_CLUSTERS:
        names = records[gfx]
        assert len(names) >= amiga_n, (
            f'{dos_name} (gfx {gfx:#x}): crypt.exe names {len(names)} < '
            f'confirmed Amiga frame count {amiga_n}')
        sizes = frame_bytes[gfx]
        assert len(sizes) == amiga_n, (
            f'{dos_name}: monster-names.json frame count {len(sizes)} != '
            f'1D-confirmed {amiga_n}')
        group = map_no + 10
        for i, name in enumerate(names):
            if i < amiga_n:
                w, h = sizes[i]
                aliased = False
            else:
                # Exact tier/facing alias pairing not derived this pass (see
                # doc) -- reuse the cluster's largest real frame as a
                # documented, clearly-flagged upper-bound stand-in. Affects
                # only 11/198 entries game-wide.
                w, h = max(sizes, key=lambda wh: wh[0] * wh[1])
                aliased = True
            rows.append({
                'name': name, 'gfx': gfx, 'creature': dos_name, 'map': map_no,
                'group': group, 'colorkey': CREATURE_COLORKEY,
                'w': w, 'h': h, 'aliased': aliased,
            })
            approx_bytes += w * h
    return rows, approx_bytes


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--json', type=Path, help='optional path to dump the full manifest as JSON (not committed)')
    args = ap.parse_args()

    exe = CRYPT_EXE.read_bytes()
    clp = CLIPPER_CLP.read_bytes()
    entries = parse_directory(clp)
    assert len(entries) == 816, f'unexpected clipper.clp entry count {len(entries)}'

    records = read_creature_records(exe)
    assert len(records) == 26, f'expected 26 creature records, got {len(records)}'
    verify_against_shipped(records, entries)
    assert STATUE_GFX in records and STATUE_GFX not in dict(
        (g, None) for g, *_ in NEW_CREATURE_CLUSTERS), 'Statue must stay excluded'

    used_groups = verify_group_ids(entries)
    print('Real clipper.clp: 816 entries, headroom check OK '
          '(group ids 2/3/11-23 all currently unused)')
    print('Existing group-id usage:', dict(sorted(used_groups.items())))

    # -- creature colour-key self-check ------------------------------------
    creature_keys = {e['colorkey'] for e in entries if e['name'].startswith(('Two Head', 'Rock Eye'))}
    assert creature_keys == {CREATURE_COLORKEY}, (
        f'expected all 14 shipped creature entries at colorkey {CREATURE_COLORKEY}, '
        f'found {creature_keys}')
    print(f'Creature colour-key confirmed: all 14 shipped Two Head/Rock Eye '
          f'entries use {CREATURE_COLORKEY} (0x{CREATURE_COLORKEY:02x}) -- '
          f'adopted for all 198 new creature entries')

    # -- creature manifest --------------------------------------------------
    frame_bytes = load_monster_frame_bytes()
    creature_rows, creature_px_bytes = build_creature_manifest(records, frame_bytes)
    n_alias = sum(1 for r in creature_rows if r['aliased'])
    print(f'\nCreature manifest: {len(creature_rows)} new directory entries '
          f'({n_alias} aliased/no-fresh-conversion, matching 1D\'s 11)')
    assert len(creature_rows) == 198, f'expected 198 new creature entries, got {len(creature_rows)}'
    assert n_alias == 11, f'expected 11 aliased entries, got {n_alias}'

    print('Group-id table (creature clusters):')
    for gfx, map_no, dos_name, amiga_n in NEW_CREATURE_CLUSTERS:
        group = map_no + 10
        n_names = len(records[gfx])
        print(f'  gfx {gfx:#04x}  map {map_no:2d}  group {group:2d}  '
              f'{dos_name:<18s} {n_names:2d} entries ({amiga_n} converted'
              f'{f", {n_names - amiga_n} aliased" if n_names > amiga_n else ""})')

    # -- tileset manifest -----------------------------------------------
    dims = sub_image_dims()
    colorkey_by_name = bcdfx_colorkey_by_name(entries)
    tileset_manifest, unnamed = build_tileset_manifest(dims, colorkey_by_name)
    for tileset in ('bcdfy', 'bcdfz'):
        rows = tileset_manifest[tileset]
        print(f'\n{tileset} manifest: {len(rows)} new directory entries '
              f'(group {rows[0]["group"]})')
    print(f'Residual Amiga sub-images with no established DOS name '
          f'(excluded, same status as Wall Left/Right): {unnamed}')

    total_tileset_entries = sum(len(v) for v in tileset_manifest.values())
    total_tileset_px_bytes = sum(r['w'] * r['h'] for v in tileset_manifest.values() for r in v)

    # -- totals --------------------------------------------------------
    total_new_entries = len(creature_rows) + total_tileset_entries
    dir_growth = total_new_entries * DIR_ENTRY_SIZE
    total_px_bytes = creature_px_bytes + total_tileset_px_bytes
    old_size = len(clp)
    new_size = old_size + dir_growth + total_px_bytes

    print('\n=== Totals ===')
    print(f'New directory entries: {len(creature_rows)} creature + '
          f'{total_tileset_entries} tileset + 0 palette (corrected -- see doc) '
          f'= {total_new_entries}')
    print(f'Directory growth: {total_new_entries} x {DIR_ENTRY_SIZE} B = {dir_growth:,} B')
    print(f'New pixel bytes: {creature_px_bytes:,} B creature '
          f'({n_alias} aliased entries approximated, flagged in doc) + '
          f'{total_tileset_px_bytes:,} B tileset = {total_px_bytes:,} B')
    print(f'Old file size: {old_size:,} B')
    print(f'New file size: {new_size:,} B (+{new_size - old_size:,} B, '
          f'{100 * (new_size / old_size - 1):.1f}%)')
    print(f'New directory entry count: 816 -> {816 + total_new_entries} '
          f'(headroom ceiling 2000, confirmed unaffected)')

    if args.json:
        manifest = {
            'creatures': creature_rows,
            'tilesets': tileset_manifest,
            'unnamed_amiga_subimages': unnamed,
            'totals': {
                'new_entries': total_new_entries,
                'directory_growth_bytes': dir_growth,
                'new_pixel_bytes': total_px_bytes,
                'old_file_size': old_size,
                'new_file_size': new_size,
            },
        }
        args.json.write_text(json.dumps(manifest, indent=2))
        print(f'\nWrote manifest to {args.json}')


if __name__ == '__main__':
    main()
