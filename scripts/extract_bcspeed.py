#!/usr/bin/env python3
"""Extract BCSPEED.GFK sprites from bcdfa stream 407.

Stream 407 format:
  - 333-byte preamble (purpose unknown, contains 1 sprite frame)
  - 16 × (marker + type + sprite_data)
    - marker: "BCSPEED\0GFK\0" (12 bytes)
    - type: big-endian uint16 = frame count (0x02–0x06)
    - sprite_data: type × 224 bytes (32×14×4bpp sequential planar)

Entry 0 has 281 extra bytes after its type×224 data (possible4th frame or unrelated).
"""
import os, sys, struct
from PIL import Image

def rle_decompress_stream(data, start):
    out, pos = bytearray(), start
    while pos < len(data):
        ctrl = data[pos]; pos += 1
        if ctrl == 0:
            return bytes(out), pos
        count = ctrl >> 1
        if ctrl & 1:
            out.extend(data[pos:min(pos + count, len(data))])
            pos += count
        else:
            out.extend([data[pos]] * count)
            pos += 1
    return bytes(out), pos

def decode_4bpp_seq(data, w, h):
    """Decode 4bpp sequential planar data (4 planes, LSB first)."""
    pb = w // 8
    pixels = []
    for y in range(h):
        for x in range(w):
            col = 0
            for bp in range(4):
                off = bp * pb * h + y * pb + (x >> 3)
                if off < len(data) and (data[off] >> (7 - (x & 7))) & 1:
                    col |= 1 << bp
            pixels.append(col)
    return pixels

def greyscale_img(pixels, w, h):
    img = Image.new('L', (w, h))
    for y in range(h):
        for x in range(w):
            img.putpixel((x, y), pixels[y * w + x] * 17)
    return img

def main():
    fname = sys.argv[1] if len(sys.argv) > 1 else 'data/blackcrypt/amiga/bcdfa'
    out_dir = sys.argv[2] if len(sys.argv) > 2 else 'data/blackcrypt/extracted/bcspeed_gfk'
    os.makedirs(out_dir, exist_ok=True)

    with open(fname, 'rb') as f:
        data = f.read()

    # Decompress all RLE streams
    streams = []
    pos = 0
    while pos < len(data):
        if data[pos] == 0x00:
            streams.append(b'')
            pos += 1
            continue
        d, pos = rle_decompress_stream(data, pos)
        streams.append(d)

    s407 = streams[407]
    print(f'Stream 407: {len(s407)} bytes')

    # Find all BCSPEED markers
    markers = []
    idx = 0
    while True:
        idx = s407.find(b'BCSPEED', idx)
        if idx == -1:
            break
        markers.append(idx)
        idx += 1

    MARKER_LEN = 12  # "BCSPEED\0GFK\0"
    FRAME = 224      # 32/8 * 4 * 14
    W, H = 32, 14

    print(f'Found {len(markers)} BCSPEED markers')

    total_frames = 0
    for i, m in enumerate(markers):
        type_val = struct.unpack('>H', s407[m + MARKER_LEN:m + MARKER_LEN + 2])[0]
        data_start = m + MARKER_LEN + 2
        edata = s407[data_start:data_start + type_val * FRAME]
        n_frames = len(edata) // FRAME
        total_frames += n_frames

        if n_frames == 0:
            continue

        # Render animation frames as a horizontal strip
        cols = min(n_frames, 8)
        rows = (n_frames + cols - 1) // cols
        scale = 4
        sheet = Image.new('L', (cols * W * scale, rows * H * scale), 0)

        for fi in range(n_frames):
            fd = edata[fi * FRAME:(fi + 1) * FRAME]
            px = decode_4bpp_seq(fd, W, H)
            img = greyscale_img(px, W, H)
            sheet.paste(img.resize((W * scale, H * scale), Image.NEAREST),
                        ((fi % cols) * W * scale, (fi // cols) * H * scale))

        out_path = os.path.join(out_dir, f'gfk_{i:02d}_t{type_val:02d}_{n_frames}f.png')
        sheet.save(out_path)
        print(f'  Entry {i:2d}: type=0x{type_val:02x}, {n_frames} frames -> {out_path}')

    print(f'\nTotal: {total_frames} frames across {len(markers)} entries')
    print(f'Output: {out_dir}/')

if __name__ == '__main__':
    main()
