#!/usr/bin/env python3
"""Extract all RLE streams from bcdfa and render at 64×24×6bpp with EHB palette.

SUPERSEDED PREMISE — TWICE OVER. bcdfa is not a flat 64×24 tile sheet, and it
is also not a flat run of RLE streams: it is a *mixed* container whose BCSPEED
blocks must be located by marker string, some compressed and some raw (see
bclib/bcdfa.py and docs/blackcrypt/amiga/data-structure.md). Splitting the whole
file into streams, as this script does, is exactly the mistake that produced a
phantom preamble and a wrong sprite format. The real GFK sprites are extracted
by scripts/render_all.py via bclib.gfk_frames.

This script survives only as a crude visualiser for the parts of bcdfa that are
still unclassified, and its stream numbering means nothing — output goes to the
gitignored cache, never to public/assets.
"""
import os, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bclib

PAL_12BIT = [0x000,0xC86,0xF00,0xB00,0xD80,0xFE0,0x0F0,0x0B0,0x040,0x0DD,0x00F,0x07C,0xFD9,0xEB8,0xF0F,0xE09,0x720,0x952,0xA53,0x33B,0x222,0x444,0x666,0x999,0xCCC,0xFFF,0xB60,0xC70,0xC80,0xD90,0xEB0,0xFC0]
PALETTE = []
for i in range(64):
    v = PAL_12BIT[i if i < 32 else i - 32]
    r,g,b = (v>>8)&0xF, (v>>4)&0xF, v&0xF
    if i >= 32: r,g,b = r>>1,g>>1,b>>1
    PALETTE.extend([r*17,g*17,b*17])

def rle_decompress_stream(data, start):
    out, pos = bytearray(), start
    while pos < len(data):
        ctrl = data[pos]; pos += 1
        if ctrl == 0:
            return bytes(out), pos
        count = ctrl >> 1
        if ctrl & 1:
            out.extend(data[pos:min(pos+count,len(data))])
            pos += count
        else:
            out.extend([data[pos]] * count)
            pos += 1
    return bytes(out), pos

def decode_6bpp(data, w, h):
    pb = w // 8
    pixels = []
    for y in range(h):
        for x in range(w):
            col = 0
            for bp in range(6):
                off = bp * pb * h + y * pb + (x // 8)
                if off < len(data) and (data[off] >> (7 - (x % 8))) & 1:
                    col |= 1 << bp
            pixels.append(col)
    return pixels

def color_img(pixels, w, h):
    img = Image.new('RGB', (w, h))
    for y in range(h):
        for x in range(w):
            o = pixels[y*w + x] * 3
            img.putpixel((x,y), (PALETTE[o], PALETTE[o+1], PALETTE[o+2]))
    return img

def grey_img(pixels, w, h):
    img = Image.new('L', (w, h))
    for y in range(h):
        for x in range(w):
            img.putpixel((x, y), int(pixels[y*w + x] * 255 / 63))
    return img

W, H = 64, 24
TS = W // 8 * H * 6  # 1152

fname = sys.argv[1] if len(sys.argv) > 1 else 'data/blackcrypt/amiga/bcdfa'
base = os.path.splitext(os.path.basename(fname))[0]

with open(fname, 'rb') as f:
    data = f.read()

# Decompress all streams
streams = []
pos = 0
while pos < len(data):
    d, pos = rle_decompress_stream(data, pos)
    if d:
        streams.append(d)

print(f'{base}: {len(streams)} RLE streams found')
for i, s in enumerate(streams):
    n = len(s) // TS
    r = len(s) % TS
    print(f'  Stream {i:3d}: {len(s):>6d} bytes = {n} tiles + {r} rem')

# Render each stream as a tile strip
out_dir = str(bclib.cache_dir('blackcrypt') / 'bcdfa_debug')
os.makedirs(out_dir, exist_ok=True)
all_tiles = []
for si, sdata in enumerate(streams):
    n = len(sdata) // TS
    if n == 0:
        continue
    for ti in range(n):
        td = sdata[ti*TS:(ti+1)*TS]
        px = decode_6bpp(td, W, H)
        all_tiles.append((f'{base}_s{si}_t{ti}', color_img(px, W, H), grey_img(px, W, H)))

# Create contact sheets
cols = 8
rows = (len(all_tiles) + cols - 1) // cols
sheet_c = Image.new('RGB', (cols * W * 4, rows * H * 4), (0,0,0))
sheet_g = Image.new('L', (cols * W * 4, rows * H * 4), 0)
for i, (label, cimg, gimg) in enumerate(all_tiles):
    cimg = cimg.resize((W*4, H*4), Image.NEAREST)
    gimg = gimg.resize((W*4, H*4), Image.NEAREST)
    x = (i % cols) * W * 4
    y = (i // cols) * H * 4
    sheet_c.paste(cimg, (x, y))
    sheet_g.paste(gimg, (x, y))

out = os.path.join(out_dir, f'06_{base}_all_tiles_64x24_4x.png')
sheet_c.save(out)
out2 = os.path.join(out_dir, f'06_{base}_all_tiles_64x24_4x_grey.png')
sheet_g.save(out2)
print(f'\nSaved: {out} ({len(all_tiles)} tiles, color)')
print(f'Saved: {out2} ({len(all_tiles)} tiles, grey)')

# Also save per-stream strips (color + grey)
for si, sdata in enumerate(streams):
    n = len(sdata) // TS
    if n == 0:
        continue
    strip_c = Image.new('RGB', (n * W * 4, H * 4), (0,0,0))
    strip_g = Image.new('L', (n * W * 4, H * 4), 0)
    for ti in range(n):
        td = sdata[ti*TS:(ti+1)*TS]
        px = decode_6bpp(td, W, H)
        strip_c.paste(color_img(px, W, H).resize((W*4, H*4), Image.NEAREST), (ti * W * 4, 0))
        strip_g.paste(grey_img(px, W, H).resize((W*4, H*4), Image.NEAREST), (ti * W * 4, 0))
    out_c = os.path.join(out_dir, f'06_{base}_stream{si:03d}_{n}tiles_4x.png')
    out_g = os.path.join(out_dir, f'06_{base}_stream{si:03d}_{n}tiles_grey_4x.png')
    strip_c.save(out_c)
    strip_g.save(out_g)
    print(f'  Stream {si}: {n} tiles (color + grey)')

# Also try as ONE continuous strip at W=64 (no tile boundaries)
for si, sdata in enumerate(streams[:5]):  # first 5 only for strip test
    pb = W // 8
    bpr = pb * 6  # 48 bytes per row
    total_rows = len(sdata) // bpr
    if total_rows > 4:
        px = decode_6bpp(sdata[:bpr * total_rows], W, total_rows)
        img = color_img(px, W, total_rows)
        img.save(os.path.join(out_dir, f'06_{base}_s{si}_strip_64x{total_rows}.png'))
        print(f'  Strip: s{si} 64×{total_rows}')
