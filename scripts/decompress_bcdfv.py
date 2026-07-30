"""Decompress bcdfv blocks following the actual code loading order.

Traced from bcdfu.asm LAB_0033-LAB_0040:

Phase 1 (intro):
  LAB_0038: Read $4EB0 from file → $BB80, RLE $BB80 → buffer+0 (32000B output)
  LAB_003B: Read $5067 from file → $17700, RLE $17700 → $BB80
  LAB_003D: Copy $BB80 → buffer+0 (48000 bytes)
  LAB_003C: Read $0B10 from file → $1A5E0 (raw)
  LAB_003F: Read $2500 from file → $EA60, RLE $EA60 → $BB80

  9x LAB_0022 (intro screens): each calls LAB_003F to read D0 bytes
    D0 values: $2A6B, $26E5, $279C, $1AD2, $2074, $1D80, $2688, $266E, $267D

Phase 2 (game data):
  LAB_0024: Clear buffer (48000 bytes from buffer+0)
  LAB_0039: Read $6754 from file → $BB80, RLE $BB80 → buffer+0
  LAB_003A: Read $678C from file → $BB80 (raw)
  LAB_0040: Read $0A81 from file → $EA60, RLE $EA60 → $BB80
"""
import struct, sys, os

DATA = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'amiga')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'extracted')

def rle_decompress(data):
    """bcdfu.asm LAB_0043 RLE decompressor"""
    output = bytearray()
    i = 0
    while i < len(data):
        ctrl = data[i]; i += 1
        if ctrl == 0:
            break
        count = ctrl >> 1
        if ctrl & 1:
            if i + count > len(data):
                break
            output.extend(data[i:i+count]); i += count
        else:
            if i >= len(data):
                break
            b = data[i]; i += 1
            output.extend([b] * count)
    return bytes(output)

def main():
    path = os.path.join(DATA, 'bcdfv')
    with open(path, 'rb') as f:
        raw = f.read()

    print(f"bcdfv file size: {len(raw)} bytes ({len(raw):06X})")

    pos = 0

    # Phase 1
    print("\n=== Phase 1 (intro) ===")

    # LAB_0038: Block 1 — read $4EB0 into buffer+$BB80, RLE → buffer+0
    b1_compressed = raw[pos:pos+0x4EB0]
    pos += 0x4EB0
    b1_decompressed = rle_decompress(b1_compressed)
    print(f"Block 1: @{pos-0x4EB0:06X} compressed {0x4EB0}B → decompressed {len(b1_decompressed)}B")

    # LAB_003B: Block 5 — read $5067 into buffer+$17700, RLE from $17700 → $BB80
    b5_compressed = raw[pos:pos+0x5067]
    pos += 0x5067
    b5_decompressed = rle_decompress(b5_compressed)
    print(f"Block 5: @{pos-0x5067:06X} compressed {0x5067}B → decompressed {len(b5_decompressed)}B")

    # LAB_003D: Copy $BB80 → buffer+0 (48000 bytes)
    print(f"  LAB_003D: Copy $BB80 → buffer+0 (48000B)")

    # LAB_003C: Block 6 — read $0B10 into buffer+$1A5E0 (raw)
    b6_raw = raw[pos:pos+0x0B10]
    pos += 0x0B10
    print(f"Block 6: @{pos-0x0B10:06X} raw {0x0B10}B")

    # LAB_003F: Block 4 — read $2500 into $EA60, RLE $EA60 → $BB80
    b4_compressed = raw[pos:pos+0x2500]
    pos += 0x2500
    b4_decompressed = rle_decompress(b4_compressed)
    print(f"Block 4: @{pos-0x2500:06X} compressed {0x2500}B → decompressed {len(b4_decompressed)}B")

    # 9x LAB_0022 reads (intro screens)
    lab_0022_sizes = [0x2A6B, 0x26E5, 0x279C, 0x1AD2, 0x2074, 0x1D80, 0x2688, 0x266E, 0x267D]
    total_lab22 = sum(lab_0022_sizes)
    print(f"\n  9x LAB_0022 reads (intro screens): total {total_lab22}B ({total_lab22:06X})")
    for i, sz in enumerate(lab_0022_sizes):
        chunk = raw[pos:pos+sz]
        # These go through LAB_003F: read into $EA60, RLE to $BB80
        pos += sz
    print(f"  After LAB_0022 reads: file pos = {pos:06X}")

    # Phase 2
    print("\n=== Phase 2 (game data) ===")

    # LAB_0024: Clear buffer (48000 bytes)
    print("  LAB_0024: Clear buffer+0 (48000B)")

    # LAB_0039: Block 2 — read $6754 into $BB80, RLE $BB80 → buffer+0
    b2_compressed = raw[pos:pos+0x6754]
    pos += 0x6754
    b2_decompressed = rle_decompress(b2_compressed)
    print(f"Block 2: @{pos-0x6754:06X} compressed {0x6754}B → decompressed {len(b2_decompressed)}B")

    # LAB_003A: Block 3 — read $678C into $BB80 (raw)
    b3_raw = raw[pos:pos+0x678C]
    pos += 0x678C
    print(f"Block 3: @{pos-0x678C:06X} raw {0x678C}B")

    # LAB_0040: Block 7 — read $0A81 into $EA60, RLE $EA60 → $BB80
    b7_compressed = raw[pos:pos+0x0A81]
    pos += 0x0A81
    b7_decompressed = rle_decompress(b7_compressed)
    print(f"Block 7: @{pos-0x0A81:06X} compressed {0x0A81}B → decompressed {len(b7_decompressed)}B")

    print(f"\nTotal file consumed: {pos} bytes ({pos:06X})")
    print(f"Remaining: {len(raw) - pos} bytes")

    # Reconstruct the runtime buffer
    print(f"\n=== Runtime buffer layout (after Phase 2) ===")
    print(f"buffer+0 to buffer+{len(b2_decompressed)-1}: Block 2 decompressed ({len(b2_decompressed)}B)")
    print(f"buffer+$BB80 (48000): Block 3 raw ({len(b3_raw)}B)")
    print(f"  + Block 7 decompressed overwrites start ({len(b7_decompressed)}B)")

    os.makedirs(OUT, exist_ok=True)

    # Block 2 is the main sprite data — THIS is what we need
    with open(os.path.join(OUT, 'bcdfv_block2.bin'), 'wb') as f:
        f.write(b2_decompressed)
    print(f"\nSaved block 2 decompressed: {len(b2_decompressed)}B → bcdfv_block2.bin")

    # Block 3 raw
    with open(os.path.join(OUT, 'bcdfv_block3.bin'), 'wb') as f:
        f.write(b3_raw)
    print(f"Saved block 3 raw: {len(b3_raw)}B → bcdfv_block3.bin")

    # Block 7 decompressed
    with open(os.path.join(OUT, 'bcdfv_block7.bin'), 'wb') as f:
        f.write(b7_decompressed)
    print(f"Saved block 7 decompressed: {len(b7_decompressed)}B → bcdfv_block7.bin")

    # Full runtime buffer: block 2 at 0, block 3 at $BB80, block 7 overwrites start of $BB80
    total_buf = max(0xBB80 + len(b3_raw), len(b2_decompressed))
    buf = bytearray(total_buf)
    buf[:len(b2_decompressed)] = b2_decompressed
    buf[0xBB80:0xBB80+len(b3_raw)] = b3_raw
    buf[0xBB80:0xBB80+len(b7_decompressed)] = b7_decompressed

    with open(os.path.join(OUT, 'bcdfv_sprites.bin'), 'wb') as f:
        f.write(buf)
    print(f"Saved full runtime buffer: {len(buf)}B → bcdfv_sprites.bin")

    # Analyze block 2 for sprite patterns
    print(f"\n=== Block 2 analysis ({len(b2_decompressed)} bytes) ===")
    b2 = b2_decompressed

    # Check if it divides evenly into sprite-sized chunks
    for w, h in [(64, 96), (96, 124), (96, 126), (64, 79), (64, 81),
                  (48, 52), (48, 53), (64, 55), (32, 24), (32, 55)]:
        bpr = w // 8
        for planes in [5, 6, 7]:
            plane_size = bpr * h
            total = planes * plane_size
            if total > 0 and len(b2) % total == 0:
                count = len(b2) // total
                print(f"  {w}x{h} {planes}p: {plane_size}B/plane, {total}B/sprite, {count} sprites ✓")

    # Check with row interleaving
    for w, h in [(64, 96), (96, 124), (64, 55), (32, 24)]:
        bpr = w // 8
        for planes in [5, 6, 7]:
            row_size = planes * bpr
            total = row_size * h
            if total > 0 and len(b2) % total == 0:
                count = len(b2) // total
                print(f"  {w}x{h} {planes}p interleaved: row={row_size}B, {total}B/sprite, {count} sprites ✓")

    # Check for stride patterns with modulo -2
    # BLTSIZE width = w/16+1 words, modulo -2 → effective row = (w/16+1)*2-2 = w/8
    # But what if w/16 rounds up to different word counts?
    for w, h in [(64, 96), (96, 124), (64, 55), (48, 52)]:
        words_per_row = w // 16 + 1
        bpr_with_mod = words_per_row * 2 - 2  # effective after modulo -2
        if bpr_with_mod != w // 8:
            print(f"  NOTE: w={w}: words_per_row={words_per_row}, effective_bpr={bpr_with_mod} != {w//8}")

    # Byte distribution
    print(f"\n=== Byte distribution in block 2 ===")
    from collections import Counter
    c = Counter(b2)
    for byte, count in c.most_common(15):
        pct = count * 100.0 / len(b2)
        print(f"  0x{byte:02X}: {count} ({pct:.1f}%)")

    # First 200 bytes
    print(f"\n=== First 200 bytes of block 2 ===")
    for i in range(0, min(200, len(b2)), 16):
        hex_str = ' '.join(f'{b:02X}' for b in b2[i:i+16])
        ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in b2[i:i+16])
        print(f"  {i:04X}: {hex_str}  {ascii_str}")

if __name__ == '__main__':
    main()
