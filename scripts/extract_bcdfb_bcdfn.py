"""Extract data from bcdfb-bcdfn files.

File structure (CORRECTED — was wrong before):
- 5-byte header: 2 bytes padding + 2 bytes type ID + 1 byte end-marker
- ~100 RLE-compressed data streams (bcdfu LAB_0043 algorithm)
- Streams 0-63: metadata/descriptor data
- Stream 64 (~66KB): a COPPER LIST for color animation (NOT sprite data)
- Streams 65+: actual sprite pixel data and more metadata
- Real sprites are in streams 66-82, NOT at offset +0x07e8 of the main stream
"""
import struct, sys, os
from PIL import Image

DATA = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'amiga')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'blackcrypt', 'extracted', 'bcdfb_streams')

def rle_decompress(data):
    """RLE decompressor matching bcdfu.asm LAB_0043"""
    output = bytearray()
    i = 0
    while i < len(data):
        ctrl = data[i]; i += 1
        if ctrl == 0: break
        count = ctrl >> 1
        if ctrl & 1:
            if i + count > len(data): break
            output.extend(data[i:i+count]); i += count
        else:
            if i >= len(data): break
            b = data[i]; i += 1
            output.extend([b] * count)
    return bytes(output)

def list_streams(filepath):
    """List all RLE streams in a bcdfb-style file"""
    with open(filepath, 'rb') as f:
        raw = f.read()
    streams = []
    pos = 5  # skip 5-byte header
    while pos < len(raw):
        while pos < len(raw) and raw[pos] == 0: pos += 1
        if pos >= len(raw): break
        start = pos
        output = bytearray()
        j = pos
        while j < len(raw):
            ctrl = raw[j]; j += 1
            if ctrl == 0: break
            count = ctrl >> 1
            if ctrl & 1:
                if j + count > len(raw): break
                output.extend(raw[j:j+count]); j += count
            else:
                if j >= len(raw): break
                b = raw[j]; j += 1
                output.extend([b] * count)
        streams.append((start, j, len(output)))
        pos = j
    return raw, streams

def main():
    for l in list('bcdefghijklmn'):
        path = os.path.join(DATA, f'bcdf{l}')
        if not os.path.exists(path): continue
        name = os.path.basename(path)
        raw, streams = list_streams(path)
        print(f'\n{name}: {len(streams)} RLE streams in {len(raw)} bytes')
        for i, (s, e, dl) in enumerate(streams):
            if dl > 50:
                print(f'  Stream {i}: +{s:04x}-{e:04x} {dl}B')

if __name__ == '__main__':
    main()

