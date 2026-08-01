"""The Black Crypt RLE codec — bcdfu.asm LAB_0043.

Shared by bcdfa, bcdfb-bcdfn, bcdfv, bcdfx, bcdfy and bcdfz.
"""

# bcdfb-bcdfn: the RLE stream does not start immediately after the 42-entry
# directory (0x4A4). A 214-byte uncompressed secondary table sits between them,
# so the stream begins at 1402 (0x57A) — constant across all 13 files. Decoding
# from 0x4A4 treats that raw table as RLE data and desyncs the whole stream,
# which is what produced the "24-pixel circular shift" recorded in older notes.
MONSTER_STREAM_START = 1402


def rle_decompress(data, start=0, limit=1 << 22):
    """Decompress one RLE stream.

    Control byte semantics:
      0x00       end of stream
      bit0 == 1  literal run: copy (ctrl >> 1) bytes
      bit0 == 0  fill run: repeat the next byte (ctrl >> 1) times
    """
    out = bytearray()
    pos = start
    n = len(data)
    while pos < n:
        ctrl = data[pos]
        pos += 1
        if ctrl == 0:
            break
        cnt = ctrl >> 1
        if ctrl & 1:
            out += data[pos:pos + cnt]
            pos += cnt
        else:
            if pos >= n:
                break
            out += bytes([data[pos]]) * cnt
            pos += 1
        if len(out) > limit:
            break
    return bytes(out)


def rle_decompress_end(data, start=0, limit=1 << 22):
    """Like rle_decompress, but also returns the raw file offset right after
    the terminating 0x00 — i.e. where the *next* stream (or unrelated trailing
    data) begins. Needed whenever something follows the RLE stream in the same
    file (bcdfb-bcdfn's post-sprite wall-decoration + sound region; see
    extract_bcdfbn_decor.py).
    """
    out = bytearray()
    pos = start
    n = len(data)
    while pos < n:
        ctrl = data[pos]
        pos += 1
        if ctrl == 0:
            break
        cnt = ctrl >> 1
        if ctrl & 1:
            out += data[pos:pos + cnt]
            pos += cnt
        else:
            if pos >= n:
                break
            out += bytes([data[pos]]) * cnt
            pos += 1
        if len(out) > limit:
            break
    return bytes(out), pos


def rle_streams(data, start=0, limit=1 << 22):
    """Split a multi-stream container (bcdfa) into its individual streams.

    Each stream is terminated by a 0x00 control byte; yields (offset, decoded).
    """
    pos = start
    n = len(data)
    while pos < n:
        stream_start = pos
        out = bytearray()
        while pos < n:
            ctrl = data[pos]
            pos += 1
            if ctrl == 0:
                break
            cnt = ctrl >> 1
            if ctrl & 1:
                out += data[pos:pos + cnt]
                pos += cnt
            else:
                if pos >= n:
                    break
                out += bytes([data[pos]]) * cnt
                pos += 1
            if len(out) > limit:
                break
        if not out:
            if pos <= stream_start:
                break
            continue
        yield stream_start, bytes(out)
