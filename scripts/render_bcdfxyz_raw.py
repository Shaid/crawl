#!/usr/bin/env python3
"""Render bcdfx/bcdfy/bcdfz as RAW bitplanes (no RLE decompression first)."""
import struct, os
import numpy as np
from PIL import Image

AMIGA = 'data/blackcrypt/amiga'
OUT   = '/tmp'

# ── Palette from bcdfq ──
with open(f'{AMIGA}/bcdfq', 'rb') as f:
    bcdfq = f.read()

def read_pal(data, off, n):
    return [struct.unpack('>H', data[off+i*2:off+i*2+2])[0] for i in range(n)]

# Dungeon palette: CODE+0x2C6 = file offset 0x2EA
dung_pal   = read_pal(bcdfq, 0x02EA, 32)
monster_pal = read_pal(bcdfq, 0x02C6, 32)

def pal_rgb(v, hb=False):
    r,g,b = (v>>8)&0xF, (v>>4)&0xF, v&0xF
    if hb: r,g,b = r>>1, g>>1, b>>1
    return (r*17, g*17, b*17)

pal64 = np.zeros((64, 3), dtype=np.uint8)
for i in range(64):
    idx = i if i < 32 else i - 32
    pal64[i] = pal_rgb(dung_pal[idx], i >= 32)

pal64_monster = np.zeros((64, 3), dtype=np.uint8)
for i in range(64):
    idx = i if i < 32 else i - 32
    pal64_monster[i] = pal_rgb(monster_pal[idx], i >= 32)

def render_planes(raw, w, planes, pal=pal64, skip=0):
    """Render raw bytes as planar with given width and plane count."""
    pb = w // 8
    data = raw[skip:]
    h = len(data) // (pb * planes)
    if h == 0:
        return None, None
    used = pb * h * planes
    data = data[:used]
    
    buf = np.frombuffer(data, dtype=np.uint8).reshape(planes, h, pb)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    
    if planes == 1:
        return bits[0], None
    else:
        weights = (1 << np.arange(planes)).reshape(planes, 1, 1)
        color = (bits * weights).sum(axis=0).astype(np.uint8)
        return color, None

def render_planes_masked(raw, w, planes_total, pal=pal64, skip=0):
    """First plane is mask, rest are color."""
    pb = w // 8
    data = raw[skip:]
    h = len(data) // (pb * planes_total)
    if h == 0:
        return None, None
    used = pb * h * planes_total
    data = data[:used]
    
    buf = np.frombuffer(data, dtype=np.uint8).reshape(planes_total, h, pb)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    
    mask = bits[0]
    color_planes = planes_total - 1
    weights = (1 << np.arange(color_planes)).reshape(color_planes, 1, 1)
    color = (bits[1:] * weights).sum(axis=0).astype(np.uint8)
    return mask, color

def save(color, w, h, path, mask=None):
    """Save with checkerboard for transparency."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    xx, yy = np.meshgrid(np.arange(w), np.arange(h))
    ck = ((xx // 4 + yy // 4) & 1).astype(np.uint8)
    ck_val = np.where(ck, 64, 96).astype(np.uint8)
    img[:,:,0] = ck_val
    img[:,:,1] = ck_val
    img[:,:,2] = ck_val
    flat_c = color.flatten().clip(0, 63)
    rgb = pal64[flat_c].reshape(h, w, 3)
    if mask is not None:
        m = mask.flatten().astype(bool).reshape(h, w)
    else:
        m = np.ones((h, w), dtype=bool)
    for c in range(3):
        ch = img[:,:,c]
        ch[m] = rgb[:,:,c][m]
        img[:,:,c] = ch
    Image.fromarray(img).save(path)

def save_plain(color, w, h, path):
    """Save without transparency."""
    flat_c = color.flatten().clip(0, 63)
    rgb = pal64[flat_c].reshape(h, w, 3)
    Image.fromarray(rgb).save(path)

# ── Try both raw and RLE-decompressed ──
def rle_decompress(data):
    out = bytearray()
    i = 0
    while i < len(data):
        ctrl = data[i]; i += 1
        if ctrl == 0:
            break
        count = ctrl >> 1
        if ctrl & 1:
            out.extend(data[i:i+count]); i += count
        else:
            b = data[i]; i += 1
            out.extend([b] * count)
    return bytes(out)

for fname in ['bcdfx', 'bcdfy', 'bcdfz']:
    path = f'{AMIGA}/{fname}'
    if not os.path.exists(path):
        continue
    with open(path, 'rb') as f:
        raw = f.read()
    
    # Decompressed version
    dec = rle_decompress(raw)
    
    print(f'\n=== {fname} === raw={len(raw)} B, rle_first_stream={len(dec)} B')
    
    # ── RAW data renderings (NO RLE) ──
    print('  --- RAW (no RLE) ---')
    
    # Common width × planes combinations that divide evenly
    candidates = []
    for w in [16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 144, 160, 192, 256, 320]:
        pb = w // 8
        if pb == 0: continue
        byte_per_row = pb  # per plane
        for planes in [1, 4, 5, 6, 7]:
            bpr = byte_per_row * planes
            if bpr == 0: continue
            for skip in range(0, min(128, len(raw))):
                usable = len(raw) - skip
                h = usable // bpr
                if h < 1: continue
                used = bpr * h
                # Check if this is an exact or near-exact fit
                leftover = usable - used
                if leftover < bpr and h > 0 and h < 5000:
                    candidates.append((w, h, planes, skip, leftover, used))
    
    # Show best candidates (sorted by leftover, smallest first)
    candidates.sort(key=lambda x: x[4])
    seen = set()
    for w, h, planes, skip, leftover, used in candidates[:30]:
        key = (w, h, planes, skip)
        if key in seen: continue
        seen.add(key)
        color, _ = render_planes(raw, w, planes, skip=skip)
        if color is None: continue
        # Count unique colors and check for structured content
        unique = len(set(color.flatten()))
        if unique > 1:
            print(f'    raw w={w:3d} h={h:4d} planes={planes} skip={skip:3d} leftover={leftover:4d} unique_colors={unique:3d}')
    
    # ── RLE-decompressed renderings ──  
    print('  --- RLE (first stream, 14448 B) ---')
    for w in [16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 144, 160, 192]:
        pb = w // 8
        if pb == 0: continue
        for planes in [4, 5, 6, 7]:
            bpr = pb * planes
            if bpr == 0: continue
            h = len(dec) // bpr
            if h < 1 or h > 5000: continue
            used = bpr * h
            leftover = len(dec) - used
            if leftover < bpr:
                color, _ = render_planes(dec, w, planes)
                if color is not None:
                    unique = len(set(color.flatten()))
                    print(f'    rle w={w:3d} h={h:4d} planes={planes} leftover={leftover:4d} unique_colors={unique:3d}')
    print()
