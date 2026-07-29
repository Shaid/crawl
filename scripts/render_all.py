#!/usr/bin/env python3
"""One-shot render of all confirmed Black Crypt assets."""
import struct, os
import numpy as np
from PIL import Image

OUT = 'data/blackcrypt/extracted'
AMIGA = 'data/blackcrypt/amiga'
PAYLOADS = 'data/blackcrypt/extracted/payloads'
os.makedirs(OUT, exist_ok=True)

# ── Palette ──────────────────────────────────────────────────────
PAL_12 = [0x000,0xC86,0xF00,0xB00,0xD80,0xFE0,0x0F0,0x0B0,0x040,0x0DD,0x00F,0x07C,0xFD9,0xEB8,0xF0F,0xE09,0x720,0x952,0xA53,0x33B,0x222,0x444,0x666,0x999,0xCCC,0xFFF,0xB60,0xC70,0xC80,0xD90,0xEB0,0xFC0]

def pal_rgb(v, hb=False):
    r,g,b=(v>>8)&0xF,(v>>4)&0xF,v&0xF
    if hb: r,g,b=r>>1,g>>1,b>>1
    return (r*17,g*17,b*17)

def read_pal(data, off, n):
    return [struct.unpack('>H', data[off+i*2:off+i*2+2])[0] for i in range(n)]

# Read bcdfq palettes
with open(f'{AMIGA}/bcdfq', 'rb') as f: bcdfq = f.read()
raven_pal = read_pal(bcdfq, 0x0266, 16)
title_pal = read_pal(bcdfq, 0x0286, 32)
dung_pal  = read_pal(bcdfq, 0x02C6, 32)

# ── Decode helpers ────────────────────────────────────────────────
def decode_seq(data, w, h, planes=6):
    pb = w // 8
    px = []
    for y in range(h):
        for x in range(w):
            c = 0
            for bp in range(planes):
                off = bp * pb * h + y * pb + (x // 8)
                if off < len(data) and (data[off] >> (7-(x%8))) & 1:
                    c |= 1 << bp
            px.append(c)
    return px

def decode_seq_fast(data, w, h, planes=6):
    """Vectorized numpy version of decode_seq. Returns numpy uint8 array."""
    pb = w // 8
    total = pb * h * planes
    if len(data) < total:
        return None
    buf = np.frombuffer(data[:total], dtype=np.uint8).reshape(planes, h, pb)
    # Extract each bit into a (planes, h, w) boolean array
    bits = np.unpackbits(buf, axis=2, bitorder='big')[:, :, :w]
    # Weight each plane and sum: plane i contributes 2^i
    weights = (1 << np.arange(planes)).reshape(planes, 1, 1)
    return (bits * weights).sum(axis=0).astype(np.uint8)

def save_grey(px, w, h, maxc, name):
    gs = bytes(int(c*255/maxc) for c in px)
    Image.frombytes('L', (w, h), gs).save(f'{OUT}/{name}_grey.png')

def save_color(px, w, h, pal, name, is_6bpp=True):
    img = Image.new('RGB', (w, h))
    for y in range(h):
        for x in range(w):
            c = px[y*w + x]
            if not is_6bpp:
                img.putpixel((x,y), pal_rgb(pal[c]))
            else:
                idx = c if c < 32 else c - 32
                img.putpixel((x,y), pal_rgb(pal[idx], c >= 32))
    img.save(f'{OUT}/{name}_color.png')

# ── 01. bcdfo character portraits (32×24×6bpp, offset $60) ──────
print('01 bcdfo portraits...')
with open(f'{AMIGA}/bcdfo', 'rb') as f: bcdfo = f.read()
W,H,TS = 32,24,576
base,n = 96, (len(bcdfo)-96)//TS
for scale in [2,4]:
    cols,rows = 10,(n+9)//10
    sc, sg = Image.new('RGB',(cols*W*scale,rows*H*scale)), Image.new('L',(cols*W*scale,rows*H*scale))
    for i in range(n):
        px = decode_seq(bcdfo[base+i*TS:base+(i+1)*TS],W,H)
        img_c = Image.new('RGB',(W,H)); img_g = Image.new('L',(W,H))
        for y in range(H):
            for x in range(W):
                c=px[y*W+x]; o=c*3
                # 6bpp EHB: map pixel value to palette
                idx = c if c < 32 else c - 32
                hb = c >= 32
                img_c.putpixel((x,y),pal_rgb(PAL_12[idx], hb))
                img_g.putpixel((x,y),int(c*255/63))
        sc.paste(img_c.resize((W*scale,H*scale),Image.NEAREST),((i%cols)*W*scale,(i//cols)*H*scale))
        sg.paste(img_g.resize((W*scale,H*scale),Image.NEAREST),((i%cols)*W*scale,(i//cols)*H*scale))
    sc.save(f'{OUT}/01_portraits_{scale}x_color.png')
    sg.save(f'{OUT}/01_portraits_{scale}x_grey.png')
print(f'   {n} portraits')

# ── 02. bcdfx/z P2 floor/ceiling atlas ────────────────────────────
print('02 dungeon textures...')
for src in ['bcdfx','bcdfz']:
    p2 = open(f'{PAYLOADS}/{src}_p2_raw.bin','rb').read()
    for w,h,ch in [(208,356,'P2')]:
        px = decode_seq(p2,w,h,6)
        save_grey(px,w,h,63,f'02_{src}_{ch}_{w}x{h}')
print('   P2 floor/ceiling atlases')

# ── 03. bcdfx/z P4/P5 wall sides ──────────────────────────────────
print('03 wall sides...')
for src in ['bcdfx','bcdfz']:
    for p in ['p4','p5']:
        pdat = open(f'{PAYLOADS}/{src}_{p}_raw.bin','rb').read()
        px = decode_seq(pdat,80,193,6)
        save_grey(px,80,193,63,f'03_{src}_{p}_80x193')
print('   P4/P5 wall sides')

# ── 04. bcdfx/z P3 viewport mask ──────────────────────────────────
print('04 viewport mask...')
for src in ['bcdfx','bcdfz']:
    p3 = open(f'{PAYLOADS}/{src}_p3_raw.bin','rb').read()
    img = Image.new('L',(320,269))
    for y in range(269):
        for xb in range(40):
            b = p3[y*40+xb]
            for bit in range(8):
                img.putpixel((xb*8+bit,y),255 if (b>>(7-bit))&1 else 0)
    img.save(f'{OUT}/04_{src}_p3_mask.png')
print('   P3 masks')

# ── 06. bcdfa icon tiles (64×24×6bpp, RLE) ───────────────────────
print('06 bcdfa icons...')
def rle_decompress(data, start):
    out,pos=bytearray(),start
    while pos < len(data):
        ctrl=data[pos];pos+=1
        if ctrl==0: return bytes(out),pos
        n=ctrl>>1
        if ctrl&1: out.extend(data[pos:pos+n]); pos+=n
        else: out.extend([data[pos]]*n); pos+=1
    return bytes(out),pos

with open(f'{AMIGA}/bcdfa','rb') as f: bcdfa=f.read()
streams=[]; pos=0
while pos<len(bcdfa):
    d,pos=rle_decompress(bcdfa,pos)
    streams.append(d)  # include empty — index must match stream number

W2,H2,TS2 = 64,24,1152
all_tiles=[]
for sdata in streams:
    n2=len(sdata)//TS2
    for ti in range(n2):
        px=decode_seq(sdata[ti*TS2:(ti+1)*TS2],W2,H2)
        all_tiles.append(px)

cols2,rows2 = 8,(len(all_tiles)+7)//8
sc2,sg2 = Image.new('RGB',(cols2*W2*4,rows2*H2*4)), Image.new('L',(cols2*W2*4,rows2*H2*4))
for i,px in enumerate(all_tiles):
        img_c=Image.new('RGB',(W2,H2)); img_g=Image.new('L',(W2,H2))
        for y in range(H2):
            for x in range(W2):
                c=px[y*W2+x]
                idx=c if c<32 else c-32; hb=c>=32
                img_c.putpixel((x,y),pal_rgb(PAL_12[idx],hb))
                img_g.putpixel((x,y),int(c*255/63))
        sc2.paste(img_c.resize((W2*4,H2*4),Image.NEAREST),((i%cols2)*W2*4,(i//cols2)*H2*4))
        sg2.paste(img_g.resize((W2*4,H2*4),Image.NEAREST),((i%cols2)*W2*4,(i//cols2)*H2*4))
sc2.save(f'{OUT}/06_bcdfa_tiles_color.png')
sg2.save(f'{OUT}/06_bcdfa_tiles_grey.png')
print(f'   {len(all_tiles)} tiles')

# ── 07. bcdfo UI elements (from bcdfp LAB_010D descriptors) ──────
print('07 bcdfo UI elements...')
ui_entries = [
    ('chargen_ui',      0x5160,128,105),
    ('chargen_logo',    0x7F50,192, 47),
    ('stats_panel',     0xD758,128, 62),
    ('sigil_0',         0xAE68, 32, 14),
    ('sigil_1',         0xAFB8, 32, 14),
    ('sigil_2',         0xB108, 32, 14),
    ('sigil_3',         0xB258, 32, 14),
    ('sigil_4',         0xB3A8, 32, 14),
    ('guild_fighter',   0xB658,128, 22),
    ('guild_cleric',    0xBE98,128, 22),
    ('guild_mage',      0xC6D8,128, 22),
    ('guild_druid',     0xCF18,128, 22),
]
numeral_offs = [0xF286,0xF2DA,0xF32E,0xF382,0xF3D6,0xF42A,0xF47E,0xF4D2,0xF526,0xF57A,0xF5CE]
for name,off,w,h in ui_entries:
    td=bcdfo[off:off+w//8*h*6]
    px=decode_seq(td,w,h)
    save_grey(px,w,h,63,f'07_{name}_{w}x{h}')
    sc=2 if w<=32 else 1
    Image.frombytes('L',(w,h),bytes(int(c*255/63) for c in px)).resize((w*(2+sc),h*(2+sc)),Image.NEAREST).save(f'{OUT}/07_{name}_{w}x{h}_{2+sc}x.png')

# Numerals sheet
n_sheet=Image.new('L',(16*11*3,7*3))
for i,off in enumerate(numeral_offs):
    px=decode_seq(bcdfo[off:off+84],16,7)
    n_sheet.paste(Image.frombytes('L',(16,7),bytes(int(c*255/63) for c in px)).resize((48,21),Image.NEAREST),(i*48,0))
n_sheet.save(f'{OUT}/07_numerals_sheet.png')
print('   character creation UI, logo, stats panel, sigils, guild banners, numerals')

# ── 08. bcdfr screens (from bcdfq chunk readers) ──────────────────
print('08 bcdfr screens...')
with open(f'{AMIGA}/bcdfr','rb') as f: bcdfr=f.read()
screens = [
    ('s0_raven', bcdfr[:32000],     320,200,4, raven_pal,False),
    ('s1_title', bcdfr[32000:80000], 320,200,6, title_pal,True),
    ('s2_logo',  bcdfr[80000:90560], 320, 44,6, title_pal,True),
    ('s3_plot',  bcdfr[90560:],      320,200,6, dung_pal, True),
]
for name,td,w,h,planes,pal,is_6bpp in screens:
    px=decode_seq(td,w,h,planes)
    save_grey(px,w,h,(1<<planes)-1,f'08_{name}')
    save_color(px,w,h,pal,f'08_{name}',is_6bpp)
print('   Raven logo, Title, BC banner, Plot text')

# ── 09. bcdfb–bcdfn monster sprites (7-plane: mask + 6bpp EHB) ───
print('09 bcdfb–bcdfn monster sprites...')
MONSTER_FILES = ['bcdfb','bcdfc','bcdfd','bcdfe','bcdff','bcdfg',
                 'bcdfh','bcdfi','bcdfj','bcdfk','bcdfl','bcdfm','bcdfn']

def parse_monster_dir(raw):
    """Parse 12-byte header + 42 × 28-byte directory entries from RAW data."""
    entries = []
    n_entries = 42
    for i in range(n_entries):
        off = 12 + i * 28
        if off + 28 > len(raw):
            break
        data_off = struct.unpack('>I', raw[off:off+4])[0]
        bpr = struct.unpack('>I', raw[off+4:off+8])[0]
        typ = struct.unpack('>H', raw[off+20:off+22])[0]
        w = struct.unpack('>H', raw[off+22:off+24])[0]
        h = struct.unpack('>H', raw[off+24:off+26])[0]
        entries.append((data_off, bpr, typ, w, h))
    return entries

def rle_decompress_streams(raw, header_size=12, n_entries=42):
    """RLE decompress multiple streams from raw file, skipping header+dir.
    Returns concatenated decompressed data. Matches extract_bcdfb_bcdfn.py's approach."""
    dir_end = header_size + n_entries * 28
    all_dec = bytearray()
    pos = dir_end
    while pos < len(raw):
        while pos < len(raw) and raw[pos] == 0:
            pos += 1
        if pos >= len(raw):
            break
        j = pos
        out = bytearray()
        while j < len(raw):
            ctrl = raw[j]; j += 1
            if ctrl == 0:
                break
            n = ctrl >> 1
            if ctrl & 1:
                out.extend(raw[j:j+n]); j += n
            else:
                if j < len(raw):
                    out.extend([raw[j]] * n); j += 1
        all_dec.extend(out)
        pos = j
    return bytes(all_dec)

def render_monster_sprite(data, data_off, bpr, w, h):
    """Render 7-plane sprite: plane0=mask, planes1-6=6bpp EHB color.
    Returns (mask_arr, color_arr) as numpy uint8 arrays, or (None, None)."""
    total = bpr * 7
    if data_off + total > len(data):
        return None, None
    blk = data[data_off:data_off + total]
    mask = decode_seq_fast(blk[:bpr], w, h, planes=1)
    color = decode_seq_fast(blk[bpr:], w, h, planes=6)
    if mask is None or color is None:
        return None, None
    return mask, color

def save_monster_grey(mask, color, w, h, name):
    """Save greyscale preview of monster sprite (color only, no mask)."""
    gs = (color.astype(np.float32) * 255 / 63).astype(np.uint8)
    Image.frombytes('L', (w, h), gs.tobytes()).save(f'{OUT}/{name}_grey.png')

def save_monster_color(mask, color, w, h, pal, name):
    """Save color monster sprite with transparency (checkerboard bg)."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    # Checkerboard background
    xx, yy = np.meshgrid(np.arange(w), np.arange(h))
    ck = ((xx // 4 + yy // 4) & 1).astype(np.uint8)
    ck_val = np.where(ck, 64, 96).astype(np.uint8)
    img[:, :, 0] = ck_val
    img[:, :, 1] = ck_val
    img[:, :, 2] = ck_val
    # Build 64-entry RGB palette
    pal64 = np.zeros((64, 3), dtype=np.uint8)
    for i in range(64):
        idx = i if i < 32 else i - 32
        hb = i >= 32
        pal64[i] = pal_rgb(pal[idx], hb)
    # Map color values to RGB
    flat_c = color.flatten()
    rgb = pal64[flat_c].reshape(h, w, 3)
    # Apply mask: transparent → keep checkerboard
    m = mask.flatten().astype(bool)
    m2d = m.reshape(h, w)
    for c in range(3):
        ch = img[:, :, c]
        ch[m2d] = rgb[:, :, c][m2d]
        img[:, :, c] = ch
    Image.fromarray(img).save(f'{OUT}/{name}_color.png')

total_sprites = 0
for fname in MONSTER_FILES:
    fpath = f'{AMIGA}/{fname}'
    if not os.path.exists(fpath):
        continue
    with open(fpath, 'rb') as f: raw_data = f.read()
    entries = parse_monster_dir(raw_data)
    mdata = rle_decompress_streams(raw_data)
    # Group entries by data_off — each group = one sprite with N frames
    from collections import OrderedDict
    groups = OrderedDict()
    for data_off, bpr, typ, w, h in entries:
        if w == 0 or h == 0 or bpr == 0:
            continue
        if data_off + bpr * 7 > len(mdata):
            continue
        if data_off not in groups:
            groups[data_off] = []
        groups[data_off].append((data_off, bpr, typ, w, h, fname))

    for data_off, group in groups.items():
        bpr = group[0][1]; w = group[0][3]; h = group[0][4]
        if bpr != (w // 8) * h:
            continue
        n_frames = len(group)
        bpr_row = w // 8
        base_h = h // n_frames
        rem = h % n_frames

        for fi in range(n_frames):
            fh = base_h + (1 if fi < rem else 0)
            start_row = sum(base_h + (1 if fj < rem else 0) for fj in range(fi))
            # Extract just this frame's bitplane data
            frame_bpr = bpr_row * fh
            blk = bytearray()
            for plane in range(7):
                plane_off = data_off + plane * bpr
                blk.extend(mdata[plane_off + start_row * bpr_row : plane_off + start_row * bpr_row + frame_bpr])
            mask = decode_seq_fast(bytes(blk[:frame_bpr]), w, fh, planes=1)
            color = decode_seq_fast(bytes(blk[frame_bpr:]), w, fh, planes=6)
            if mask is None or color is None:
                continue
            tag = f'09_{group[0][5]}_{data_off:05x}_{fi:02d}_{w}x{fh}'
            try:
                save_monster_grey(mask, color, w, fh, tag)
                save_monster_color(mask, color, w, fh, dung_pal, tag)
                total_sprites += 1
            except Exception as e:
                print(f'   WARN {tag}: {e} mask={mask.shape} color={color.shape}')
    print(f'   {fname}: total {total_sprites} frames')
print(f'   Total: {total_sprites} frames')

# ── 10. bcdfa BCSPEED.GFK sprite animations (32×14 @4bpp) ─────────
print('10 bcdfa BCSPEED.GFK sprites...')
# Re-create bcdfa streams (reuse from section 06)
streams.clear()
pos = 0
while pos < len(bcdfa):
    d, pos = rle_decompress(bcdfa, pos)
    streams.append(d)  # include empty — index must match stream number

# Parse stream 407 (BCSPEED.GFK)
s407 = streams[407]
gfk_marker = b'BCSPEED\x00GFK\x00'
gfk_markers = []
idx = 0
while True:
    idx = s407.find(gfk_marker, idx)
    if idx == -1:
        break
    gfk_markers.append(idx)
    idx += len(gfk_marker)

gfk_entries = []
for i in range(len(gfk_markers)):
    m = gfk_markers[i]
    type_val = struct.unpack('>H', s407[m + len(gfk_marker):m + len(gfk_marker) + 2])[0]
    data_start = 0 if i == 0 else gfk_markers[i - 1] + len(gfk_marker) + 2
    entry_data = s407[data_start:m]
    gfk_entries.append((type_val, entry_data))
    print(f'   GFK entry {i}: type=0x{type_val:04x}, {len(entry_data)} bytes')

# Render all GFK sprites as 32×14 @4bpp, EHB palette
GFK_W, GFK_H, GFK_P = 32, 14, 4
GFK_BPR = GFK_W // 8  # 4 bytes/row/plane
GFK_FRAME = GFK_BPR * GFK_H * GFK_P  # 224 bytes per frame
import math

for ei, (type_val, edata) in enumerate(gfk_entries):
    if len(edata) < GFK_FRAME:
        continue
    n_frames = len(edata) // GFK_FRAME
    cols = min(n_frames, 8)
    rows = (n_frames + cols - 1) // cols
    sheet = Image.new('RGB', (cols * GFK_W * 4, rows * GFK_H * 4), (0, 0, 0))
    for fi in range(n_frames):
        frame_data = edata[fi * GFK_FRAME:(fi + 1) * GFK_FRAME]
        px = decode_seq(frame_data, GFK_W, GFK_H, GFK_P)
        img = Image.new('RGB', (GFK_W, GFK_H))
        for y in range(GFK_H):
            for x in range(GFK_W):
                c = px[y * GFK_W + x]
                img.putpixel((x, y), pal_rgb(dung_pal[c], False))
        sheet.paste(img.resize((GFK_W * 4, GFK_H * 4), Image.NEAREST),
                    ((fi % cols) * GFK_W * 4, (fi // cols) * GFK_H * 4))
    sheet.save(f'{OUT}/10_bcspeed_gfk_e{ei:02d}_type{type_val:04x}.png')
print(f'   {len(gfk_entries)} GFK entries rendered')

# ── 11. Visual confirmation of item graphics location ──────────────
print('11 item graphics — from bcdfo portrait tiles + LAB_010D UI')
print('   Items in inventory/character screen: bcdfo 32x24 tiles (109 portraits)')
print('   Items on dungeon floor: in bcdft S_5 (LZ77-compressed, not yet extractable)')

print(f'\nDone. {OUT}/')
