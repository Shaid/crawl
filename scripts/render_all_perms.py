"""Generate every plausible rendering variant for user comparison.
Key findings:
- BLTSIZE = (h<<6)|(w/16+1) confirmed for ALL entries
- BLTAMOD = -2 → effective source stride = (w/16+1)*2 - 2 = w/8 = bpr_row
- Screen modulo = (320-w)/8-2, also confirmed
- Data is 7 sequential planes, each bpr bytes
- The question remains: which plane is mask, what's the color order?
"""
import struct, os, numpy as np
from PIL import Image, ImageDraw, ImageFont

DATA = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'amiga')
OUT = '/tmp/bcdfb_debug'

ENTRY_FMT = '>IIIHHIHHHH'
ENTRY_SIZE = 28
N_DIR_ENTRIES = 42
HEADER_SIZE = 12


def extract_file(filepath):
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


def load_ehb_palette():
    with open(os.path.join(DATA, 'bcdfq'), 'rb') as f:
        d = f.read()
    pal = []
    for i in range(64):
        val = struct.unpack_from('>H', d, 0x02C6 + i * 2)[0]
        r = ((val >> 8) & 0xF) * 17
        g = ((val >> 4) & 0xF) * 17
        b = (val & 0xF) * 17
        pal.extend([r, g, b])
    return np.array(pal, dtype=np.uint8).reshape(64, 3)


def extract_all_planes(data, off, bpr, width, height):
    """Extract 7 planes as (height, width) boolean arrays."""
    planes = []
    for p in range(7):
        arr = np.zeros((height, width), dtype=bool)
        for y in range(height):
            for xb in range(width // 8):
                src_idx = off + p * bpr + y * (width // 8) + xb
                if src_idx >= len(data): break
                byte = data[src_idx]
                for bit in range(8):
                    px = xb * 8 + bit
                    if px < width:
                        arr[y, px] = bool(byte & (0x80 >> bit))
        planes.append(arr)
    return planes


def render_from_planes(planes, mask_idx, color_indices, palette):
    h, w = planes[0].shape
    mask = planes[mask_idx]
    color_val = np.zeros((h, w), dtype=np.uint8)
    for p_idx, cp in enumerate(color_indices):
        color_val |= (planes[cp].astype(np.uint8) << p_idx)
    ci = color_val & 0x3F
    rgb = palette[ci]
    pixels = np.zeros((h, w, 3), dtype=np.uint8)
    pixels[mask] = rgb[mask]
    return Image.fromarray(pixels)


def main():
    palette = load_ehb_palette()
    data, entries = extract_file(os.path.join(DATA, 'bcdfb'))
    
    # TwoHead: off=10836, 96x124, bpr=1488
    te = next(e for e in entries if e['data_off'] == 10836)
    w, h, bpr = te['width'], te['height'], te['bpr']
    frame_h = h // 3  # 3 frames, first frame = 41 rows
    
    planes = extract_all_planes(data, 10836, bpr, w, frame_h)
    
    # Try every possible mask (0-6) with every color ordering
    # Color planes = remaining 6 planes in ascending, descending, and mixed orders
    from itertools import permutations
    
    color_orders = {
        'asc': [1,2,3,4,5,6],
        'desc': [6,5,4,3,2,1],
        'm654321': [6,5,4,3,2,1],
        'm012654': [0,1,2,6,5,4],
        'm543210': [5,4,3,2,1,0],
        'm345601': [3,4,5,6,0,1],
        'm650123': [6,5,0,1,2,3],
    }
    
    images = []
    labels = []
    
    for mask in range(7):
        for oname, order in list(color_orders.items())[:5]:  # top 5 orderings
            colors = [p for p in order if p != mask]
            if len(colors) != 6:
                # Need to include the skipped plane
                remaining = [p for p in range(7) if p != mask]
                colors = remaining[:6]
            img = render_from_planes(planes, mask, colors, palette)
            images.append(img)
            labels.append(f"M={mask} C={colors}")
    
    # Build comparison sheet
    cols = 5
    scale = 3
    cell_w = w * scale + 20
    cell_h = frame_h * scale + 40
    rows = (len(images) + cols - 1) // cols
    
    sheet_w = cols * cell_w + 10
    sheet_h = rows * cell_h + 40
    sheet = Image.new('RGB', (sheet_w, sheet_h), (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 9)
    except:
        font = ImageFont.load_default()
    
    draw.text((5, 5), f"TwoHead {w}x{frame_h} — Every mask + color ordering (first frame)", fill=(255,255,255), font=font)
    
    for i, (img, label) in enumerate(zip(images, labels)):
        col = i % cols
        row = i // cols
        x = 5 + col * cell_w
        y = 25 + row * cell_h
        scaled = img.resize((w * scale, frame_h * scale), Image.NEAREST)
        sheet.paste(scaled, (x, y))
        draw.text((x, y + frame_h * scale + 2), label, fill=(180, 180, 180), font=font)
    
    path = os.path.join(OUT, 'twohead_every_permutation.png')
    sheet.save(path)
    print(f"Saved {path} ({sheet.size[0]}x{sheet.size[1]})")
    
    # Also save individual frames for easier viewing
    for mask in range(7):
        remaining = [p for p in range(7) if p != mask]
        colors = remaining[:6]
        img = render_from_planes(planes, mask, colors, palette)
        scaled = img.resize((w * 4, frame_h * 4), Image.NEAREST)
        scaled.save(os.path.join(OUT, f'twohead_frame0_M{mask}_asc.png'))
    
    print("Individual frames saved: twohead_frame0_M{0..6}_asc.png")


if __name__ == '__main__':
    main()
