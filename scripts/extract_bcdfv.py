#!/usr/bin/env python3
"""Extract the Black Crypt Amiga ending sequence from bcdfv.

bcdfv is the data file for `bcdfu`, the standalone endgame overlay — not a
sprite or sound store. It holds 16 sequentially-read blocks: the congratulations
screen, an ornate picture frame, an 8x8 six-plane font, ten 160x99 narrated
illustration panels (the boss monsters you beat, in order), the Black Crypt
facade intact and destroyed, and the scrolling credits graphic.

All geometry comes from bcdfu's blitter setup; see `bclib/bcdfv.py` for the
register-by-register derivation and `docs/blackcrypt/amiga/data-structure.md`
for the byte-level spec and verification evidence.

Output:
    public/assets/blackcrypt/amiga/sprites/ending-panels.{png,json}
    public/assets/blackcrypt/amiga/sprites/ending-font.{png,json}
    public/assets/blackcrypt/amiga/screens/ending-*.png
    public/assets/blackcrypt/amiga/palettes/ending-*.json
    public/assets/blackcrypt/amiga/data/ending-script.json
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib
from bclib import bcdfv as V


def screen_rgb(planes, palette_words):
    """Render a 320x200 six-plane screen buffer to RGBA."""
    idx = bclib.decode_planar(planes, V.SCREEN_WIDTH, V.SCREEN_HEIGHT, 6)
    return bclib.to_rgba(idx, bclib.ehb_palette(palette_words))


def blank_screen():
    return bytearray(V.SCREEN_PLANE_BYTES * 6)


def put_planes(buf, data, first=0):
    """Copy whole 8000-byte screen planes into a screen buffer."""
    n = len(data) // V.SCREEN_PLANE_BYTES
    for k in range(n):
        base = (first + k) * V.SCREEN_PLANE_BYTES
        buf[base:base + V.SCREEN_PLANE_BYTES] = \
            data[k * V.SCREEN_PLANE_BYTES:(k + 1) * V.SCREEN_PLANE_BYTES]


def blit_panel(buf, panel):
    """LAB_0064: 160x99 at (80,18), source 20 B/row, 1980 B/plane."""
    x, y = V.PANEL_ORIGIN
    row_bytes = V.PANEL_WIDTH // 8
    plane_bytes = row_bytes * V.PANEL_HEIGHT
    for pl in range(V.PANEL_PLANES):
        for r in range(V.PANEL_HEIGHT):
            src = pl * plane_bytes + r * row_bytes
            dst = pl * V.SCREEN_PLANE_BYTES + (y + r) * 40 + x // 8
            buf[dst:dst + row_bytes] = panel[src:src + row_bytes]


def draw_text(buf, font, records):
    """LAB_001A/LAB_001E/LAB_0020: type each record into the text panel."""
    for col, row, text in records:
        for i, ch in enumerate(text):
            glyph = V.font_glyph(font, ord(ch))
            if glyph is None or ch == ' ':
                continue
            off = row * 40 + col + i
            for pl in range(V.FONT_PLANES):
                for r in range(V.FONT_HEIGHT):
                    buf[pl * V.SCREEN_PLANE_BYTES + off + r * 40] = glyph[pl * 8 + r]


def blit_credits(buf, credits):
    """LAB_0076: 240x153 at (32,0), one bitplane, into screen plane 4."""
    base = V.CREDITS_PLANE * V.SCREEN_PLANE_BYTES
    for r in range(V.CREDITS_HEIGHT):
        src = r * V.CREDITS_ROW_BYTES
        dst = base + r * 40 + 4
        buf[dst:dst + V.CREDITS_ROW_BYTES] = credits[src:src + V.CREDITS_ROW_BYTES]


def main():
    amiga = bclib.data_dir('blackcrypt', 'amiga')
    bcdfv_path, bcdfu_path = amiga / 'bcdfv', amiga / 'bcdfu'
    if not bcdfv_path.exists() or not bcdfu_path.exists():
        print(f'No Amiga data at {amiga} — nothing to do')
        return

    bcdfu = bcdfu_path.read_bytes()
    blocks = V.read_blocks(bcdfv_path.read_bytes(), bclib.rle_decompress)
    print('  bcdfv: 16/16 blocks decoded, all sizes exact')

    pals = {name: V.read_palette(bcdfu, name) for name in V.PALETTES}
    pal_dir = bclib.asset_dir('palettes')
    for name, words in pals.items():
        bclib.write_json(pal_dir / f'ending-{name.replace("_", "-")}.json', {
            'colors': [dict(zip('rgb', bclib.amiga12_to_rgb(w))) for w in words],
        }, pretty=True)

    scr_dir = bclib.asset_dir('screens')
    font = blocks['font']
    script = V.read_script(bcdfu)

    # --- standalone screens -------------------------------------------------
    buf = blank_screen(); put_planes(buf, blocks['congrats'])
    bclib.write_png(scr_dir / 'ending-congrats.png', screen_rgb(buf, pals['congrats']))

    buf = blank_screen(); put_planes(buf, blocks['frame'])
    bclib.write_png(scr_dir / 'ending-frame.png', screen_rgb(buf, pals['panel_a']))

    buf = blank_screen(); put_planes(buf, blocks['crypt'])
    bclib.write_png(scr_dir / 'ending-crypt.png', screen_rgb(buf, pals['crypt']))

    # LAB_005E decompresses crypt_ruin over planes 0-3 only; plane 4 survives
    # from `crypt`, which is what puts the fire colours (indices 16-31 of
    # LAB_000F) into the sky.
    ruin = blank_screen(); put_planes(ruin, blocks['crypt']); put_planes(ruin, blocks['crypt_ruin'])
    bclib.write_png(scr_dir / 'ending-crypt-ruined.png', screen_rgb(ruin, pals['crypt_ruin']))

    credits = blank_screen(); put_planes(credits, blocks['crypt'])
    blit_credits(credits, blocks['credits'])
    bclib.write_png(scr_dir / 'ending-credits.png', screen_rgb(credits, pals['crypt']))

    # --- the ten composed scenes, exactly as bcdfu draws them ---------------
    for i, name in enumerate(V.PANEL_NAMES):
        buf = blank_screen()
        put_planes(buf, blocks['frame'])
        blit_panel(buf, blocks[name])
        draw_text(buf, font, script[i])
        bclib.write_png(scr_dir / f'ending-scene{i + 1:02d}.png',
                        screen_rgb(buf, pals[V.PANEL_PALETTE[i]]))
    print(f'  screens/ending-*: {5 + len(V.PANEL_NAMES)} screens')

    # --- panel atlas --------------------------------------------------------
    sprites = []
    for i, name in enumerate(V.PANEL_NAMES):
        idx = bclib.decode_planar(blocks[name], V.PANEL_WIDTH, V.PANEL_HEIGHT,
                                  V.PANEL_PLANES)
        ehb = bclib.ehb_palette(pals[V.PANEL_PALETTE[i]])
        sprites.append((name, bclib.to_rgba(idx, ehb)))
    sheet, frames = bclib.pack_atlas(sprites, max_width=V.PANEL_WIDTH * 5)
    bclib.write_atlas('ending-panels', sheet, frames)
    print(f'  sprites/ending-panels: {len(frames)} panels '
          f'({sheet.shape[1]}x{sheet.shape[0]} atlas)')

    # --- font atlas ---------------------------------------------------------
    ehb = bclib.ehb_palette(pals['panel_a'])
    glyphs = []
    for i in range(V.FONT_GLYPHS):
        code = V.FONT_FIRST_CHAR + i
        idx = bclib.decode_planar(V.font_glyph(font, code),
                                  V.FONT_WIDTH, V.FONT_HEIGHT, V.FONT_PLANES)
        glyphs.append((f'chr{code:02X}',
                       bclib.to_rgba(idx, ehb, mask=(idx != 0))))
    sheet, frames = bclib.pack_atlas(glyphs, max_width=V.FONT_WIDTH * 16)
    bclib.write_atlas('ending-font', sheet, frames)
    print(f'  sprites/ending-font: {len(frames)} glyphs '
          f'(ASCII {V.FONT_FIRST_CHAR:#04x}..'
          f'{V.FONT_FIRST_CHAR + V.FONT_GLYPHS - 1:#04x})')

    # --- narration script ---------------------------------------------------
    bclib.write_json(bclib.asset_dir('data') / 'ending-script.json', {
        'textPanel': dict(zip(('x', 'y', 'w', 'h'), V.TEXT_PANEL)),
        'panels': [
            {
                'panel': name,
                'palette': f'ending-{V.PANEL_PALETTE[i].replace("_", "-")}',
                'lines': [{'column': c, 'row': r, 'text': t} for c, r, t in script[i]],
            }
            for i, name in enumerate(V.PANEL_NAMES)
        ],
    }, pretty=True)
    print(f'  data/ending-script: {sum(len(b) for b in script)} lines')


if __name__ == '__main__':
    main()
