#!/usr/bin/env python3
"""Build a pixel-preserving webfont from an extracted Black Crypt font atlas."""

import argparse
import json
from pathlib import Path

from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


def make_glyph(image, frame, units_per_pixel=100):
    pen = TTGlyphPen(None)
    left = frame["x"]
    top = frame["y"]
    for row in range(frame["h"]):
        for column in range(frame["w"]):
            if image.getpixel((left + column, top + row))[3] == 0:
                continue
            x0 = column * units_per_pixel
            x1 = (column + 1) * units_per_pixel
            y0 = (frame["h"] - row - 1) * units_per_pixel
            y1 = (frame["h"] - row) * units_per_pixel
            pen.moveTo((x0, y0))
            pen.lineTo((x1, y0))
            pen.lineTo((x1, y1))
            pen.lineTo((x0, y1))
            pen.closePath()
    return pen.glyph()


def build_font(source_root, output_dir):
    sprite_dir = source_root / "public/assets/blackcrypt/amiga/sprites"
    atlas = Image.open(sprite_dir / "font-big.png").convert("RGBA")
    manifest = json.loads((sprite_dir / "font-big.json").read_text())
    codepoints = list(range(0x20, 0x5B))
    if len(codepoints) != len(manifest["frames"]):
        raise ValueError("font-big atlas does not contain ASCII 0x20-0x5A")

    glyph_order = [".notdef"] + [f"uni{codepoint:04X}" for codepoint in codepoints]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (900, 0)}
    cmap = {}
    for codepoint, frame in zip(codepoints, manifest["frames"]):
        glyph_name = f"uni{codepoint:04X}"
        glyphs[glyph_name] = make_glyph(atlas, frame)
        metrics[glyph_name] = (900, 0)
        cmap[codepoint] = glyph_name

    font = FontBuilder(1000, isTTF=True)
    font.setupGlyphOrder(glyph_order)
    font.setupCharacterMap(cmap)
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics(metrics)
    font.setupHorizontalHeader(ascent=800, descent=0)
    font.setupOS2(
        sTypoAscender=800,
        sTypoDescender=0,
        usWinAscent=800,
        usWinDescent=0,
        sxHeight=500,
        sCapHeight=800,
    )
    font.setupNameTable(
        {
            "familyName": "Black Crypt Big",
            "styleName": "Regular",
            "uniqueFontIdentifier": "Black Crypt Big Regular",
            "fullName": "Black Crypt Big Regular",
            "psName": "BlackCrypt-Big",
        }
    )
    font.setupPost()

    output_dir.mkdir(parents=True, exist_ok=True)
    ttf_path = output_dir / "black-crypt-big.ttf"
    woff2_path = output_dir / "black-crypt-big.woff2"
    font.save(ttf_path)
    font.flavor = "woff2"
    font.save(woff2_path)
    print(f"Generated {ttf_path} and {woff2_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build_font(args.source_root, args.output)
