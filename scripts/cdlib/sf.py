"""Crystal Dragon `SF` backward bit-stream LZ77 (Unpack hunk 0 +0x5F2..+0x708).

Header (big-endian): 'SF', u32 unpacked size, u32 packed size, payload.
The reader walks the payload backward and fills the output backward.
Spec: docs/crystaldragon/amiga/data-structure.md "SF codec".
"""
import os
import struct


class SFError(ValueError):
    pass


def unsf(d: bytes, strict: bool = True):
    """Return (decoded, leftover_payload_bytes). strict raises on a bad stream."""
    if d[:2] != b'SF':
        raise SFError('not an SF file')
    usize, psize = struct.unpack('>II', d[2:10])
    src = d[10:10 + psize]
    if len(src) != psize:
        raise SFError('truncated payload')
    ip = len(src)
    out = bytearray(usize)
    op = usize
    st = [0, 0]  # bit buffer, unused

    def rd():
        nonlocal ip
        if ip <= 0:
            raise SFError('read past start of payload')
        ip -= 1
        return src[ip]

    b = rd()

    def bit():
        nonlocal b
        c = (b >> 7) & 1
        b = (b << 1) & 0xFF
        if b == 0:
            nb = rd()
            c = (nb >> 7) & 1
            b = ((nb << 1) | 1) & 0xFF
        return c

    def bits(n):
        v = 0
        for _ in range(n):
            v = (v << 1) | bit()
        return v

    def gamma(start):
        k, full, n = 1, 1, start
        while True:
            v = bits(k)
            n += v
            if v != full:
                return n
            k += 1
            full = full * 2 + 1

    while op > 0:
        if bit() == 0:
            n = gamma(1)
            if n > op:
                raise SFError('literal run overruns output')
            for _ in range(n):
                op -= 1
                out[op] = rd()
        else:
            if bit() == 0:
                L, ob = 2, 9
            elif bit() == 0:
                L, ob = 3, 10
            elif bit() == 0:
                L, ob = 4, 12
            else:
                ob = 9 if bit() else 14
                L = gamma(5)
            off = bits(ob)
            p = op + off
            if L > op or p > usize:
                raise SFError('match out of range')
            for _ in range(L):
                p -= 1
                op -= 1
                out[op] = out[p]
    if strict and ip != 0:
        raise SFError('%d payload bytes left over' % ip)
    return bytes(out), ip


# ---- file ids -> names (BuildFileName, hunk 0 +0x388A) ----
def file_name(fid: int) -> str:
    """Game's name for file id: lowercase hex, '1' prefix when >= 0x100."""
    return ('1' if fid >= 0x100 else '') + '%02x' % (fid & 0xFF)


def level_id(level: int) -> int:
    """Level number -> file id (MULU #9 / ADDI #$CC)."""
    return level * 9 + 0xCC


def level_of_id(fid: int):
    """Inverse; None if fid is not on the level-id grid."""
    return (fid - 0xCC) // 9 if fid >= 0xCC and (fid - 0xCC) % 9 == 0 else None


def iter_data_files(data_dir):
    for n in sorted(os.listdir(data_dir)):
        try:
            fid = int(n[1:], 16) + 0x100 if n.startswith('1') and len(n) == 3 else int(n, 16)
        except ValueError:
            continue
        yield fid, n, os.path.join(data_dir, n)
