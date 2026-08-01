"""Extract monster sprites from bcdfb-bcdfn files.

SUPERSEDED: the "frames concatenated within each plane, split by dividing
height evenly" premise below is wrong — see
docs/blackcrypt/amiga/data-structure.md ("Animation frames" section). Entries
sharing data_off are the *same* image (a normal/mirrored pair), not sub-frames
of one taller image; each data_off block holds exactly one full-height sprite.
scripts/extract_monsters.py is the canonical extractor (204 sprites,
byte-exact, feeds public/assets/blackcrypt/amiga/sprites/monsters). This
script is kept only for reference on the even-split hypothesis and writes to
the gitignored cache, not public/assets.

File structure:
- 12-byte header: 2 pad + 2 map_id + 2 extra_id + 2 extra_id2 + 4 pad
- 42 × 28-byte directory entries — entries SHARING data_off = frames of same sprite
- RLE-compressed data streams (bcdfu LAB_0043 algorithm)
- Data offsets point into concatenated decompressed stream

Directory entry (28 bytes):
- +0:  data_offset (into concatenated decompressed data)
- +4:  bpr = (width/8) × total_rows (sum of all frame heights for this sprite)
- +8:  reserved (0)
- +12: BLTSIZE
- +14: screen_modulo
- +16: reserved (0)
- +20: type (0x0100, 0x0500 — frame identifier)
- +22: width (pixels)
- +24: height (rows, TOTAL = sum of all frame heights)
- +26: reserved (0)

Data layout per sprite (7 sequential bitplanes):
- Plane 0: transparency mask (1=opaque, 0=transparent)
- Planes 1-6: 6bpp EHB color
- Multiple animation FRAMES concatenated within each plane.
  Number of frames = number of dir entries sharing this data_off.
  Frame heights are distributed as evenly as possible across total height.
  E.g., entry group with 3 entries, height=79 → frames: 27, 26, 26 rows.

Files:
- bcdfb-bcdfn (13 files, b=map1 through n=map13)
- In WHDLoad version, loaded via bcdfv as part of each level's data
"""
import struct, sys, os
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bclib

DATA = str(bclib.data_dir('blackcrypt', 'amiga'))
OUT = str(bclib.cache_dir('blackcrypt') / 'bcdfb_even_split_debug')
ENTRY_FMT = '>IIIHHIHHHH'
ENTRY_SIZE = struct.calcsize(ENTRY_FMT)  # 28
N_DIR_ENTRIES = 42
HEADER_SIZE = 12

def rle_decompress(data):
    """RLE decompressor matching bcdfu.asm LAB_0043"""
    output = bytearray()
    i = 0
    while i < len(data):
        ctrl = data[i]; i += 1
        if ctrl == 0:
            break
        count = ctrl >> 1
        if ctrl & 1:
            if i + count > len(data): break
            output.extend(data[i:i+count]); i += count
        else:
            if i >= len(data): break
            b = data[i]; i += 1
            output.extend([b] * count)

    return bytes(output)


def extract_file(filepath):
    """Extract all sprites from a bcdfb-style file.
    Returns (decompressed_data, directory_entries)."""
    with open(filepath, 'rb') as f:
        raw = f.read()

    entries = []
    for i in range(N_DIR_ENTRIES):
        off = HEADER_SIZE + i * ENTRY_SIZE
        e = struct.unpack_from(ENTRY_FMT, raw, off)
        entries.append({
            'data_off': e[0], 'bpr': e[1],
            'bltsize': e[3], 'modulo': e[4],
            'type': e[6], 'width': e[7], 'height': e[8],
        })

    dir_end = HEADER_SIZE + N_DIR_ENTRIES * ENTRY_SIZE
    all_dec = bytearray()
    pos = dir_end
    while pos < len(raw):
        while pos < len(raw) and raw[pos] == 0:
            pos += 1
        if pos >= len(raw): break
        j = pos
        output = bytearray()
        while j < len(raw):
            ctrl = raw[j]; j += 1
            if ctrl == 0: break
            count = ctrl >> 1
            if ctrl & 1:
                if j + count > len(raw): break
                output.extend(raw[j:j+count]); j += count
            else:
                if j >= len(raw): break
                b = raw[j]; j += 1
                output.extend([b] * count)
        all_dec.extend(output)
        pos = j

    return bytes(all_dec), entries


def render_sprite(data, entry, palette_rgb=None):
    """Render a 7-plane sequential bitplane sprite as RGB Image.
    Renders all animation frames as a vertical strip."""

    off = entry['data_off']
    bpr = entry['bpr']
    w = entry['width']
    h = entry['height']
    bpr_row = w // 8
    img = Image.new('RGB', (w, h), (0, 0, 0))

    for y in range(h):
        for x in range(w):
            xb = x >> 3
            bit = 0x80 >> (x & 7)
            mask_idx = off + y * bpr_row + xb
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            color = 0
            for p in range(6):
                plane_idx = off + (p + 1) * bpr + y * bpr_row + xb
                if plane_idx < len(data) and data[plane_idx] & bit:
                    color |= (1 << p)
            if palette_rgb:
                r, g, b = palette_rgb[color*3], palette_rgb[color*3+1], palette_rgb[color*3+2]
            else:
                v = int((color / 63.0) * 255)
                r, g, b = v, v, v
            img.putpixel((x, y), (r, g, b))

    return img


def render_frame(data, off, bpr, w, h_total, frame_start_row, frame_height, palette_rgb=None):
    """Render a single animation frame from a multi-frame sprite block."""

    bpr_row = w // 8
    img = Image.new('RGB', (w, frame_height), (0, 0, 0))
    for y in range(frame_height):
        sy = frame_start_row + y
        for x in range(w):
            xb = x >> 3
            bit = 0x80 >> (x & 7)
            mask_idx = off + sy * bpr_row + xb
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            color = 0
            for p in range(6):
                plane_idx = off + (p + 1) * bpr + sy * bpr_row + xb
                if plane_idx < len(data) and data[plane_idx] & bit:
                    color |= (1 << p)
            if palette_rgb:
                r, g, b = palette_rgb[color*3], palette_rgb[color*3+1], palette_rgb[color*3+2]
            else:
                v = int((color / 63.0) * 255)
                r, g, b = v, v, v
            img.putpixel((x, y), (r, g, b))
    return img

def load_ehb_palette():
    """Load 64-color EHB palette from bcdfq offset 0x02C6."""

    bcdfq_path = os.path.join(DATA, 'bcdfq')
    with open(bcdfq_path, 'rb') as f:
        data = f.read()
    pal = []
    for i in range(64):
        val = struct.unpack_from('>H', data, 0x02C6 + i * 2)[0]
        r = ((val >> 8) & 0xF) * 17
        g = ((val >> 4) & 0xF) * 17
        b = (val & 0xF) * 17
        pal.extend([r, g, b])

    return pal


def main():
    os.makedirs(OUT, exist_ok=True)
    palette = load_ehb_palette()
    total = 0
    for letter in 'bcdefghijklmn':
        path = os.path.join(DATA, f'bcdf{letter}')
        if not os.path.exists(path):
            continue
        data, entries = extract_file(path)
        print(f'bcdf{letter}: {len(data)} decompressed bytes, {len(entries)} entries')
        # Group entries by data_off — each group = one sprite with N animation frames
        from collections import Counter, defaultdict
        groups = defaultdict(list)
        for i, e in enumerate(entries):
            groups[e['data_off']].append(e)
        for data_off, group in sorted(groups.items()):
            e0 = group[0]
            w = e0['width']
            h = e0['height']
            bpr = e0['bpr']
            if w == 0 or h == 0:
                continue
            if data_off + bpr * 7 > len(data):
                print(f'  off={data_off:6d} {w}x{h} OVERFLOW')
                continue
            n_frames = len(group)
            bpr_row = w // 8
            base_h = h // n_frames
            rem = h % n_frames
            for fi in range(n_frames):
                fh = base_h + (1 if fi < rem else 0)
                start_row = sum(base_h + (1 if fj < rem else 0) for fj in range(fi))
                img = render_frame(data, data_off, bpr, w, h, start_row, fh, palette)
                e = group[fi]
                fname = f'bcdf{letter}_{e["type"]:04x}_{fi:02d}_{w}x{fh}_ehb.png'
                img.save(os.path.join(OUT, fname))
                total += 1
        print(f'  {len(groups)} sprites, {total} frames total')
    
    print(f'\nTotal: {total} frames extracted')


if __name__ == '__main__':
    main()