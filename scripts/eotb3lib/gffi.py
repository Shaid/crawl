"""GFFI cinematic container parser (INTRO/DARK/FINALE/LICH.GFF).

Confirmed byte-exact against data/eotb3/dosvga/*.GFF and cross-checked
against ThirdEye's apps/thirdeye/resources/gffi.cpp/.hpp (independent
open-source reimplementation). Made by Miles Design Inc (copyright string
embedded right after the header) for Westwood/SSI's cutscene player
(CINE.EXE). See docs/eotb3/dosvga/data-structure.md.

Layout:
    GFFIHeader (24 B):
        signature[4]        "GFFI"
        unknown1    u16      (0 observed)
        unknown2    u16      (3 observed)
        header      u32      0x1C — offset where the body/copyright text starts
        directory_offset u32
        directory_size   u32
        unknown3    u32      (0 observed)
        unknown4    u32

    At directory_offset: GFFIDirectoryHeader (10 B):
        unknown1        u32  (8 observed)
        directory_size  u32  (size of the tag-block area that follows,
                               NOT including this header or the trailer)
        number_of_tags  u16

    Then `number_of_tags` tagged blocks, back to back:
        GFFIBlockHeader (8 B):
            tag[4]              4-char asset-type tag, e.g. "BMP ", "PAL ",
                                 "BMA ", "LSE " (trailing space kept in the
                                 file; we strip/normalise it)
            number_of_elements  u32
        then number_of_elements x GFFIBlock (12 B):
            unique  u32     asset id within this tag
            offset  u32     absolute file offset of the raw asset bytes
            size    u32     byte length of the raw asset bytes

    Directory ends with a u16 trailer that must be 0, located at
    directory_offset + directory_size (from GFFIDirectoryHeader).

Known tags seen in the wild: BMP (still image), BMA (bitmap animation —
concatenated frames, see bitmap.py), PAL (palette, 26-byte-header form —
see palette.load_resource_palette), LSE (music/sound, XMI-ish blob).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

GFFI_ID = b"GFFI"


@dataclass
class GffAsset:
    tag: str
    unique: int
    offset: int
    size: int


@dataclass
class Gffi:
    data: bytes
    directory_offset: int
    directory_size: int
    number_of_tags: int
    assets: list = field(default_factory=list)  # list[GffAsset]

    def by_tag(self, tag: str):
        return [a for a in self.assets if a.tag == tag]

    def read(self, asset: GffAsset) -> bytes:
        return self.data[asset.offset:asset.offset + asset.size]


def load(path: str) -> Gffi:
    with open(path, "rb") as f:
        data = f.read()

    if data[0:4] != GFFI_ID:
        raise ValueError(f"{path}: not a GFFI file")

    _sig, _u1, _u2, _hdr, dir_off, dir_size, _u3, _u4 = struct.unpack_from(
        "<4sHHIIIII", data, 0
    )

    # Trailer offset uses the DirectoryBlock's OWN directory_size field
    # (read below), not GFFIHeader.directory_size -- the two differ (the
    # header's directory_size includes the 10-byte DirectoryBlock header
    # itself; the inner one does not).
    d_u1, d_dir_size, n_tags = struct.unpack_from("<IIH", data, dir_off)

    trailer_off = dir_off + d_dir_size
    trailer = struct.unpack_from("<H", data, trailer_off)[0]
    if trailer != 0:
        raise ValueError(f"{path}: GFFI directory trailer != 0 at {trailer_off:#x}")

    g = Gffi(data=data, directory_offset=dir_off, directory_size=d_dir_size,
              number_of_tags=n_tags)

    pos = dir_off + 10  # sizeof(GFFIDirectoryHeader)
    for _ in range(n_tags):
        tag_raw, n_elems = struct.unpack_from("<4sI", data, pos)
        pos += 8
        tag = tag_raw.rstrip(b" \x00").decode("latin-1")
        for _ in range(n_elems):
            unique, off, size = struct.unpack_from("<III", data, pos)
            pos += 12
            g.assets.append(GffAsset(tag=tag, unique=unique, offset=off, size=size))

    return g
