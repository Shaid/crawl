"""Generate comparison sheet of all rendering methods for user review."""
import struct, os
from PIL import Image, ImageDraw, ImageFont

DATA = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'amiga')
OUT = '/tmp/bcdfb_debug'
os.makedirs(OUT, exist_ok=True)

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


def render_pixel(data, off, bpr, width, height, mask_plane, color_planes, stride_override=None):
    """Render sprite with specified plane assignment and stride.
    
    mask_plane: which plane index (0-6) is the mask
    color_planes: list of 6 plane indices for color bits 0-5
    stride_override: bytes per row in the source data (default = bpr // height)
    """
    if stride_override is None:
        stride_override = bpr // height
    
    img = Image.new('P', (width, height), 0)
    img.putpalette(load_ehb_palette())
    
    for y in range(height):
        for x in range(width):
            xb = x >> 3
            bit = 0x80 >> (x & 7)
            src_y = y * stride_override
            
            mask_idx = off + mask_plane * bpr + src_y + xb
            if mask_idx >= len(data) or not (data[mask_idx] & bit):
                continue
            
            color = 0
            for p_idx, plane in enumerate(color_planes):
                plane_idx = off + plane * bpr + src_y + xb
                if plane_idx < len(data) and data[plane_idx] & bit:
                    color |= (1 << p_idx)
            
            img.putpixel((x, y), color & 0x3F)
    
    return img


def render_flat(data, off, total_bytes, width):
    """Render flat 1-bit view of raw data at given width."""
    img = Image.new('L', (width, (total_bytes * 8 + width - 1) // width), 0)
    idx = 0
    for y in range(img.height):
        for x in range(0, width, 8):
            if idx < len(data):
                byte = data[off + idx]
                idx += 1
                for bit in range(8):
                    if x + bit < width and (byte & (0x80 >> bit)):
                        img.putpixel((x + bit, y), 255)
    return img


def make_comparison_sheet(images, labels, title, cols=4):
    """Create a labeled comparison sheet."""
    if not images:
        return None
    
    w, h = images[0].size
    pad = 20
    label_h = 30
    cell_w = w + pad
    cell_h = h + pad + label_h
    
    rows = (len(images) + cols - 1) // cols
    
    sheet_w = cols * cell_w + pad
    sheet_h = rows * cell_h + pad + 50  # +50 for title
    
    sheet = Image.new('RGB', (sheet_w, sheet_h), (30, 30, 30))
    draw = ImageDraw.Draw(sheet)
    
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 11)
    except:
        font = ImageFont.load_default()
    
    draw.text((pad, 10), title, fill=(255, 255, 255), font=font)
    
    for i, (img, label) in enumerate(zip(images, labels)):
        col = i % cols
        row = i // cols
        x = pad + col * cell_w
        y = 50 + row * cell_h
        
        # Convert palette image to RGB for compositing
        if img.mode == 'P':
            rgb = img.convert('RGB')
        else:
            rgb = img.convert('RGB')
        
        # Scale up 2x for visibility
        rgb = rgb.resize((w * 2, h * 2), Image.NEAREST)
        sheet.paste(rgb, (x, y))
        draw.text((x, y + h * 2 + 2), label, fill=(200, 200, 200), font=font)
    
    return sheet


def main():
    path = os.path.join(DATA, 'bcdfb')
    data, entries = extract_file(path)
    
    # === Two Head comparison ===
    target_off = 10836
    target_e = next(e for e in entries if e['data_off'] == target_off)
    w, h, bpr = target_e['width'], target_e['height'], target_e['bpr']
    
    stride_12 = bpr // h  # 12
    stride_10 = 10        # from modulo -2 with 6-word blit
    
    all_plane_perms = [
        ("M=P0 C=P1-6", 0, [1,2,3,4,5,6]),
        ("M=P6 C=P0-5", 6, [0,1,2,3,4,5]),
        ("M=P0 C=P654321", 0, [6,5,4,3,2,1]),
        ("M=P6 C=P543210", 6, [5,4,3,2,1,0]),
        ("M=P5 C=P012346", 5, [0,1,2,3,4,6]),
        ("M=P5 C=P643210", 5, [6,4,3,2,1,0]),
        ("M=P3 C=P012456", 3, [0,1,2,4,5,6]),
        ("M=P3 C=P654210", 3, [6,5,4,2,1,0]),
        ("M=P4 C=P012356", 4, [0,1,2,3,5,6]),
        ("M=P4 C=P653210", 4, [6,5,3,2,1,0]),
        ("M=P3 C=P012654", 3, [0,1,2,6,5,4]),
        ("M=P4 C=P012654", 4, [0,1,2,6,5,4]),
    ]
    
    print(f"Two Head: {w}x{h}, bpr={bpr}, stride_12={stride_12}")
    print(f"Testing {len(all_plane_perms)} plane permutations × 2 strides = {len(all_plane_perms)*2} renders...")
    
    images = []
    labels = []
    
    for name, mp, cp in all_plane_perms:
        for stride_name, stride in [("s12", stride_12), ("s10", stride_10)]:
            img = render_pixel(data, target_off, bpr, w, h, mp, cp, stride_override=stride)
            images.append(img)
            labels.append(f"{name}\n{stride_name}")
    
    sheet = make_comparison_sheet(images, labels, f"Two Head {w}x{h} — All plane permutations × strides (mask=highlighted)", cols=2)
    if sheet:
        sheet.save(os.path.join(OUT, 'twohead_all_perms.png'))
        print(f"Saved twohead_all_perms.png ({sheet.size[0]}x{sheet.size[1]})")
    
    # === Flat view at multiple widths ===
    print("\nGenerating flat views...")
    flat_images = []
    flat_labels = []
    for fw in [48, 64, 96, 112, 192, 384]:
        img = render_flat(data, target_off, bpr * 7, fw)
        flat_images.append(img)
        flat_labels.append(f"{fw}px wide\n({bpr*7*8//fw} rows)")
    
    # Make all same height for comparison
    max_h = max(img.height for img in flat_images)
    padded = []
    for img in flat_images:
        if img.height < max_h:
            p = Image.new('L', (img.width, max_h), 0)
            p.paste(img, (0, 0))
            padded.append(p)
        else:
            padded.append(img)
    
    flat_sheet = make_comparison_sheet(padded, flat_labels, "Flat 1-bit views at various widths", cols=3)
    if flat_sheet:
        flat_sheet.save(os.path.join(OUT, 'twohead_flat_all_widths.png'))
        print(f"Saved twohead_flat_all_widths.png")
    
    print("\nDone!")


if __name__ == '__main__':
    main()
