#!/usr/bin/env python3
"""Phase 3 resource injection for the Black Crypt Windows demo's
`clipper.clp` — TODO `blackcrypt-phase3-injection`; plan doc
`docs/blackcrypt/dos/full-game-restoration-plan.md` § "Phase 3" and
§ "Phase 3 injector — 2026-11-13".

The inverse of `scripts/extract_clipper.py`. It reads the stock demo
`clipper.clp` (never writes it), appends new image entries built from the
Amiga data, and writes a new archive to a gitignored build path.

## What gets added (all type 2 = image, raw 8-bit, appended at EOF)

* **Creatures** — every creature record in `crypt.exe`'s 26 x 180-B table
  (`0x430898`) except the two the demo ships (Two Head, Rock Eye): 23
  clusters plus Statue (`0xbd`, `Statue 1/2/3`). Names are the literal
  strings the record points at. **Pixels come from the Amiga monster file's
  own frame directory**, not from frame order: each `bcdfb`-`bcdfn` file has
  42 x 28-B entries = 3 creature slots x 12 (tier x facing N,E,S,W) at
  `c*12 + s`, then 3 x 2 pose entries at `36 + 2c` (+0/+1 = `A 0`/`A 1`).
  The DOS record's frame slot `s` and pose names line up with those, so
  each DOS name resolves to exactly one Amiga bitmap (`data_off`), with W
  slots mirrored on both sides (DOS flag 1 / Amiga type `0x500`). This also
  resolves the 11 "aliased" names (e.g. `Magnito 1 N` and `1 E` share one
  Amiga bitmap). Oracle: Two Head and Rock Eye resolve to Amiga bitmaps whose
  (w, h) equal the shipped DOS entries' 14/14. Group = map + 10.
* **Tilesets** — `bcdfy` (group 2, map 5) and `bcdfz` (group 3, maps 6-11),
  reusing `bcdfx`'s DOS names (the by-name lookup filters on the active
  tileset group) and each `bcdfx` sibling's colour key; recipes from
  `build_proof_of_concept_art_swap.TILESET_MAP` plus `Wall Left`/`Wall
  Right` (review finding 4). Oracle: the same builder run on `bcdfx`
  reproduces the shipped map-1 entries (see the self-check output).
* **Special panels** (review finding 5, gfx `0x46`) — `The <X> Panel`
  bodies (80x72, 6-plane opaque) and their inset sprites (`blue eyes`,
  `sun key`, `moon key`, `crown`, `pearl`; 7-plane masked) named by
  `crypt.exe`'s 6 x 40-B table at `0x4307a8`. Amiga source: the tail of
  `bcdfc/d/e/g/j/l` after the 1,932-B wall-decoration block — 4,320-B body,
  112-B (4 x 28-B blit descriptors), then the inset pixels — read by the
  Amiga level loader (S_1 `+0x21F1C`-`+0x21F72`) only for levels whose
  gate word at S_1 `+0x21FE8` is non-zero (2,3,4,6,9,11 — the same maps as
  the DOS table). The `smiley` placeholder (maps 4/11, drawn at 0,0) is
  deliberately not added (one name, two different bitmaps, unfiltered
  lookup).

## Pixel conversion: direct index copy (review finding 3)

DOS `Palette` entries 0-63 are the Amiga EHB palette (ramp 0) except 19,
32, 33 and 51; 26-31/58-63 are re-programmed per map at runtime (the
map-switch ramp patch). So Amiga indices are copied straight through, with:
`32 -> 0` (both black; the shipped port does exactly this, 97/97 px in the
map-1 tileset) and 19/33/51 -> nearest RGB among the other non-ramp,
non-key indices 0-63. Masked pixels become the entry's colour key.

## Repo hygiene

Reads `data/` only; refuses any output under `data/`; defaults to
`build/blackcrypt/phase3/clipper.clp` (gitignored). Never commit the output.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib  # noqa: E402
from bclib import bcdfxyz, levelfile, palette as PL  # noqa: E402
import build_proof_of_concept_art_swap as poc  # noqa: E402
import extract_clipper  # noqa: E402
import extract_monsters  # noqa: E402
import plan_phase3_clipper_injection as plan  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DOS = ROOT / 'data' / 'blackcrypt' / 'dosvga'
AMIGA = ROOT / 'data' / 'blackcrypt' / 'amiga'
EXTRACTED = ROOT / 'data' / 'blackcrypt' / 'extracted'
DEFAULT_OUT = ROOT / 'build' / 'blackcrypt' / 'phase3' / 'clipper.clp'

HEADER = 2
REC = 56
IMAGE_TYPE = 2
STOCK_COUNT = 816
STOCK_SIZE = 1_151_267
TABLE_CAPACITY = 2000          # runtime directory 0x43c7a0, 2000 x 68 B
CREATURE_KEY = 33
INSET_KEY = 33
OPAQUE_KEY = 0xFFFF

SHIPPED_GFX = (0xB2, 0xB3)     # Two Head, Rock Eye
STATUE_GFX = 0xBD
LETTERS = 'bcdefghijklmn'      # bcdfb = map 1 ... bcdfn = map 13
RAMP = set(range(26, 32)) | set(range(58, 64))
CHANGED_IN_DOS = (19, 32, 33, 51)   # DOS Palette differs from Amiga EHB here

# crypt.exe's special-panel table (0x4307a8, 6 x 40 B): map, body name,
# then up to 4 x (inset name ptr, x, y).
PANEL_TABLE = 0x4307A8
PANEL_TABLE_N = 6
PANEL_SKIP_INSETS = {'smiley'}

TILESET_GROUP = {'bcdfy': 2, 'bcdfz': 3}
TILESET_SLOTS = {
    'bcdfy': {0x08, 0x0C, 0xB0, 0x14, 0xB8, 0xC4, 0x20},
    'bcdfz': None,     # all 12, same as bcdfx
}
# Review finding 4 (verified 11,200/11,200 px each against the shipped
# map-1 entries; near/far swapped scores 4,811): 80x140, background 32.
SIDE_WALLS = {
    'Wall Left': ('near', [(0, 0, 0), (1, 16, 5), (2, 48, 18), (3, 64, 24)]),
    'Wall Right': ('far', [(0, 64, 0), (1, 32, 5), (2, 16, 18), (3, 0, 24)]),
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def cstr(exe: bytes, va: int) -> str:
    o = va - 0x400000
    return exe[o:exe.index(b'\0', o)].decode('ascii')


def build_lut(dos_palette: np.ndarray, amiga_ehb: np.ndarray) -> tuple[np.ndarray, dict]:
    """Amiga 6-bit index -> DOS index. Identity except CHANGED_IN_DOS."""
    lut = np.arange(64, dtype=np.uint8)
    lut[32] = 0
    stable = [i for i in range(64) if i not in RAMP and i not in CHANGED_IN_DOS]
    notes = {32: (0, 0.0)}
    for v in (19, 33, 51):
        d = ((dos_palette[stable].astype(int) - amiga_ehb[v].astype(int)) ** 2).sum(1)
        k = int(np.argmin(d))
        lut[v] = stable[k]
        notes[v] = (stable[k], float(np.sqrt(d[k])))
    return lut, notes


REMAPPED = Counter()   # Amiga index -> opaque pixels whose index changed


def convert(idx: np.ndarray, mask: np.ndarray | None, lut: np.ndarray, key: int) -> np.ndarray:
    src = np.asarray(idx, dtype=np.uint8)
    out = lut[src]
    opaque = np.ones(src.shape, bool) if mask is None else np.asarray(mask) > 0
    for v in CHANGED_IN_DOS:
        REMAPPED[v] += int(((src == v) & opaque).sum())
    if mask is not None:
        out = np.where(np.asarray(mask) > 0, out, np.uint8(key if key != OPAQUE_KEY else 0))
    return out.astype(np.uint8)


class Entry:
    __slots__ = ('name', 'group', 'key', 'pixels', 'kind', 'source')

    def __init__(self, name, group, key, pixels, kind, source):
        self.name, self.group, self.key = name, group, key
        self.pixels, self.kind, self.source = pixels, kind, source


# --------------------------------------------------------------------------
# creatures
# --------------------------------------------------------------------------

def read_exe_creatures(exe: bytes):
    """[(gfx, header_names[2], slots[12] = (name, w, h, flag))]"""
    out = []
    for i in range(plan.CREATURE_RECORD_COUNT):
        b = plan.CREATURE_TABLE_BASE + i * plan.CREATURE_RECORD_SIZE - 0x400000
        gfx = struct.unpack_from('<I', exe, b)[0]
        hdr = [cstr(exe, struct.unpack_from('<I', exe, b + o)[0]) for o in (4, 8)]
        slots = []
        for s in range(12):
            p, w, h, fl = struct.unpack_from('<IHHI', exe, b + 0x24 + 12 * s)
            slots.append((cstr(exe, p), w, h, fl))
        out.append((gfx, hdr, slots))
    return out


def load_monster_files():
    files = {}
    for m, L in enumerate(LETTERS, start=1):
        raw = (AMIGA / f'bcdf{L}').read_bytes()
        ents = extract_monsters.read_directory(raw)
        dec = bclib.rle_decompress(raw, bclib.MONSTER_STREAM_START)
        gfx_ids = [struct.unpack_from('>H', raw, o)[0] for o in (4, 6, 8)]
        files[m] = (raw, ents, dec, gfx_ids)
    return files


def resolve_creature(gfx, hdr, slots, files):
    """{dos_name: amiga dir entry} via the slot correspondence; raises on
    any name resolving to two different bitmaps."""
    hits = [(m, gl.index(gfx)) for m, (_r, _e, _d, gl) in files.items() if gfx in gl]
    if not hits:
        raise KeyError(f'gfx {gfx:#x} not in any bcdfb-n header')
    m, c = hits[0]
    ents = files[m][1]
    pairs = []
    for k, name in enumerate(hdr):
        pairs.append((name, ents[36 + 2 * c + k], 0))
    for s, (name, _w, _h, fl) in enumerate(slots):
        pairs.append((name, ents[c * 12 + s], fl))
    resolved, mirror_agree, mirror_total = {}, 0, 0
    for name, e, fl in pairs:
        mirrored = e['type'] == 0x500
        if fl == 1 or mirrored:
            mirror_total += 1
            mirror_agree += int((fl == 1) == mirrored)
            continue
        prev = resolved.get(name)
        if prev is not None and prev['data_off'] != e['data_off']:
            raise AssertionError(f'{name!r}: two Amiga bitmaps '
                                 f'({prev["data_off"]}, {e["data_off"]})')
        resolved[name] = e
    unique = list(dict.fromkeys([n for n, _e, _f in pairs]))
    missing = [n for n in unique if n not in resolved]
    if missing:
        raise AssertionError(f'gfx {gfx:#x}: names only reachable mirrored: {missing}')
    return m, c, resolved, (mirror_agree, mirror_total)


def build_creatures(exe, files, lut, clp_entries, log):
    recs = read_exe_creatures(exe)
    by_name = {e['name']: e for e in clp_entries}

    # Oracle: the shipped creatures resolve to bitmaps of the shipped dims.
    ok = total = 0
    for gfx, hdr, slots in recs:
        if gfx not in SHIPPED_GFX:
            continue
        _m, _c, res, _mir = resolve_creature(gfx, hdr, slots, files)
        for name, e in res.items():
            d = by_name[name]
            total += 1
            ok += int((e['width'], e['height']) == (d['width'], d['height']))
    # Null control: pair names with Amiga frames in plain file order but
    # rotated by one -- must collapse.
    null_ok = null_total = 0
    for gfx, hdr, slots in recs:
        if gfx not in SHIPPED_GFX:
            continue
        _m, _c, res, _mir = resolve_creature(gfx, hdr, slots, files)
        names = list(res)
        dims = [(res[n]['width'], res[n]['height']) for n in names]
        rot = dims[1:] + dims[:1]
        for n, dd in zip(names, rot):
            null_total += 1
            null_ok += int(dd == (by_name[n]['width'], by_name[n]['height']))
    log.append(f'creature pairing oracle (shipped Two Head + Rock Eye): '
               f'{ok}/{total} (w,h) exact; rotated-pairing null control '
               f'{null_ok}/{null_total}')
    if ok != total or total != 14:
        raise AssertionError('creature slot correspondence failed on the shipped creatures')

    out = []
    mir_a = mir_t = 0
    offsets = []
    plan_names = plan.read_creature_records(exe)
    for gfx, hdr, slots in recs:
        if gfx in SHIPPED_GFX:
            continue
        m, _c, res, (ma, mt) = resolve_creature(gfx, hdr, slots, files)
        mir_a += ma
        mir_t += mt
        if set(res) != set(plan_names[gfx]):
            raise AssertionError(f'gfx {gfx:#x}: name set differs from the planner')
        dec = files[m][2]
        group = m + 10
        for name in plan_names[gfx]:      # planner order: pose names, then slots
            e = res[name]
            w, h, bpr, off = e['width'], e['height'], e['bpr'], e['data_off']
            idx, mask = bclib.decode_masked(dec[off:off + 7 * bpr], w, h)
            px = convert(idx, mask, lut, CREATURE_KEY)
            kind = 'statue' if gfx == STATUE_GFX else 'creature'
            out.append(Entry(name, group, CREATURE_KEY, px, kind,
                             f'bcdf{LETTERS[m - 1]} off {off} {w}x{h} gfx {gfx:#x}'))
        # Draw-offset plausibility (finding 6): slot w ~ half the frame width.
        for s, (name, sw, _sh, _fl) in enumerate(slots):
            if sw:
                offsets.append(sw / res[name]['width'])
    log.append(f'creature W-slot mirror agreement (DOS flag 1 <-> Amiga type '
               f'0x500): {mir_a}/{mir_t}')
    if offsets:
        a = np.array(offsets)
        log.append(f'frame-slot x-offset / Amiga frame width: median {np.median(a):.3f}, '
                   f'{int(((a < 0.25) | (a > 0.75)).sum())}/{len(a)} outside 0.25-0.75')
    return out


# --------------------------------------------------------------------------
# tilesets
# --------------------------------------------------------------------------

def decode_sub(chunks, label):
    sub = next(s for s in bcdfxyz.SUB_IMAGES if s[0] == label)
    _l, slot, off, w, h, planes = sub
    data = chunks[slot]
    if planes == 7:
        idx, mask = bclib.decode_masked(data[off:], w, h, 6)
        return np.asarray(idx), np.asarray(mask) > 0
    idx = bclib.decode_planar(data[off:], w, h, planes)
    return np.asarray(idx), None


def tile_pixels(chunks, name, key, lut):
    if name in SIDE_WALLS:
        assert key == 32, (name, key)
        kind, layout = SIDE_WALLS[name]
        idx = np.full((140, 80), 32, np.uint8)        # background = index 32
        known = np.zeros((140, 80), bool)
        for depth, x, y in layout:
            i, m = decode_sub(chunks, f'sidewall-depth{depth}-{kind}')
            hh, ww = i.shape
            region, kr = idx[y:y + hh, x:x + ww], known[y:y + hh, x:x + ww]
            region[m] = i[m]
            kr[m] = True
        out = lut[idx]
        out[~known] = 32                               # keep the key, not lut[32]
        return out
    recipe = poc.TILESET_MAP[name]
    labels = recipe[1] if recipe[0] == 'hconcat' else [recipe[1]]
    pieces = []
    for lab in labels:
        i, m = decode_sub(chunks, lab)
        pieces.append(convert(i, m, lut, key))
    px = np.hstack(pieces)
    if recipe[0] == 'hflip':
        px = np.fliplr(px)
    return px


def tileset_names(tileset):
    slots = TILESET_SLOTS[tileset]
    dims = {s[0]: s[1] for s in bcdfxyz.SUB_IMAGES}
    names = []
    for name, recipe in poc.TILESET_MAP.items():
        labels = recipe[1] if recipe[0] == 'hconcat' else [recipe[1]]
        if slots is None or {dims[l] for l in labels} <= slots:
            names.append(name)
    if slots is None or 0x08 in slots:
        names += list(SIDE_WALLS)
    return names


def build_tilesets(s1, lut, clp_entries, clp_raw, log):
    stock = poc.parse_directory(clp_raw)
    sib = {e['name']: e for e in stock[7:77]}
    data_by = {e['name']: e for e in clp_entries[7:77]}

    # Oracle: rebuild the shipped map-1 tileset from bcdfx with the same code.
    chx = bcdfxyz.read_chunks(s1, (AMIGA / 'bcdfx').read_bytes(), 'bcdfx', bclib.rle_decompress)
    eq = n = 0
    worst = []
    before = REMAPPED.copy()       # the oracle pass must not count as output
    for name in tileset_names('bcdfz'):
        px = tile_pixels(chx, name, sib[name]['colorkey'], lut)
        d = data_by[name]
        ref = np.frombuffer(d['data'], np.uint8).reshape(d['height'], d['width'])
        if px.shape != ref.shape:
            raise AssertionError(f'{name}: built {px.shape} vs shipped {ref.shape}')
        k = int((px == ref).sum())
        eq += k
        n += ref.size
        worst.append((k / ref.size, name))
    worst.sort()
    REMAPPED.clear()
    REMAPPED.update(before)
    log.append(f'tileset oracle (bcdfx rebuilt vs shipped map-1 entries, '
               f'{len(worst)} entries): {eq}/{n} px = {100 * eq / n:.2f}% exact; '
               f'lowest: ' + ', '.join(f'{nm} {100 * r:.1f}%' for r, nm in worst[:4]))
    for side in SIDE_WALLS:
        r = next(r for r, nm in worst if nm == side)
        if r != 1.0:
            raise AssertionError(f'{side} recipe no longer exact on bcdfx ({r})')
    fp = next(r for r, nm in worst if nm == 'Floor Pit D')
    log.append(f'Floor Pit D (left orientation) vs shipped: {100 * fp:.1f}%')

    out = []
    for ts in ('bcdfy', 'bcdfz'):
        ch = bcdfxyz.read_chunks(s1, (AMIGA / ts).read_bytes(), ts, bclib.rle_decompress)
        names = tileset_names(ts)
        for name in names:
            key = sib[name]['colorkey']
            out.append(Entry(name, TILESET_GROUP[ts], key, tile_pixels(ch, name, key, lut),
                             'tileset', ts))
        log.append(f'{ts}: {len(names)} entries (group {TILESET_GROUP[ts]})')
    return out


# --------------------------------------------------------------------------
# special panels
# --------------------------------------------------------------------------

def read_panel_table(exe):
    rows = []
    for i in range(PANEL_TABLE_N):
        o = PANEL_TABLE - 0x400000 + 40 * i
        m = struct.unpack_from('<h', exe, o)[0]
        body = cstr(exe, struct.unpack_from('<I', exe, o + 4)[0])
        insets = []
        for k in range(4):
            p, x, y = struct.unpack_from('<Ihh', exe, o + 8 + 8 * k)
            insets.append((cstr(exe, p), x, y))
        rows.append((m, body, insets))
    return rows


def build_panels(exe, s1, lut, log):
    gate = levelfile.gate_table(s1)
    table = read_panel_table(exe)
    gated = [i + 1 for i, g in enumerate(gate) if g]
    if gated != [m for m, _b, _i in table]:
        raise AssertionError(f'Amiga panel gate maps {gated} != DOS panel table maps '
                             f'{[m for m, _b, _i in table]}')
    out = []
    pos_ok = pos_n = 0
    for m, body, insets in table:
        raw = (AMIGA / f'bcdf{LETTERS[m - 1]}').read_bytes()
        lay = levelfile.tail_layout(raw, s1, m)
        p = lay['panel']
        idx = bclib.decode_planar(raw[p:p + levelfile.PANEL_BODY_BYTES],
                                  levelfile.PANEL_BODY_W, levelfile.PANEL_BODY_H, 6)
        out.append(Entry(body, m + 10, OPAQUE_KEY, convert(idx, None, lut, OPAQUE_KEY),
                         'panel', f'bcdf{LETTERS[m - 1]} +{p:#x}'))
        dp, pix = lay['panel_desc'], lay['inset_pixels']
        seen = {}
        for k, (name, x, y) in enumerate(insets):
            d = raw[dp + 28 * k:dp + 28 * k + 28]
            _i, src, bpp, _alt, _blt, _mod, ax, ay, _fl, w, h = struct.unpack('>HIIIHHHHHHH', d)
            if bpp != (w // 8) * h:
                raise AssertionError(f'{body} inset {k}: bytesPerPlane {bpp} != {w}/8*{h}')
            pos_n += 1
            pos_ok += int((ax, ay) == (x, y))
            if name in PANEL_SKIP_INSETS or name in seen:
                if name in seen and seen[name] != src:
                    raise AssertionError(f'{name}: two sources {seen[name]} / {src}')
                continue
            seen[name] = src
            iidx, mask = bclib.decode_masked(raw[pix + src:pix + src + 7 * bpp], w, h)
            out.append(Entry(name, m + 10, INSET_KEY, convert(iidx, mask, lut, INSET_KEY),
                             'panel-inset', f'bcdf{LETTERS[m - 1]} +{pix + src:#x} {w}x{h}'))
        extent = 0
        for k in range(4):
            src, bpp = struct.unpack_from('>II', raw, dp + 28 * k + 2)
            extent = max(extent, src + 7 * bpp)
        if extent != gate[m - 1]:
            raise AssertionError(f'map {m}: inset descriptors span {extent} B, '
                                 f'gate block is {gate[m - 1]} B')
    log.append(f'special panels: Amiga gate maps == DOS table maps {gated}; '
               f'inset positions (Amiga descriptor x,y == DOS table x,y): {pos_ok}/{pos_n}')
    return out


# --------------------------------------------------------------------------
# archive writer + verification
# --------------------------------------------------------------------------

def write_archive(stock: bytes, new: list[Entry]) -> bytes:
    count = struct.unpack_from('<H', stock, 0)[0]
    if count != STOCK_COUNT or len(stock) != STOCK_SIZE:
        raise ValueError('not the stock 1998 demo clipper.clp (816 entries, 1,151,267 B)')
    total = count + len(new)
    if total > TABLE_CAPACITY:
        raise ValueError(f'{total} entries exceed the runtime table ({TABLE_CAPACITY})')
    shift = len(new) * REC
    old_dir = stock[HEADER:HEADER + count * REC]
    blob = stock[HEADER + count * REC:]
    out = bytearray(struct.pack('<H', total))
    for i in range(count):
        r = bytearray(old_dir[i * REC:(i + 1) * REC])
        off = struct.unpack_from('<I', r, 46)[0]
        struct.pack_into('<I', r, 46, off + shift)
        out += r
    pos = HEADER + total * REC + len(blob)
    for e in new:
        h, w = e.pixels.shape
        r = bytearray(REC)
        nb = e.name.encode('ascii')
        if len(nb) >= 40:
            raise ValueError(f'name too long: {e.name!r}')
        r[0:len(nb)] = nb
        r[40] = IMAGE_TYPE
        r[41] = e.group
        struct.pack_into('<IIHHH', r, 42, w * h, pos, e.key, w, h)
        out += r
        pos += w * h
    out += blob
    for e in new:
        out += e.pixels.tobytes()
    assert len(out) == pos
    return bytes(out)


def verify(stock: bytes, built: bytes, new: list[Entry], out_path: Path, log) -> None:
    """Re-read the written file with extract_clipper.parse_clp."""
    E = extract_clipper.parse_clp(out_path)
    S = extract_clipper.parse_clp(DOS / 'clipper.clp')
    raw = poc.parse_directory(built)
    n_new = len(new)
    assert len(E) == STOCK_COUNT + n_new
    growth = n_new * REC + sum(e.pixels.size for e in new)
    assert len(built) == len(stock) + growth == out_path.stat().st_size
    # Directory integrity: packed in order, no gaps, ends at EOF.
    first = HEADER + len(E) * REC
    assert E[0]['data_offset'] == first
    for a, b in zip(E, E[1:]):
        assert a['data_offset'] + a['size'] == b['data_offset'], a['index']
    assert E[-1]['data_offset'] + E[-1]['size'] == len(built)
    # Shipped entries unchanged (metadata except offset, and data bytes).
    shift = n_new * REC
    stock_raw = poc.parse_directory(stock)
    for s, e, rs, re_ in zip(S, E, stock_raw, raw):
        for k in ('name', 'type', 'size', 'width', 'height'):
            assert s[k] == e[k], (s['index'], k)
        assert rs['colorkey'] == re_['colorkey']
        assert built[HEADER + s['index'] * REC + 41] == stock[HEADER + s['index'] * REC + 41]
        assert e['data_offset'] == s['data_offset'] + shift
        assert e['data'] == s['data'], s['index']
    # Every new entry decodes and round-trips.
    keys = Counter()
    for k, ne in enumerate(new):
        e, r = E[STOCK_COUNT + k], raw[STOCK_COUNT + k]
        h, w = ne.pixels.shape
        assert (e['name'], e['type'], e['width'], e['height'], e['size']) == \
            (ne.name, IMAGE_TYPE, w, h, w * h)
        assert r['colorkey'] == ne.key and built[HEADER + e['index'] * REC + 41] == ne.group
        img = np.frombuffer(e['data'], np.uint8).reshape(h, w)
        assert np.array_equal(img, ne.pixels)
        assert int(img.max()) < 64, (ne.name, int(img.max()))
        keys[ne.key] += 1
    # Name rules: non-tileset names unique game-wide; tileset (name, group) unique.
    stock_names = {s['name'] for s in S}
    pairs = Counter((ne.name, ne.group) for ne in new)
    assert max(pairs.values()) == 1
    for ne in new:
        if ne.kind != 'tileset':
            assert ne.name not in stock_names, ne.name
        else:
            assert ne.name in stock_names, ne.name
    stock_groups = {built[HEADER + i * REC + 41] for i in range(STOCK_COUNT)}
    clash = {ne.group for ne in new} & stock_groups
    assert not clash, f'new entries reuse stock group ids {clash}'
    log.append(f'verify: {len(E)} entries (816 + {n_new}); file {len(built):,} B '
               f'= stock + {growth:,} B ({n_new} x 56 dir + '
               f'{growth - n_new * REC:,} px); directory contiguous to EOF; '
               f'816/816 shipped entries byte-identical (data) with offsets '
               f'+{shift}; {n_new}/{n_new} new entries round-trip pixel-exact; '
               f'colour keys {dict(keys)}')


def main() -> int:
    ap = argparse.ArgumentParser(description='Inject Amiga art into the Black Crypt demo clipper.clp (Phase 3).')
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--manifest', type=Path, help='optional JSON manifest (gitignored path)')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    out = args.out.resolve()
    data_root = (ROOT / 'data').resolve()
    if data_root in out.parents:
        print(f'error: refusing to write under {data_root}', file=sys.stderr)
        return 1
    if out.exists() and not args.force:
        print(f'error: {out} exists (pass --force)', file=sys.stderr)
        return 1

    exe = (DOS / 'crypt.exe').read_bytes()
    stock = (DOS / 'clipper.clp').read_bytes()
    s1 = (EXTRACTED / 'bcdft_decompressed.bin').read_bytes()
    s2 = (EXTRACTED / 'bcdft_s2_data.bin').read_bytes()
    clp_entries = extract_clipper.parse_clp(DOS / 'clipper.clp')

    dos_pal = np.frombuffer(clp_entries[0]['data'], np.uint8).reshape(256, 3)
    assert clp_entries[0]['name'] == 'Palette'
    ehb = np.array(PL.ehb_palette(PL.read_dungeon_palette_for_level(s1, s2, 1)),
                   np.uint8).reshape(64, 3)
    lut, notes = build_lut(dos_pal, ehb)

    log = ['index LUT: identity except ' + ', '.join(
        f'{a}->{b} (dRGB {d:.1f})' for a, (b, d) in notes.items())]
    files = load_monster_files()
    new = []
    new += build_creatures(exe, files, lut, clp_entries, log)
    new += build_tilesets(s1, lut, clp_entries, stock, log)
    new += build_panels(exe, s1, lut, log)

    built = write_archive(stock, new)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(built)
    verify(stock, built, new, out, log)

    total_px = sum(e.pixels.size for e in new)
    log.append(f'opaque pixels whose index changed (Amiga -> DOS): '
               f'{sum(REMAPPED.values())}/{total_px} ({dict(REMAPPED)}); every '
               f'other non-key pixel is the Amiga index verbatim')
    kinds = Counter(e.kind for e in new)
    log.append('new entries by kind: ' + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items())))
    for line in log:
        print(line)
    print(f'wrote {out} ({len(built):,} B)')
    if args.manifest:
        args.manifest.write_text(json.dumps([
            {'name': e.name, 'group': e.group, 'colorkey': e.key, 'kind': e.kind,
             'w': int(e.pixels.shape[1]), 'h': int(e.pixels.shape[0]), 'source': e.source}
            for e in new], indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
