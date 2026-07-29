#!/usr/bin/env python3
"""
Extract monster sprites from bcdfv using the correct stride-14 interleave format.

The bcdfp sprite copy loop converts from storage format to rendering format:
  Source: 8 consecutive words (16 bytes) per tile strip, one word per plane
  Dest:   strided by 14 bytes between plane words (2 MOVE.W + 12 LEA)
  
Sprite data begins after a 6-byte (or 10-byte) header per sprite entry.
The 40KB Phase 2 Block 2 output from bcdfv contains all monster sprites.

Comparison: bcdfb-n files have 42 directory entries, 495 total animation frames
across 13 files. The bcdfv format should produce the same frames.
"""
import struct, os
from pathlib import Path
from collections import Counter

BASE = Path(__file__).parent.parent

# ── RLE decompression (bcdfu LAB_0043) ──

def rle_decompress(data):
    """RLE decompression (bcdfu LAB_0043): ctrl=0 end, bit0=1 literal, bit0=0 fill."""
    out = bytearray()
    pos = 0
    while pos < len(data):
        ctrl = data[pos]; pos += 1
        if ctrl == 0:
            break
        count = ctrl >> 1
        if ctrl & 1:  # literal
            out.extend(data[pos:pos + count])
            pos += count
        else:  # fill
            out.extend([data[pos]] * count)
            pos += 1
    return bytes(out)

# ── Phase 2 block extraction from bcdfv ──

def read_bcdfv_block(data, offset):
    """Read an RLE block from bcdfv starting at offset. Returns (type, decompressed, new_offset)."""
    # Block header: longword length + byte type
    if offset + 5 >= len(data):
        return None, None, offset
    block_len = int.from_bytes(data[offset:offset+4], 'big')
    block_type = data[offset + 4]  # 0=RLE, 1=RAW
    payload = data[offset+5:offset+5+block_len-1]
    
    if block_type == 0:  # RLE
        dec = rle_decompress(payload)
    else:  # RAW
        dec = bytes(payload)
    
    return block_type, dec, offset + 5 + block_len - 1

def extract_phase2(path):
    """Extract Phase 2 game data from bcdfv."""
    with open(path, 'rb') as f:
        data = f.read()
    
    # Phase 1 blocks (intro, overwritten)
    # From AGENTS.md: Phase 1 blocks end around offset where Phase 2 starts
    # Phase 2 starts after the 9 LAB_0022 calls
    
    # Let me just find Phase 2 by scanning for the block sizes
    # From docs: Phase 2 Block 2 = $6754 RLE, Block 3 = $678C RAW
    # Total file: 191,917 bytes
    
    # Scan through the file looking for block headers
    pos = 0
    phase1_blocks = []
    # Phase 1: 9 blocks followed by a 48KB copy
    # Total Phase 1 = $14525 (83237) bytes of read data
    # Phase 1 end ≈ 83237 bytes from start
    
    blocks = []
    while pos < len(data) - 8:
        block_len = int.from_bytes(data[pos:pos+4], 'big')
        if block_len == 0:
            pos += 1
            continue
        if block_len > 0x10000:  # too large, probably not a block
            pos += 1
            continue
        
        block_type = data[pos + 4] if pos + 4 < len(data) else 0
        if block_type not in (0, 1):
            pos += 1
            continue
            
        payload_len = block_len - 1
        if pos + 5 + payload_len > len(data):
            pos += 1
            continue
        
        payload = data[pos+5:pos+5+payload_len]
        
        if block_type == 0:
            dec = rle_decompress(payload)
        else:
            dec = bytes(payload)
        
        blocks.append({
            'offset': pos,
            'len': block_len,
            'type': 'RLE' if block_type == 0 else 'RAW',
            'payload_size': len(payload),
            'decompressed_size': len(dec),
            'data': dec
        })
        
        pos += 5 + payload_len
    
    return blocks

# ── Sprite extraction ──

def convert_stride14_to_sequential(data, width, height, skip_header=6):
    """
    Convert from stride-14 interleaved format to sequential planar.
    
    Source format (per group of 8 words = 16 bytes):
      [word0][word1][word2][word3][word4][word5][word6][word7]
      Each word = 16 pixels of one plane
      
    Stride-14 destination:
      Each word written with 14-byte stride between plane words
      
    Sequential output: all rows of plane 0, then plane 1, ..., plane 7
    """
    bpr = width // 8  # bytes per row per plane
    n_planes = 8  # 8 words per group (mask + 6bpp + maybe 1 extra)
    frame_size = bpr * height  # bytes per plane
    
    pos = skip_header
    sequential = bytearray(n_planes * frame_size)
    
    words_per_row = width // 16  # number of 16-pixel groups per row
    
    for y in range(height):
        for wx in range(words_per_row):
            if pos + 16 > len(data):
                break
            # Read 8 source words (16 bytes)
            src_words = list(struct.unpack('>8H', data[pos:pos+16]))
            pos += 16
            
            # Each source word goes to a different plane at stride 14 in dest
            # But we're writing to sequential, so:
            # For each plane, extract the 16 bits and place in the right position
            for plane in range(n_planes):
                word = src_words[plane]
                # Write to sequential: plane * frame_size + y * bpr + wx * 2
                byte_offset = plane * frame_size + y * bpr + wx * 2
                if byte_offset + 2 <= len(sequential):
                    struct.pack_into('>H', sequential, byte_offset, word)
    
    return bytes(sequential)

def sequential_to_6bpp_pixels(seq_data, width, height):
    """
    Convert 8-plane sequential planar to 6bpp pixel data.
    Planes: plane0=mask, planes1-6=color, plane7=?
    Masks: if plane0 bit=0, pixel is transparent (color 0)
    """
    bpr = width // 8
    frame = bpr * height
    pixels = bytearray(width * height)
    
    for y in range(height):
        for x in range(width):
            byte_idx = x // 8
            bit_idx = 7 - (x % 8)
            
            pixel = 0
            for p in range(1, 7):  # color planes 1-6
                off = p * frame + y * bpr + byte_idx
                if off < len(seq_data) and (seq_data[off] >> bit_idx) & 1:
                    pixel |= 1 << (p - 1)
            
            pixels[y * width + x] = pixel
    
    return pixels

def render_ppm(pixels, width, height, path):
    """Render pixel data as PPM (greyscale)."""
    with open(path, 'wb') as f:
        f.write(f'P6\n{width} {height}\n255\n'.encode())
        for c in pixels:
            grey = int(c * 255 / 63)
            f.write(bytes([grey, grey, grey]))

# ── Main ──

if __name__ == '__main__':
    bcdfv_path = BASE / 'data/blackcrypt/amiga/bcdfv'
    bcdfv_path = str(bcdfv_path)
    
    # Load bcdfv Phase 2 data
    print("Extracting bcdfv blocks...")
    blocks = extract_phase2(bcdfv_path)
    
    print(f"Found {len(blocks)} blocks:")
    for i, b in enumerate(blocks):
        print(f"  Block {i}: {b['type']} size={b['len']} "
              f"payload={b['payload_size']} dec={b['decompressed_size']} "
              f"offset=0x{b['offset']:x}")
    
    # Phase 2 should have blocks 2 and 7 as the main data
    # Block 2: $6754 RLE → 40,000B output (main sprite data)
    # Block 7: $0A81 RLE → 4,590B output (overwrites Block 3 start)
    
    # Find likely Phase 2 blocks
    phase2_blocks = [b for b in blocks if b['decompressed_size'] > 30000]
    print(f"\nPhase 2 candidates (large blocks):")
    for b in phase2_blocks:
        print(f"  Block at 0x{b['offset']:x}: {b['type']} "
              f"dec={b['decompressed_size']}")
    
    if not phase2_blocks:
        print("No large blocks found. Trying to find sprite data differently...")
        # Maybe the data is stored differently
        # Let me try loading the whole file and looking for 8-word groups
        with open(bcdfv_path, 'rb') as f:
            raw = f.read()
        
        # Look for the known sprite data pattern
        # A 40KB region with structured data
        print(f"\nRaw file: {len(raw)} bytes")
        
        # Try to find the Phase 2 data by looking at the end of the file
        # After Phase 1 intro data (~83KB), Phase 2 starts
        # Total = 191,917 bytes
        # Phase 1 consumes ~83,237 bytes
        
        # Try to RLE-decompress the remaining data
        remaining = raw[83237:]
        print(f"After Phase 1: {len(remaining)} bytes")
        
        # Find RLE blocks in remaining
        pos = 0
        dec_blocks = []
        while pos < len(remaining) - 8:
            if remaining[pos] == 0:
                pos += 1
                continue
            block_len = int.from_bytes(remaining[pos:pos+4], 'big')
            if block_len > 0x10000 or block_len == 0:
                pos += 1
                continue
            block_type = remaining[pos + 4]
            payload = remaining[pos+5:pos+5+block_len-1]
            
            if block_type == 0:
                try:
                    dec = rle_decompress(payload)
                    dec_blocks.append((pos, len(dec), block_len))
                except:
                    pass
            else:
                dec_blocks.append((pos, len(payload), block_len))
            pos += 5 + block_len - 1
        
        print(f"RLE blocks in remaining data: {len(dec_blocks)}")
        for off, dec_size, comp_size in dec_blocks[:15]:
            print(f"  offset=0x{off:x} comp={comp_size} dec={dec_size}")
        
        # Find the 40KB block
        for off, dec_size, comp_size in dec_blocks:
            if abs(dec_size - 40000) < 1000:
                print(f"\nFound ~40KB block at offset 0x{off:x} in remaining "
                      f"({dec_size} bytes decompressed)")
                # Try to extract sprites from this
                # Re-decompress it
                block_len = int.from_bytes(remaining[off:off+4], 'big')
                payload = remaining[off+5:off+5+block_len-1]
                sprite_data = rle_decompress(payload)
                print(f"Sprite data: {len(sprite_data)} bytes")
                
                # Try stride-14 extraction with various sizes
                out_dir = BASE / 'data/blackcrypt/extracted/bcdfv_sprites'
                out_dir.mkdir(parents=True, exist_ok=True)
                
                # Test common monster sprite sizes
                for width, height in [(64, 96), (96, 124), (32, 32), (64, 64), 
                                       (96, 64), (32, 64), (48, 64), (80, 96)]:
                    frame_size = width // 8 * 8 * height  # 8 planes
                    if len(sprite_data) >= frame_size + 6:
                        seq = convert_stride14_to_sequential(sprite_data, width, height, skip_header=6)
                        pixels = sequential_to_6bpp_pixels(seq, width, height)
                        ppm_path = out_dir / f'test_{width}x{height}_h6.ppm'
                        render_ppm(pixels, width, height, str(ppm_path))
                        print(f"  Rendered {width}x{height} (hdr=6): "
                              f"{sum(1 for p in pixels if p)}/{len(pixels)} colored "
                              f"-> {ppm_path}")
                
                # Also try with 10-byte header
                for width, height in [(64, 96), (96, 124), (32, 32), (64, 64)]:
                    frame_size = width // 8 * 8 * height
                    if len(sprite_data) >= frame_size + 10:
                        seq = convert_stride14_to_sequential(sprite_data, width, height, skip_header=10)
                        pixels = sequential_to_6bpp_pixels(seq, width, height)
                        ppm_path = out_dir / f'test_{width}x{height}_h10.ppm'
                        render_ppm(pixels, width, height, str(ppm_path))
                        print(f"  Rendered {width}x{height} (hdr=10): "
                              f"{sum(1 for p in pixels if p)}/{len(pixels)} colored")
                
                break
PYEOF
