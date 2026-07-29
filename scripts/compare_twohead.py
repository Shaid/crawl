"""Compare rendering methods against DOS reference for Two Head monster.

The DOS Two Head sprite is at clipper entry ~810 (96x124).
The Amiga Two Head is at off=10836 in bcdfb decompressed data.
"""
import struct, os, numpy as np
from PIL import Image

DATA = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'amiga')
DOS_CLIPPER = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'dosvga', 'clipper.clp')

ENTRY_FMT = '>IIIHHIHHHH'
ENTRY_SIZE = 28
N_DIR_ENTRIES = 42
HEADER_SIZE = 12


def rle_decompress(data):
    output = bytearray()
    i = 0
    while i < len(data):
        ctrl = data[i]; i += 1
        if ctrl == 0: break
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


def load_dos_twohead():
    """Load DOS Two Head sprite (96x124) from clipper.clp entry 811."""
    with open(DOS_CLIPPER, 'rb') as f:
        all_data = f.read()
    # Parse directory to find the Two Head entry
    entries = []
    for i in range(816):
        off = i * 56
        name = all_data[off:off+40].split(b'\x00')[0].decode('ascii', errors='replace')
        etype = all_data[off+40]
        data_size = struct.unpack_from('<I', all_data, off+42)[0]
        data_offset = struct.unpack_from('<I', all_data, off+46)[0]
        w = struct.unpack_from('<H', all_data, off+52)[0]
        h = struct.unpack_from('<H', all_data, off+54)[0]
        entries.append((name, etype, data_size, data_offset, w, h))
    
    # Find Two Head entries (96px wide, type 2 = image)
    twoheads = [(i, e) for i, e in enumerate(entries) if e[4] == 96 and e[1] == 2 and 'Two' in e[0]]
    print(f"DOS Two Head entries: {[(i, e[0], e[4], e[5]) for i, e in twoheads]}")
    
    # Load the first S (south) facing one
    for idx, entry in twoheads:
        name, etype, data_size, data_offset, w, h = entry
        if 'S' in name or '1' in name:
            img_data = all_data[data_offset:data_offset+data_size]
            img = Image.frombytes('P', (w, h), bytes(img_data))
            return img, name
    return None, None


def render_amiga_methods(data, off, w, h, bpr, palette):
    """Try all rendering methods for a single sprite."""
    results = {}
    bpr_row = w // 8
    
    # Method 1: Sequential planar (mask=plane0)
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
                plane_idx = off + (p+1) * bpr + y * bpr_row + xb
                if plane_idx < len(data) and data[plane_idx] & bit:
                    color |= (1 << p)
            r, g, b = palette[color*3], palette[color*3+1], palette[color*3+2]
            img.putpixel((x, y), (r, g, b))
    results['seq_planar_mask0'] = img
    
    # Method 2: Sequential planar (mask=plane6, reversed)
    img = Image.new('RGB', (w, h), (0, 0, 0))
    for y in range(h):
        for x in range(w):
            xb = x >> 3
            bit = 0x80 >> (x & 7)
            mask_idx = off + 6 * bpr + y * bpr_row + xb
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            color = 0
            for p in range(6):
                plane_idx = off + p * bpr + y * bpr_row + xb
                if plane_idx < len(data) and data[plane_idx] & bit:
                    color |= (1 << p)
            r, g, b = palette[color*3], palette[color*3+1], palette[color*3+2]
            img.putpixel((x, y), (r, g, b))
    results['seq_planar_mask6'] = img
    
    # Method 3: Byte-interleaved (planes interleaved per byte)
    # [p0_b0,p1_b0,...,p6_b0, p0_b1,p1_b1,...,p6_b1, ...]
    row_bytes = w // 8  # bytes per plane per row
    plane_stride_ilv = row_bytes * 7  # stride for one row of all planes
    img = Image.new('RGB', (w, h), (0, 0, 0))
    for y in range(h):
        for x in range(w):
            xb = x >> 3
            bit = 0x80 >> (x & 7)
            base = off + y * plane_stride_ilv + xb * 7
            mask_idx = base
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            color = 0
            for p in range(6):
                pi = base + p + 1
                if pi < len(data) and data[pi] & bit:
                    color |= (1 << p)
            r, g, b = palette[color*3], palette[color*3+1], palette[color*3+2]
            img.putpixel((x, y), (r, g, b))
    results['byte_interleaved'] = img
    
    # Method 4: Word-interleaved (planes interleaved per word)
    row_words = w // 16
    word_stride = row_words * 7 * 2  # 7 planes × 2 bytes × words_per_row
    img = Image.new('RGB', (w, h), (0, 0, 0))
    for y in range(h):
        for x in range(w):
            xb = x >> 3
            bit = 0x80 >> (x & 7)
            byte_in_row = xb
            word_idx = byte_in_row >> 1
            byte_in_word = byte_in_row & 1
            base = off + y * word_stride + word_idx * 7 * 2 + byte_in_word
            mask_idx = base
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            color = 0
            for p in range(6):
                pi = base + (p+1) * 2
                if pi < len(data) and data[pi] & bit:
                    color |= (1 << p)
            r, g, b = palette[color*3], palette[color*3+1], palette[color*3+2]
            img.putpixel((x, y), (r, g, b))
    results['word_interleaved'] = img
    
    # Method 5: Even/odd column split from 192px data
    # Read at 192px width (24 bytes/row/plane), then split even/odd columns
    data_w = 192
    data_bpr_row = data_w // 8  # 24
    data_h = h // 2  # 62 for Two Head
    img = Image.new('RGB', (w, h), (0, 0, 0))
    for dy in range(data_h):
        for dx in range(data_w):
            xb = dx >> 3
            bit = 0x80 >> (dx & 7)
            # Mask plane
            mask_idx = off + dy * data_bpr_row + xb
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            color = 0
            for p in range(6):
                plane_idx = off + (p+1) * bpr + dy * data_bpr_row + xb
                if plane_idx < len(data) and data[plane_idx] & bit:
                    color |= (1 << p)
            r, g, b = palette[color*3], palette[color*3+1], palette[color*3+2]
            # Even columns → row 2*dy, odd columns → row 2*dy+1
            display_x = dx // 2
            display_y = dy * 2 + (dx & 1)
            if display_x < w and display_y < h:
                img.putpixel((display_x, display_y), (r, g, b))
    results['even_odd_192'] = img
    
    # Method 6: Planar at 192px width, then deinterleave even/odd rows
    # Each plane stored at 192px wide (24 bytes/row), 62 rows per plane
    # Then even rows → first half of display, odd rows → second half
    data_w = 192
    data_bpr_row = data_w // 8  # 24
    data_h = h // 2  # 62
    img = Image.new('RGB', (w, h), (0, 0, 0))
    for dy in range(data_h):
        for dx in range(w):  # only 96 pixels wide display
            xb = dx >> 3
            bit = 0x80 >> (dx & 7)
            mask_idx = off + dy * data_bpr_row + xb
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            color = 0
            for p in range(6):
                plane_idx = off + (p+1) * bpr + dy * data_bpr_row + xb
                if plane_idx < len(data) and data[plane_idx] & bit:
                    color |= (1 << p)
            r, g, b = palette[color*3], palette[color*3+1], palette[color*3+2]
            # Even data rows → first half, odd → second half
            display_y = (dy % 2) * data_h + dy // 2
            if display_y < h:
                img.putpixel((dx, display_y), (r, g, b))
    results['planar_192_deinter'] = img

    return results


def compare_images(img1, img2):
    """Compare two images by converting to same size and computing similarity."""
    if img1.size != img2.size:
        return -1
    w, h = img1.size
    arr1 = np.array(img1.convert('RGB'), dtype=np.float32)
    arr2 = np.array(img2.convert('RGB'), dtype=np.float32)
    
    # Count non-black pixels in each
    nonblack1 = np.any(arr1 > 0, axis=2)
    nonblack2 = np.any(arr2 > 0, axis=2)
    
    # Pixel-wise match where both are non-black
    both_nonblack = nonblack1 & nonblack2
    if both_nonblack.sum() == 0:
        return 0.0
    
    # Color similarity (normalized)
    diff = np.abs(arr1 - arr2)
    similarity = 1.0 - (diff.sum() / (both_nonblack.sum() * 3 * 255))
    
    return similarity


def main():
    palette = load_ehb_palette()
    
    # Load Amiga data
    path = os.path.join(DATA, 'bcdfb')
    data, entries = extract_file(path)
    
    # Find Two Head (off=10836, 96x124)
    target_off = 10836
    target_e = None
    for e in entries:
        if e['data_off'] == target_off:
            target_e = e
            break
    
    if not target_e:
        print("Two Head not found!")
        return
    
    w, h, bpr = target_e['width'], target_e['height'], target_e['bpr']
    print(f"Amiga Two Head: off={target_off}, {w}x{h}, bpr={bpr}")
    
    # Render all methods
    results = render_amiga_methods(data, target_off, w, h, bpr, palette)
    
    # Save all
    OUT = '/tmp/bcdfb_debug'
    for name, img in results.items():
        img.save(os.path.join(OUT, f'twohead_{name}.png'))
        print(f"  Saved twohead_{name}.png ({img.size[0]}x{img.size[1]})")
    
    # Load DOS reference
    dos_img, dos_name = load_dos_twohead()
    if dos_img:
        dos_img.save(os.path.join(OUT, f'twohead_dos_reference.png'))
        print(f"  Saved DOS reference: {dos_name} ({dos_img.size[0]}x{dos_img.size[1]})")
        
        # Compare DOS reference with each method
        dos_rgb = dos_img.convert('RGB')
        for name, img in results.items():
            if img.size == dos_rgb.size:
                sim = compare_images(img, dos_rgb)
                print(f"  Similarity vs DOS: {name} = {sim:.4f}")
    
    # Also analyze the raw data structure
    print(f"\nData analysis for off={target_off}:")
    chunk = data[target_off:target_off + bpr * 7]
    
    # Check if data looks more like 192px-wide (24 bytes/row) or 96px-wide (12 bytes/row)
    for test_w in [96, 192, 64, 48, 384]:
        test_bpr = test_w // 8
        test_rows = len(chunk) // (test_bpr * 7)
        remainder = len(chunk) % (test_bpr * 7)
        print(f"  Width {test_w}: {test_bpr} bytes/row/plane, {test_rows} rows, {remainder} bytes left over")


if __name__ == '__main__':
    main()
