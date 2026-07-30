#!/usr/bin/env python3
"""
bcdft S_4/S_5 LZ77 decompressor — fixes: fixup phase exits bit loop.
"""
from pathlib import Path

def extract_s5(path='data/blackcrypt/amiga/bcdft'):
    with open(path, 'rb') as f:
        data = f.read()
    pos = 0; hunk = 0
    while pos < len(data) - 4:
        tag = int.from_bytes(data[pos:pos+4], 'big')
        if tag == 0x3EA:
            lw = int.from_bytes(data[pos+4:pos+8], 'big')
            p = data[pos+8:pos+8+lw*4]
            if hunk == 5: return p
            pos += 8 + lw * 4; hunk += 1
        elif tag == 0x3E9:
            lw = int.from_bytes(data[pos+4:pos+8], 'big')
            pos += 8 + lw * 4; hunk += 1
        elif tag == 0x3EB:
            pos += 8; hunk += 1
        elif tag in (0x3EC, 0x3F2, 0x3F3, 0x3E7):
            pos += 4
        else:
            pos += 4
    raise ValueError("S_5 not found")

EXTRA_TABLE = [0x06, 0x0a, 0x0a, 0x12, 0x02, 0x03, 0x03, 0x04]
OFFSET_TABLE = [0x003F, 0x007F, 0x007F, 0x00FF, 0x00BE, 0x027E, 0x047E, 0x08FE]
LENGTH_TABLE = [0x06, 0x07, 0x07, -128, 0x07, -127, -126, -125, -128, -125, -123, -122]


class Decomp:
    def __init__(self, s5):
        self.s5 = s5
        self.buf_size = 0x48FC
        self.buf = bytearray(self.buf_size)  # PERSISTENT circular buffer
        self.buf_pos = self.buf_size
        self.comp_pos = min(0x14bed, len(s5))
        self.d1 = 0x66
        self.table_counter = 0x000060DA
        self.lit_count = 32
        self.fifo = bytearray(8)
        
        # Initial refill
        self.refill()
        self.buf_pos = self.buf_size
    
    def refill(self):
        """Fill buf from compressed data. Buffer is PERSISTENT (not cleared)."""
        n = self.buf_size
        pos = self.buf_size
        lc = self.lit_count if self.lit_count > 0 else 32
        for _ in range(min(lc, n)):
            if self.comp_pos <= 0: break
            self.comp_pos -= 1; pos -= 1
            self.buf[pos] = self.s5[self.comp_pos]; n -= 1
        self.lit_count = 0
        while n > 0 and self.comp_pos > 0 and self.table_counter > 0:
            self.table_counter -= 1
            if self.table_counter <= 0: break
            while self.lit_count > 0 and n > 0 and self.comp_pos > 0:
                self.comp_pos -= 1; pos -= 1
                self.buf[pos] = self.s5[self.comp_pos]
                self.lit_count -= 1; n -= 1
            if n <= 0 or self.comp_pos <= 0: break
            def gb():
                nonlocal n, pos
                if self.comp_pos < 0: return -1
                b = (self.d1 >> 7) & 1
                self.d1 = (self.d1 << 1) & 0xFF
                if self.d1 == 0:
                    self.comp_pos -= 1
                    if self.comp_pos < 0: return -1
                    self.d1 = (self.s5[self.comp_pos] << 1) & 0xFF
                    if b: self.d1 |= 1
                return b
            b = gb()
            if b < 0: break
            if b == 0: d0, d7 = 2, 0
            else:
                b = gb()
                if b < 0: break
                if b == 0: d0, d7 = 3, 1
                else:
                    b = gb()
                    if b < 0: break
                    if b == 0: d0, d7 = 4, 2
                    else:
                        b = gb()
                        if b < 0: break
                        if b == 0: d0, d7 = 5, 3
                        else:
                            b = gb()
                            if b < 0: break
                            if b == 0: d0, d7 = 2, 2
                            else:
                                self.comp_pos -= 1
                                d0 = self.s5[self.comp_pos]
                                d7 = 3
            d3 = d7
            b = gb()
            if b < 0: break
            if b == 0:
                b = gb()
                if b < 0: break
                self.lit_count = b
            else:
                b = gb()
                if b < 0: break
                if b == 0:
                    d6 = 2
                    ec = {0: 2, 1: 3, 2: 3, 3: 4}.get(d3, 0)
                else:
                    d6 = EXTRA_TABLE[d3] if d3 < len(EXTRA_TABLE) else 0
                    ec = {4: 5, 5: 7, 6: 14, 7: 0}.get(d3 + 4, 0)
                self.lit_count = 0
                for _ in range(ec):
                    b = gb()
                    if b < 0: break
                    self.lit_count = (self.lit_count << 1) | b
                self.lit_count += d6
            d7 = d3; a5 = 0
            b = gb()
            if b < 0: break
            if b == 1:
                d3d = d3 * 2
                b = gb()
                if b < 0: break
                if b == 0: d7 = d3 + 4
                else: d7 = d3 + 8
                a5 = OFFSET_TABLE[d3d] if d3d < len(OFFSET_TABLE) else 0
            lt = LENGTH_TABLE[d7] if d7 < len(LENGTH_TABLE) else 0
            if lt >= 0:
                dv = 0
                for _ in range(lt):
                    b = gb()
                    if b < 0: break
                    dv = (dv << 1) | b
            else:
                self.comp_pos -= 1
                dv = self.s5[self.comp_pos]
                masked = lt & 0x0F
                if masked > 0:
                    for _ in range(masked):
                        b = gb()
                        if b < 0: break
                        dv = (dv << 1) | b
            off = a5 + dv + 1
            cl = d0 + 1
            src = pos + off
            if src >= self.buf_size: src -= self.buf_size
            if src < 0: src = 0
            for _ in range(cl):
                if n <= 0 or pos <= 0: break
                pos -= 1; src -= 1
                if src < 0: src = self.buf_size - 1
                self.buf[pos] = self.buf[src]; n -= 1
    
    def ensure_buf(self):
        if self.buf_pos <= 0:
            self.refill()
            self.buf_pos = self.buf_size
        return self.buf_pos > 0
    
    def read_fifo(self):
        """Read 8 bytes from S_6 into FIFO, return last longword."""
        if not self.ensure_buf(): return -1
        for i in range(8):
            if self.buf_pos <= 0: break
            self.buf_pos -= 1
            self.fifo[i] = self.buf[self.buf_pos]
        return int.from_bytes(bytes(self.fifo[4:8]), 'big')
    
    def read_4bytes(self):
        """Read 4 bytes, return as longword."""
        if not self.ensure_buf(): return -1
        val = 0
        for _ in range(4):
            if self.buf_pos <= 0: break
            self.buf_pos -= 1
            val = (val << 8) | self.buf[self.buf_pos]
        return val


def decompress_s5(s5):
    dz = Decomp(s5)
    out = bytearray()
    max_out = 166676 + 40808
    
    while len(out) < max_out:
        # Read control word
        d0 = dz.read_fifo()
        if d0 < 0: break
        
        if d0 & 0x80000000:
            # Pass end marker
            continue
        
        # Process bits until either we find a 1-bit (fixup) or exhaust all 32 bits
        # When bit=1, the fixup phase exits the loop
        for bit_idx in range(32):
            if len(out) >= max_out: break
            if not dz.ensure_buf(): break
            
            bit = (d0 >> (31 - bit_idx)) & 1
            
            if bit == 0:
                # Literal: 4 bytes → output
                for _ in range(4):
                    if not dz.ensure_buf(): break
                    dz.buf_pos -= 1
                    out.append(dz.buf[dz.buf_pos])
            else:
                # Fixup phase: process until count=0
                while True:
                    count = dz.read_fifo()
                    if count < 0: break
                    if count == 0:
                        # End of fixups for this control bit
                        # After fixups, read NEXT control word (bra 0x22)
                        # Remaining bits are discarded
                        break
                    
                    # Read base index
                    base_idx = dz.read_fifo()
                    if base_idx < 0: break
                    
                    # Skip offset entries
                    for _ in range(count & 0xFFFF):
                        off = dz.read_fifo()
                        if off < 0: break
                
                # After fixup phase, break out of bit loop and read next control word
                break
    
    raw = bytes(out)
    s1 = raw[:166676] if len(raw) >= 166676 else raw + b'\x00' * (166676 - len(raw))
    s2 = raw[166676:166676+40808] if len(raw) >= 166676+40808 else b''
    return s1, s2, raw


if __name__ == '__main__':
    base = Path(__file__).parent.parent
    s5 = extract_s5(str(base / 'data/blackcrypt/amiga/bcdft'))
    print(f"S_5: {len(s5)}B")
    
    s1, s2, raw = decompress_s5(s5)
    print(f"Output: {len(raw)}B, non-zero: {sum(1 for b in raw if b)}/{len(raw)}")
    print(f"First 32: {raw[:32].hex()}")
    
    out_dir = base / 'data/blackcrypt/extracted'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'bcdft_decompressed.bin').write_bytes(raw)
    print(f"Saved {len(raw)}B")
