"""Re-render with CORRECT EHB palette (32 base + 32 half-bright derived).
Previous renders were wrong because palette[32-63] read 68k code bytes."""
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


def load_correct_ehb_palette():
    """Load 32 base colors, then derive 32 half-bright versions."""
    with open(os.path.join(DATA, 'bcdfq'), 'rb') as f:
        d = f.read()
    pal = np.zeros((64, 3), dtype=np.uint8)
    for i in range(32):
        val = struct.unpack_from('>H', d, 0x02C6 + i * 2)[0]
        r = ((val >> 8) & 0xF) * 17
        g = ((val >> 4) & 0xF) * 17
        b = (val & 0xF) * 17
        pal[i] = [r, g, b]
        pal[i + 32] = [r // 2, g // 2, b // 2]  # half-bright
    return pal


def extract_all_planes(data, off, bpr, width, height):
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
    palette = load_correct_ehb_palette()
    
    # Print corrected palette for verification
    print("Corrected EHB palette:")
    for i in range(64):
        r, g, b = palette[i]
        print(f"  [{i:2d}] RGB({r:3d},{g:3d},{b:3d})")
    
    data, entries = extract_file(os.path.join(DATA, 'bcdfb'))
    
    # Render ALL sprites with mask=0, color=123456
    sprites = [
        (0, 'Slime', 96, 129, 2),
        (10836, 'TwoHead', 96, 124, 3),
        (31836, 'RockEye', 64, 79, 3),
        (36260, 'Sprite3', 64, 81, 1),
        (40796, 'Sprite5', 48, 52, 3),
        (45206, 'Sprite7', 64, 71, 2),
        (49182, 'Sprite8', 96, 83, 2),
        (56154, 'Sprite9a', 64, 55, 3),
        (59234, 'Sprite9b', 64, 55, 4),
        (62314, 'Sprite9c', 64, 55, 3),
        (65394, 'Tiny', 32, 32, 8),
        (66290, 'Micro', 16, 17, 8),
    ]
    
    # Build big comparison sheet
    scale = 4
    images = []
    labels = []
    
    for off, name, w, h, n_frames in sprites:
        te = next((e for e in entries if e['data_off'] == off and e['width'] == w and e['height'] == h), None)
        if not te:
            te = next((e for e in entries if e['data_off'] == off and e['width'] == w), None)
        if not te: continue
        bpr = te['bpr']
        frame_h = h // n_frames if n_frames > 1 else h
        
        planes = extract_all_planes(data, off, bpr, w, frame_h)
        
        # Default ordering: M=0, C=1,2,3,4,5,6
        img = render_from_planes(planes, 0, [1,2,3,4,5,6], palette)
        images.append(img)
        labels.append(f"{name} {w}x{frame_h}\nM=0 C=123456")
        
        # Also try M=0 C=6,5,4,3,2,1
        img2 = render_from_planes(planes, 0, [6,5,4,3,2,1], palette)
        images.append(img2)
        labels.append(f"{name} {w}x{frame_h}\nM=0 C=654321")
    
    cols = 4
    cell_w = max(img.size[0] for img in images) * scale + 20
    cell_h = max(img.size[1] for img in images) * scale + 40
    rows = (len(images) + cols - 1) // cols
    
    sheet_w = cols * int(cell_w) + 10
    sheet_h = rows * int(cell_h) + 40
    sheet = Image.new('RGB', (sheet_w, sheet_h), (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 10)
    except:
        font = ImageFont.load_default()
    
    draw.text((5, 5), "ALL SPRITES — Corrected EHB palette (32 base + 32 half-bright) — M=0, two color orderings", 
              fill=(255,255,255), font=font)
    
    for i, (img, label) in enumerate(zip(images, labels)):
        col = i % cols
        row = i // cols
        x = 5 + col * int(cell_w)
        y = 25 + row * int(cell_h)
        w_img, h_img = img.size
        scaled = img.resize((w_img * scale, h_img * scale), Image.NEAREST)
        sheet.paste(scaled, (x, y))
        draw.text((x, y + h_img * scale + 2), label, fill=(180, 180, 180), font=font)
    
    path = os.path.join(OUT, 'all_sprites_corrected_palette.png')
    sheet.save(path)
    print(f"\nSaved {path} ({sheet.size[0]}x{sheet.size[1]})")
    
    # Also save individual large renders of TwoHead with correct palette
    te = next(e for e in entries if e['data_off'] == 10836)
    w, h, bpr = te['width'], te['height'], te['bpr']
    frame_h = h // 3
    planes = extract_all_planes(data, 10836, bpr, w, h)
    
    img = render_from_planes(planes, 0, [1,2,3,4,5,6], palette)
    img.save(os.path.join(OUT, 'twohead_corrected_M0_123456.png'))
    
    img2 = render_from_planes(planes, 0, [6,5,4,3,2,1], palette)
    img2.save(os.path.join(OUT, 'twohead_corrected_M0_654321.png'))
    
    print("Saved twohead_corrected_M0_123456.png and twohead_corrected_M0_654321.png")


if __name__ == '__main__':
    main()
