#!/usr/bin/env python3
"""
Extract all monster sprites from bcdfb-n files.

Format: 7-plane sequential planar (mask=plane0, color=plane1-6, EHB palette).
Directory: 12-byte header + 42 × 28-byte entries.
Entries sharing data_off are animation frames.
Frame heights: base_h = total_h // n_frames, with remainder distributed.
"""
import struct, os
from pathlib import Path
from collections import defaultdict
from PIL import Image

BASE = Path(__file__).parent.parent
AMIGA_DIR = BASE / 'data' / 'blackcrypt' / 'amiga'
OUT_DIR = BASE / 'data' / 'blackcrypt' / 'extracted' / 'monsters'

def rle_decode_all(data):
    out = bytearray(); pos = 0
    while pos < len(data):
        if data[pos] == 0x00: pos += 1; continue
        while pos < len(data):
            ctrl = data[pos]; pos += 1
            if ctrl == 0: break
            cnt = ctrl >> 1
            if ctrl & 1:
                avail = min(cnt, len(data) - pos)
                out.extend(data[pos:pos+avail]); pos += avail
            else:
                if pos >= len(data): break
                b = data[pos]; pos += 1
                out.extend([b] * cnt)
    return bytes(out)

def load_monster_palette():
    """Load monster sprite palette from bcdfq (FILE offset 0x2C6).
    
    ⚠ CRITICAL: Monster palette is at FILE offset 0x2C6 (has REDS).
    CODE+0x2C6 = file 0x2EA is the DUNGEON wall/floor palette (BROWNS/BLUES).
    Using the wrong palette gives blue ogres instead of red/brown ones."""
    with open(AMIGA_DIR / 'bcdfq', 'rb') as f:
        d = f.read()
    pal = []
    for i in range(32):
        v = struct.unpack_from('>H', d, 0x2C6 + i*2)[0]  # ← FILE offset, not CODE+offset!
        r = ((v>>8)&0xF)*17; g = ((v>>4)&0xF)*17; b = (v&0xF)*17
        pal.extend([r, g, b])
    # EHB half-bright colors 32-63 (monsters use 6-bit EHB too)
    for i in range(32):
        pal.extend([pal[i*3]//2, pal[i*3+1]//2, pal[i*3+2]//2])
    return pal

def parse_bcdfn(path):
    """Parse a bcdfb-n file, return (decompressed_data, entries_list)."""
    raw = path.read_bytes()
    entries = []
    for i in range(42):
        ent = raw[12 + i*28 : 12 + i*28 + 28]
        entries.append({
            'data_off': int.from_bytes(ent[0:4], 'big'),
            'bpr': int.from_bytes(ent[4:8], 'big'),
            'bltsize': int.from_bytes(ent[12:14], 'big'),
            'modulo': int.from_bytes(ent[14:16], 'big'),
            'type': int.from_bytes(ent[20:22], 'big'),
            'width': int.from_bytes(ent[22:24], 'big'),
            'height': int.from_bytes(ent[24:26], 'big'),
        })
    dec = rle_decode_all(raw[1188:])
    return dec, entries

def frame_heights(h_total, n_frames):
    base = h_total // n_frames
    extra = h_total % n_frames
    return [base + (1 if i < extra else 0) for i in range(n_frames)]

def render_frame(dec, data_off, bpr, w, h, pal):
    """Render 7-plane sequential planar with EHB palette.
    mask=plane0, color=plane1-6.
    """
    bpr_row = w // 8
    img = Image.new('RGB', (w, h), (0, 0, 0))
    for y in range(h):
        for x in range(w):
            xb = x // 8; bit = 0x80 >> (x & 7)
            mi = data_off + 0 * bpr + y * bpr_row + xb
            if mi >= len(dec) or not (dec[mi] & bit): continue
            val = 0
            for p in range(1, 7):
                pi = data_off + p * bpr + y * bpr_row + xb
                if pi < len(dec) and (dec[pi] & bit): val |= 1 << (p - 1)
            if val < len(pal) // 3:
                img.putpixel((x, y), (pal[val*3], pal[val*3+1], pal[val*3+2]))
    return img

def main():
    pal = load_monster_palette()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    
    for letter in 'bcdefghijklmn':
        path = AMIGA_DIR / f'bcdf{letter}'
        if not path.exists(): continue
        dec, entries = parse_bcdfn(path)
        
        # Group by data_off to find multi-frame sprites
        groups = defaultdict(list)
        for e in entries:
            groups[e['data_off']].append(e)
        
        map_idx = ord(letter) - ord('b') + 1
        print(f"bcdf{letter} (map {map_idx}): {len(dec)}B decompressed, {len(groups)} sprites")
        
        # Detect if decompressed data has a 291-byte global sprite table header.
        # Only bcdfb (map 1) has this — identified by dec[0:2] == 0x0001.
        # Other files have different patterns at dec[0] that are NOT headers.
        has_header = len(dec) >= 2 and struct.unpack_from('>H', dec, 0)[0] == 0x0001
        
        for data_off, group in sorted(groups.items()):
            e0 = group[0]
            w, h_total, bpr = e0['width'], e0['height'], e0['bpr']
            
            # Global header: 291 bytes if dec[0:2]==0x0001 (only bcdfb/map 1)
            # addq.l #6 in rendering code is for internal buffer, not file format
            global_header = 291 if has_header else 0
            pixel_off = data_off + global_header
            if pixel_off + bpr * 7 > len(dec):
                continue
            
            img = render_frame(dec, pixel_off, bpr, w, h_total, pal)
            fname = OUT_DIR / f'm{map_idx}_off{data_off}_{w}x{h_total}.png'
            img.save(fname)
    
    print(f"\nSprites saved to {OUT_DIR}/")

if __name__ == '__main__':
    main()
