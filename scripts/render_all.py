#!/usr/bin/env python3
"""Render all confirmed Black Crypt assets as color PNGs."""
import os, struct
from PIL import Image

OUT = 'data/blackcrypt/extracted'
AMIGA = 'data/blackcrypt/amiga'
PAYLOADS = 'data/blackcrypt/extracted/payloads'

# EHB palette: 32 × 12-bit Amiga → 64 × 24-bit RGB
PAL_12BIT = [
    0x000,0xC86,0xF00,0xB00,0xD80,0xFE0,0x0F0,0x0B0,
    0x040,0x0DD,0x00F,0x07C,0xFD9,0xEB8,0xF0F,0xE09,
    0x720,0x952,0xA53,0x33B,0x222,0x444,0x666,0x999,
    0xCCC,0xFFF,0xB60,0xC70,0xC80,0xD90,0xEB0,0xFC0,
]
PALETTE = []
for i in range(64):
    v = PAL_12BIT[i if i < 32 else i - 32]
    r = (v >> 8) & 0xF
    g = (v >> 4) & 0xF
    b = v & 0xF
    if i >= 32:
        r, g, b = r >> 1, g >> 1, b >> 1
    PALETTE.extend([r * 17, g * 17, b * 17])

def rle_decompress(data):
    """bcdfu.asm LAB_0043 RLE: ctrl 0x00=end; bit0=1→literal (byte>>1) bytes; bit0=0→fill next byte (byte>>1) times"""
    out = bytearray()
    pos = 0
    while pos < len(data):
        ctrl = data[pos]; pos += 1
        if ctrl == 0:
            break
        count = ctrl >> 1
        if ctrl & 1:
            end = min(pos + count, len(data))
            out.extend(data[pos:end])
            pos += count
        else:
            fill = data[pos] if pos < len(data) else 0
            pos += 1
            out.extend([fill] * count)
    return bytes(out)

def decode_6bpp(data, width, height, planes=6):
    """Sequential planar 6bpp → pixel array. Bit 7 = leftmost pixel."""
    pb = width // 8
    pixels = []
    for y in range(height):
        for x in range(width):
            col = 0
            for bp in range(planes):
                off = bp * pb * height + y * pb + (x // 8)
                if off < len(data) and (data[off] >> (7 - (x % 8))) & 1:
                    col |= 1 << bp
            pixels.append(col)
    return pixels

def make_color_image(pixels, width, height):
    """Convert pixel array to RGB PIL Image using EHB palette."""
    img = Image.new('RGB', (width, height))
    for y in range(height):
        for x in range(width):
            c = pixels[y * width + x]
            off = c * 3
            img.putpixel((x, y), (PALETTE[off], PALETTE[off + 1], PALETTE[off + 2]))
    return img

def make_sheet(images, cols=8, scale=4):
    """Layout multiple images in a grid, scaled up."""
    if not images:
        return None
    w, h = images[0].size
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * w * scale, rows * h * scale), (0, 0, 0))
    for i, img in enumerate(images):
        sx = (i % cols) * w * scale
        sy = (i // cols) * h * scale
        sheet.paste(img.resize((w * scale, h * scale), Image.NEAREST), (sx, sy))
    return sheet

os.makedirs(OUT, exist_ok=True)

# ── 1. bcdfo character portraits (32×24×6bpp, sequential planar) ──
print("=== bcdfo portraits ===")
with open(os.path.join(AMIGA, 'bcdfo'), 'rb') as f:
    bcdfo = f.read()
W, H, TS = 32, 24, 576
# tiles start at offset 96 (based on blitter source offset $60)
base = 96
n_tiles = (len(bcdfo) - base) // TS
portraits = []
for i in range(n_tiles):
    td = bcdfo[base + i * TS : base + (i + 1) * TS]
    px = decode_6bpp(td, W, H)
    portraits.append(make_color_image(px, W, H))
sheet = make_sheet(portraits, cols=8, scale=4)
if sheet:
    sheet.save(os.path.join(OUT, '01_bcdfo_portraits_4x.png'))
print(f"  {len(portraits)} portraits saved")

# ── 2. bcdfx P2 dungeon textures (208×356×6bpp) ──
for src in ['bcdfx', 'bcdfz']:
    fname = f'{src}_p2_raw.bin'
    path = os.path.join(PAYLOADS, fname)
    if os.path.exists(path):
        print(f"\n=== {src} P2 dungeon atlas ===")
        data = open(path, 'rb').read()
        W2, H2 = 208, 356
        px = decode_6bpp(data, W2, H2)
        img = make_color_image(px, W2, H2)
        img.save(os.path.join(OUT, f'02_{src}_p2_atlas_208x356.png'))
        # Also greyscale for reference
        gs = Image.new('L', (W2, H2))
        for y in range(H2):
            for x in range(W2):
                gs.putpixel((x, y), int(px[y * W2 + x] * 255 / 63))
        gs.save(os.path.join(OUT, f'02_{src}_p2_atlas_grey.png'))
        print(f"  Saved color + greyscale")

# ── 3. bcdfx P4/P5 wall sides (80×193×6bpp) ──
for src in ['bcdfx', 'bcdfz']:
    for p in ['p4', 'p5']:
        fname = f'{src}_{p}_raw.bin'
        path = os.path.join(PAYLOADS, fname)
        if os.path.exists(path):
            print(f"\n=== {src} {p.upper()} wall side ===")
            data = open(path, 'rb').read()
            W3, H3 = 80, 193
            px = decode_6bpp(data, W3, H3)
            img = make_color_image(px, W3, H3)
            img.save(os.path.join(OUT, f'03_{src}_{p}_wall_80x193.png'))
            # Greyscale
            gs = Image.new('L', (W3, H3))
            for y in range(H3):
                for x in range(W3):
                    gs.putpixel((x, y), int(px[y * W3 + x] * 255 / 63))
            gs.save(os.path.join(OUT, f'03_{src}_{p}_wall_grey.png'))
            print(f"  Saved color + greyscale")

# ── 4. bcdfx P3 viewport mask (binary mask) ──
for src in ['bcdfx', 'bcdfz']:
    fname = f'{src}_p3_raw.bin'
    path = os.path.join(PAYLOADS, fname)
    if os.path.exists(path):
        print(f"\n=== {src} P3 viewport mask ===")
        data = open(path, 'rb').read()
        W4 = 320
        bpr = W4 // 8  # 40 bytes/row
        H4 = len(data) // bpr
        img = Image.new('L', (W4, H4))
        for y in range(H4):
            for x_byte in range(bpr):
                b = data[y * bpr + x_byte]
                for bit in range(8):
                    px_x = x_byte * 8 + bit
                    if px_x < W4:
                        val = 255 if (b >> (7 - bit)) & 1 else 0
                        img.putpixel((px_x, y), val)
        img.save(os.path.join(OUT, f'04_{src}_p3_mask_{W4}x{H4}.png'))
        print(f"  {W4}×{H4} mask saved")

# ── 5. bcdfa — try RLE decompression + render at known dimensions ──
print("\n=== bcdfa (trying RLE decompress + multiple layouts) ===")
with open(os.path.join(AMIGA, 'bcdfa'), 'rb') as f:
    bcdfa_raw = f.read()

decomp = rle_decompress(bcdfa_raw)
print(f"  RLE: {len(bcdfa_raw)}→{len(decomp)} bytes ({len(decomp)/len(bcdfa_raw):.0%})")

# Try rendering decompressed data at various dimensions
tries = [
    (32, 24),
    (48, 24),
    (48, 16),
    (64, 24),
]
sheet_tries = []
for w, h in tries:
    ts2 = w // 8 * h * 6
    n = min(8, len(decomp) // ts2)
    if n == 0:
        continue
    imgs = []
    for i in range(n):
        td = decomp[i * ts2:(i + 1) * ts2]
        px = decode_6bpp(td, w, h)
        imgs.append(make_color_image(px, w, h))
    s = make_sheet(imgs, cols=min(n, 4), scale=3)
    if s:
        s.save(os.path.join(OUT, f'05_bcdfa_rle_{w}x{h}_3x.png'))
        print(f"  RLE {w}×{h}: {n} tiles rendered")

# Also try raw (non-RLE) at different planar layouts for bcdfa
# Raw sequential planar 32×24
raw_imgs = []
for i in range(min(8, len(bcdfa_raw) // TS)):
    td = bcdfa_raw[i * TS:(i + 1) * TS]
    px = decode_6bpp(td, W, H)
    raw_imgs.append(make_color_image(px, W, H))
s = make_sheet(raw_imgs, cols=4, scale=3)
if s:
    s.save(os.path.join(OUT, f'05_bcdfa_raw_32x24_3x.png'))
    print(f"  Raw 32×24: {len(raw_imgs)} tiles rendered")

print(f"\nDone! All files in {OUT}/")
print("Files to check:")
for f in sorted(os.listdir(OUT)):
    if f.endswith('.png'):
        print(f"  {f}")
