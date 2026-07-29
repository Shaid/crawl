#!/usr/bin/env python3
"""Decompress bcdfx/bcdfy/bcdfz with the correct RLE (LAB_0043) and render at various sizes."""
import struct, os, sys
import numpy as np
from PIL import Image

AMIGA = 'data/blackcrypt/amiga'
OUT   = '/tmp'

# ── RLE (bcdfu LAB_0043) ────────────────────────────────────────────
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

# ── Palette from bcdfq ──────────────────────────────────────────────
with open(f'{AMIGA}/bcdfq', 'rb') as f:
    bcdfq = f.read()

def read_pal(data, off, n):
    return [struct.unpack('>H', data[off+i*2:off+i*2+2])[0] for i in range(n)]

dung_pal = read_pal(bcdfq, 0x02EA, 32)   # dungeon palette at CODE+0x2C6 = file offset 0x2EA

def pal_rgb(v, hb=False):
    r,g,b = (v>>8)&0xF, (v>>4)&0xF, v&0xF
    if hb: r,g,b = r>>1, g>>1, b>>1
    return (r*17, g*17, b*17)

# Build 64-entry colour table (0-31 base, 32-63 EHB half-bright)
pal64 = np.zeros((64, 3), dtype=np.uint8)
for i in range(64):
    idx = i if i < 32 else i - 32
    hb = i >= 32
    pal64[i] = pal_rgb(dung_pal[idx], hb)

# ── Decode helpers ───────────────────────────────────────────────────
def decode_7bpp(data, w, h):
    """7-plane sequential: plane0=mask, planes1-6=6bpp colour."""
    pb = w // 8
    need = pb * h * 7
    if len(data) < need:
        return None, None
    buf = np.frombuffer(data[:need], dtype=np.uint8).reshape(7, h, pb)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    mask = bits[0]
    weights = (1 << np.arange(6)).reshape(6, 1, 1)
    color = (bits[1:] * weights).sum(axis=0).astype(np.uint8)
    return mask, color

def decode_6bpp(data, w, h):
    """6-plane sequential colour (no mask)."""
    pb = w // 8
    need = pb * h * 6
    if len(data) < need:
        return None
    buf = np.frombuffer(data[:need], dtype=np.uint8).reshape(6, h, pb)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    weights = (1 << np.arange(6)).reshape(6, 1, 1)
    return (bits * weights).sum(axis=0).astype(np.uint8)

def decode_4bpp(data, w, h):
    """4-plane sequential."""
    pb = w // 8
    need = pb * h * 4
    if len(data) < need:
        return None
    buf = np.frombuffer(data[:need], dtype=np.uint8).reshape(4, h, pb)
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    weights = (1 << np.arange(4)).reshape(4, 1, 1)
    return (bits * weights).sum(axis=0).astype(np.uint8)

def save_color(color, w, h, name, mask=None):
    """Render colour image with optional transparency."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    # Checkerboard background
    xx, yy = np.meshgrid(np.arange(w), np.arange(h))
    ck = ((xx // 4 + yy // 4) & 1).astype(np.uint8)
    ck_val = np.where(ck, 64, 96).astype(np.uint8)
    img[:,:,0] = ck_val
    img[:,:,1] = ck_val
    img[:,:,2] = ck_val
    # Apply colour
    flat_c = color.flatten()
    rgb = pal64[flat_c].reshape(h, w, 3)
    if mask is not None:
        m = mask.flatten().astype(bool)
        m2d = m.reshape(h, w)
    else:
        m2d = np.ones((h, w), dtype=bool)
    for c in range(3):
        ch = img[:,:,c]
        ch[m2d] = rgb[:,:,c][m2d]
        img[:,:,c] = ch
    Image.fromarray(img).save(f'{OUT}/{name}_color.png')
    print(f'  wrote {OUT}/{name}_color.png  ({w}x{h})')

def save_grey(px, w, h, name):
    gs = (px.astype(np.float32) * 255 / 63).astype(np.uint8)
    Image.frombytes('L', (w, h), gs.tobytes()).save(f'{OUT}/{name}_grey.png')
    print(f'  wrote {OUT}/{name}_grey.png  ({w}x{h})')

# ── Process each file ────────────────────────────────────────────────
for fname, label in [('bcdfx', 'x'), ('bcdfy', 'y'), ('bcdfz', 'z')]:
    path = f'{AMIGA}/{fname}'
    if not os.path.exists(path):
        print(f'{fname}: not found')
        continue
    with open(path, 'rb') as f:
        raw = f.read()
    dec = rle_decompress(raw)
    print(f'\n{fname}: {len(raw)} raw → {len(dec)} decompressed bytes')

    # Save decompressed payload
    with open(f'{OUT}/{fname}_decompressed.bin', 'wb') as f:
        f.write(dec)

    # ── Try various sizes ──
    sizes = [
        # (w, h, planes, desc)
        (32,  516, 7, "32x516 7bpp — vertical wall strips"),
        (64,  301, 6, "64x301 6bpp — wall side/tile"),
        (64,  258, 7, "64x258 7bpp — tile with mask"),
        (128, 129, 7, "128x129 7bpp — floor/ceiling atlas quarter"),
        (32,  301, 6, "32x301 6bpp — narrow wall strips"),
        (96,  201, 6, "96x201 6bpp —"),
        (48,  301, 6, "48x301 6bpp —"),
        (16,  903, 6, "16x903 6bpp — single column strips"),
        (32,  258, 7, "32x258 7bpp — strips with mask"),
        (48,  258, 7, "48x258 7bpp —"),
        (64,  226, 6, "64x226 6bpp —"),
    ]

    for w, h, planes, desc in sizes:
        if planes == 7:
            mask, color = decode_7bpp(dec, w, h)
            if color is None:
                continue
            save_color(color, w, h, f'bcdf{label}_{w}x{h}_{planes}bpp', mask)
        elif planes == 6:
            color = decode_6bpp(dec, w, h)
            if color is None:
                continue
            save_color(color, w, h, f'bcdf{label}_{w}x{h}_{planes}bpp')
        elif planes == 4:
            color = decode_4bpp(dec, w, h)
            if color is None:
                continue
            save_color(color, w, h, f'bcdf{label}_{w}x{h}_{planes}bpp')

print('\nDone.')
