#!/usr/bin/env python3
"""Render bcdfx/bcdfy/bcdfz as RAW bitplanes with the CORRECT palette."""
import struct, os
import numpy as np
from PIL import Image

AMIGA = 'data/blackcrypt/amiga'
OUT   = '/tmp'

# ── Palette ──
with open(f'{AMIGA}/bcdfq', 'rb') as f:
    bcdfq = f.read()

def read_pal(data, off, n):
    return [struct.unpack('>H', data[off+i*2:off+i*2+2])[0] for i in range(n)]

# Use dungeon palette at file offset 0x2EA (CODE+0x2C6)
dung_pal = read_pal(bcdfq, 0x02EA, 32)

# Also try monster palette at 0x2C6 for comparison
mon_pal = read_pal(bcdfq, 0x02C6, 32)

def pal_rgb(v, hb=False):
    r,g,b = (v>>8)&0xF, (v>>4)&0xF, v&0xF
    if hb: r,g,b = r>>1, g>>1, b>>1
    return (r*17, g*17, b*17)

def build_pal64(pal32):
    pal64 = np.zeros((64, 3), dtype=np.uint8)
    for i in range(64):
        idx = i if i < 32 else i - 32
        pal64[i] = pal_rgb(pal32[idx], i >= 32)
    return pal64

pal_dung = build_pal64(dung_pal)
pal_mon  = build_pal64(mon_pal)

def render_raw(raw, w, planes, skip=0):
    """Width w, N planes, skip first `skip` bytes. Returns (pixels, h)."""
    data = raw[skip:]
    pb = w // 8
    bpr = pb * planes
    h = len(data) // bpr
    if h == 0:
        return None, 0
    used = bpr * h
    data = data[:used]
    buf = np.frombuffer(data, dtype=np.uint8).reshape(planes, h, pb)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    weights = (1 << np.arange(planes)).reshape(planes, 1, 1)
    color = (bits * weights).sum(axis=0).astype(np.uint8)
    return color, h

def render_interleaved(raw, w, planes, skip=0):
    """Interleaved bitplanes: each row has all planes packed together."""
    data = raw[skip:]
    pb = w // 8
    row_stride = pb * planes  # bytes per row across all planes
    h = len(data) // row_stride
    if h == 0:
        return None, 0
    used = row_stride * h
    data = data[:used]
    # Reshape to (h, planes, pb) then transpose
    buf = np.frombuffer(data, dtype=np.uint8).reshape(h, planes, pb)
    # Now to (planes, h, pb) for unpackbits
    buf = buf.transpose(1, 0, 2)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    weights = (1 << np.arange(planes)).reshape(planes, 1, 1)
    color = (bits * weights).sum(axis=0).astype(np.uint8)
    return color, h

def render_planar_first_plane(raw, w, planes_total, skip=0):
    """First plane is mask, rest are colour."""
    data = raw[skip:]
    pb = w // 8
    bpr = pb * planes_total
    h = len(data) // bpr
    if h == 0:
        return None, None, 0
    used = bpr * h
    data = data[:used]
    buf = np.frombuffer(data, dtype=np.uint8).reshape(planes_total, h, pb)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    mask = bits[0]
    color_planes = planes_total - 1
    weights = (1 << np.arange(color_planes)).reshape(color_planes, 1, 1)
    color = (bits[1:] * weights).sum(axis=0).astype(np.uint8)
    return mask, color, h

def save_img(color, w, h, path, mask=None, pal=pal_dung):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    xx, yy = np.meshgrid(np.arange(w), np.arange(h))
    ck = ((xx // 4 + yy // 4) & 1).astype(np.uint8)
    ck_val = np.where(ck, 64, 96).astype(np.uint8)
    img[:,:,0] = ck_val
    img[:,:,1] = ck_val
    img[:,:,2] = ck_val
    flat_c = color.flatten().clip(0, 63)
    rgb = pal[flat_c].reshape(h, w, 3)
    if mask is not None:
        m = mask.flatten().astype(bool).reshape(h, w)
    else:
        m = np.ones((h, w), dtype=bool)
    for c in range(3):
        ch = img[:,:,c]
        ch[m] = rgb[:,:,c][m]
        img[:,:,c] = ch
    Image.fromarray(img).save(path)

# ── Process each file ──
for fname in ['bcdfx', 'bcdfy', 'bcdfz']:
    path = f'{AMIGA}/{fname}'
    if not os.path.exists(path):
        continue
    with open(path, 'rb') as f:
        raw = f.read()
    
    print(f'\n=== {fname} ({len(raw)} B) ===')
    
    # Find exact-fit candidates: skip such that (len-usable) % bpr == 0
    candidates = []
    for skip in range(0, 128):
        usable = len(raw) - skip
        for w in [16, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 320]:
            pb = w // 8
            if pb == 0:
                continue
            for planes in [4, 6, 7]:
                bpr = pb * planes
                if bpr == 0:
                    continue
                if usable % bpr == 0:
                    h = usable // bpr
                    if 10 <= h <= 10000:
                        candidates.append((skip, w, h, planes, 'sequential'))
            # Also check interleaved (same bytes needed, just different layout)
            # Same BPR applies
    
    # Remove duplicates and sort by leftover (which is 0 for all here)
    # Show the most promising ones
    print(f"  Exact-fit raw planar candidates ({len(candidates)} total):")
    # Just show a sample of interesting ones
    seen_h = set()
    for skip, w, h, planes, layout in sorted(candidates, key=lambda x: (x[3], x[1]))[:50]:
        if planes == 4 and w != 32 and w != 64:
            continue
        key = (w, h, planes, skip)
        if key in seen_h: continue
        seen_h.add(key)
        print(f"    skip={skip:3d} w={w:3d} h={h:5d} planes={planes} ")
    
    # Actually render the most promising candidates
    print(f"  Rendering best candidates...")
    
    # Unique size/plane combos for rendering
    render_targets = []
    for skip in range(0, 128, 1):
        usable = len(raw) - skip
        # 6bpp: w=64 is common for Amiga textures
        for w in [32, 40, 48, 64, 80, 96]:
            pb = w // 8
            if pb == 0: continue
            for planes in [4, 6, 7]:
                bpr = pb * planes
                if bpr == 0: continue
                if usable % bpr == 0:
                    h = usable // bpr
                    if 30 <= h <= 6000:
                        render_targets.append((skip, w, h, planes))
    
    # Render a few distinct ones
    rendered = set()
    for skip, w, h, planes in render_targets[:30]:
        key = (w, h, planes, skip)
        if key in rendered: continue
        rendered.add(key)
        
        if planes == 7:
            mask, color, _ = render_planar_first_plane(raw, w, 7, skip)
            if color is not None:
                tag = f'{fname}_raw_skip{skip}_{w}x{h}_7bpp'
                save_img(color, w, h, f'{OUT}/{tag}_color.png', mask, pal_dung)
                print(f"    Saved: {tag}_color.png")
                # Also try with monster palette
                save_img(color, w, h, f'{OUT}/{tag}_monpal.png', mask, pal_mon)
                print(f"    Saved: {tag}_monpal.png")
        elif planes == 6:
            color, _ = render_raw(raw, w, 6, skip)
            if color is not None:
                tag = f'{fname}_raw_skip{skip}_{w}x{h}_6bpp'
                save_img(color, w, h, f'{OUT}/{tag}_color.png', pal=pal_dung)
                print(f"    Saved: {tag}_color.png")
                # Monster palette version
                save_img(color, w, h, f'{OUT}/{tag}_monpal.png', pal=pal_mon)
                print(f"    Saved: {tag}_monpal.png")
    
    # Also try interleaved for selected sizes
    # Try common widths with interleaved layout
    if len(raw) >= 100000:
        for w in [32, 48, 64, 96]:
            pb = w // 8
            for planes in [6, 7]:
                bpr = pb * planes
                for skip in range(0, 128):
                    usable = len(raw) - skip
                    if usable % bpr == 0:
                        h = usable // bpr
                        if 30 <= h <= 5000:
                            if planes == 7:
                                # For interleaved, render differently
                                data = raw[skip:]
                                row_stride = bpr
                                h_fit = usable // row_stride
                                used = row_stride * h_fit
                                data = data[:used]
                                buf = np.frombuffer(data, dtype=np.uint8).reshape(h_fit, planes, pb)
                                buf = buf.transpose(1, 0, 2)
                                bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
                                mask = bits[0]
                                weights = (1 << np.arange(6)).reshape(6, 1, 1)
                                color = (bits[1:] * weights).sum(axis=0).astype(np.uint8)
                                tag = f'{fname}_intl_skip{skip}_{w}x{h_fit}_7bpp'
                                save_img(color, w, h_fit, f'{OUT}/{tag}.png', mask, pal_dung)
                                print(f"    Saved: {tag}.png (interleaved)")
                            else:
                                data = raw[skip:]
                                row_stride = bpr
                                h_fit = usable // row_stride
                                used = row_stride * h_fit
                                data = data[:used]
                                buf = np.frombuffer(data, dtype=np.uint8).reshape(h_fit, planes, pb)
                                buf = buf.transpose(1, 0, 2)
                                bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
                                weights = (1 << np.arange(planes)).reshape(planes, 1, 1)
                                color = (bits * weights).sum(axis=0).astype(np.uint8)
                                tag = f'{fname}_intl_skip{skip}_{w}x{h_fit}_{planes}bpp'
                                save_img(color, w, h_fit, f'{OUT}/{tag}.png', pal=pal_dung)
                                print(f"    Saved: {tag}.png (interleaved)")
                            break  # one interleaved per width is enough

print('\nDone.')
