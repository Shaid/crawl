#!/usr/bin/env python3
"""Render the confirmed Black Crypt Amiga assets into public/assets.

Covers the asset groups only this script knows how to build:

  textures/dungeon-*       bcdfx/bcdfy/bcdfz dungeon tilesets, one frame per
                           named sub-image (walls, ceiling, floor, alcoves,
                           plaques, pillars, doors, stairs, buttons, ...) —
                           see bclib.bcdfxyz.SUB_IMAGES. Requires the
                           decompressed bcdft (tools/bcdft_decompress) since
                           the chunk directory that splits bcdfx/y/z lives
                           inside it, not in the tileset files themselves.
  screens/*                bcdfr, 4 full-screen images at per-screen bpp
  sprites/ui               bcdfo elements from the bcdfp LAB_010D descriptors
  sprites/bcspeed          bcdfa BCSPEED.GFK, 16x16 @ mask + 6bpp EHB

Deliberately *not* handled here:
  portraits  — built by the TypeScript pipeline from bcdfo (tools/shared/game-config.ts)
  monsters   — built by scripts/extract_monsters.py
  bcdfa tiles— the 64x24 tile premise is wrong; bcdfa is the BCSPEED container
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bclib

AMIGA = bclib.data_dir('blackcrypt', 'amiga')


def main():
    if not AMIGA.exists():
        print(f'No Amiga data at {AMIGA} — nothing to do')
        return

    bcdfq = (AMIGA / 'bcdfq').read_bytes()
    pal_raven = bclib.read_named_palette(bcdfq, 'raven')
    pal_title = bclib.read_named_palette(bcdfq, 'title')
    pal_game = bclib.read_named_palette(bcdfq, 'game')
    ehb_game = bclib.ehb_palette(pal_game)
    ehb_title = bclib.ehb_palette(pal_title)

    # Palettes are assets in their own right — the browser needs them to remap.
    pal_dir = bclib.asset_dir('palettes')
    for pname in bclib.BCDFQ_PALETTES:
        words = bclib.read_named_palette(bcdfq, pname)
        bclib.write_json(pal_dir / f'{pname}.json', {
            'colors': [dict(zip('rgb', bclib.amiga12_to_rgb(w))) for w in words],
        }, pretty=True)
    print(f'  palettes: {", ".join(bclib.BCDFQ_PALETTES)}')

    entries = []

    # ── Dungeon tilesets (bcdfx / bcdfy / bcdfz) ────────────────────────
    # The directory that splits each file into chunks lives in the
    # *executable* (decompressed bcdft S_1), not in the tileset files
    # themselves — bclib.bcdfxyz reads it and each chunk's own sub-images
    # (walls, ceiling, floor, alcoves, plaques, pillars, doors, stairs,
    # buttons, ...) from the game's own blit-descriptor geometry. This
    # replaced an earlier `find_payload_by_size` approach that searched
    # RLE-stream *decompressed sizes* for a match — it worked for the
    # compressed chunks but was blind to raw-stored ones (bcdfz's pillar
    # chunk is stored uncompressed and doesn't appear at all under an RLE
    # scan; see data-structure.md's "bcdfz P6" correction) and produced
    # geometry that pre-dated several corrections. See
    # docs/blackcrypt/amiga/data-structure.md, "bcdfx / bcdfy / bcdfz".
    #
    # The dungeon accent ramp (COLOR26-31) is chosen per *level* — but so is the
    # tileset file, by the same level-entry routine (bcdft S_1+0x1A5CC), so each
    # tileset does have a well-defined ramp: bcdfx serves levels 1-4 (ramp 0,
    # tan sandstone) and 12-13 (ramp 3, grey); bcdfy serves level 5 only
    # (ramp 1, violet); bcdfz serves levels 6-11 (ramp 2, bone/cream). Only
    # bcdfx is ambiguous, and only between ramps 0 and 3. Fall back to the
    # shipped palette buffer (whose tail is ramp 0) when the bcdft
    # decompression hasn't been run. See data-structure.md, "Dungeon tileset
    # selection".
    cache = bclib.cache_dir('blackcrypt')
    bcdft_s1 = cache / 'bcdft_decompressed.bin'
    bcdft_s2 = cache / 'bcdft_s2_data.bin'
    bcdfu_path = AMIGA / 'bcdfu'
    ehb_dungeon = ehb_game
    if bcdft_s1.exists():
        ehb_dungeon = bclib.ehb_palette(bclib.read_palette_words(
            bcdft_s1.read_bytes(), bclib.BCDFT_DUNGEON_PALETTE, 32))
    elif bcdfu_path.exists():
        ehb_dungeon = bclib.ehb_palette(
            bclib.read_dungeon_palette(bcdfu_path.read_bytes()))

    tileset_palettes = {}
    if bcdft_s1.exists() and bcdft_s2.exists():
        s1_bytes, s2_bytes = bcdft_s1.read_bytes(), bcdft_s2.read_bytes()
        ramps = bclib.tileset_ramps(s1_bytes, s2_bytes)
        for name in bclib.TILESET_FILES:
            tileset_palettes[name] = bclib.ehb_palette(
                bclib.read_dungeon_palette_for_tileset(s1_bytes, s2_bytes, name))
            print(f'  {name}: accent ramp(s) {ramps[name]}'
                  + ('  (rendering with %d)' % ramps[name][0]
                     if len(ramps[name]) > 1 else ''))

        for src in bclib.TILESET_FILES:
            src_path = AMIGA / src
            if not src_path.exists():
                continue
            ehb_tileset = tileset_palettes.get(src, ehb_dungeon)
            raw = src_path.read_bytes()
            chunks = bclib.read_chunks(s1_bytes, raw, src, bclib.rle_decompress)
            sprites = []
            for name, w, h, planes, blob in bclib.iter_sub_images(chunks):
                if planes == 7:
                    idx, mask = bclib.decode_masked(blob, w, h, 6)
                else:
                    idx, mask = bclib.decode_planar(blob, w, h, 6), None
                if idx is None:
                    print(f'  WARN {src} {name}: short data')
                    continue
                sprites.append((name, bclib.to_rgba(idx, ehb_tileset, mask=mask)))
            if not sprites:
                continue
            sheet, frames = bclib.pack_atlas(sprites, max_width=512)
            entries.append(bclib.write_atlas(f'dungeon-{src}', sheet, frames,
                                             category='textures', register=False))
            print(f'  textures/dungeon-{src}: {len(frames)} sub-images')
    else:
        print('  dungeon textures: skipped (no decompressed bcdft; run '
              '`cd tools/bcdft_decompress && bash build.sh run` first — the '
              'chunk directory that splits bcdfx/y/z lives inside it)')

    # ── bcdfr full-screen images ──────────────────────────────────────
    bcdfr_path = AMIGA / 'bcdfr'
    if bcdfr_path.exists():
        bcdfr = bcdfr_path.read_bytes()
        screens = [
            ('raven', bcdfr[:32000], 320, 200, 4, bclib.ehb_palette(pal_raven)),
            ('title', bcdfr[32000:80000], 320, 200, 6, ehb_title),
            ('logo', bcdfr[80000:90560], 320, 44, 6, ehb_title),
            ('plot', bcdfr[90560:], 320, 200, 6, ehb_game),
        ]
        screen_dir = bclib.asset_dir('screens')
        for name, data, w, h, planes, pal in screens:
            idx = bclib.decode_planar(data, w, h, planes)
            if idx is None:
                print(f'  WARN screen {name}: short data')
                continue
            bclib.write_png(screen_dir / f'{name}.png', bclib.to_rgba(idx, pal))
        print(f'  screens: {", ".join(n for n, *_ in screens)}')

    # ── bcdfo UI elements (offsets from bcdfp LAB_010D descriptors) ───
    # `mask_off`: 6 of the 23 elements (chargen_ui, stats_panel, and all 4
    # guild banners) are 7-plane masked sprites whose 1-bit mask plane lives
    # *outside* the descriptor's own 6-plane colour span,
    # in what earlier passes mis-catalogued as "unaccounted gaps" (see
    # data-structure.md's bcdfo "Unaccounted gaps" section). chargen_ui and
    # stats_panel each have their own mask appended right after their colour
    # data; the 4 guild banners share ONE mask, stored once before the group
    # (same rectangular shape, no per-banner different mask needed).
    # Confirmed by rendering: clean cutouts, no noise, matching legible art
    # ("FIGHTER GUILD", "CHARACTER GENERATION", a bordered portrait grid).
    bcdfo_path = AMIGA / 'bcdfo'
    if bcdfo_path.exists():
        bcdfo = bcdfo_path.read_bytes()
        GUILD_MASK_OFF = 0xB4F8  # shared by all 4 guild banners, 352 B
        ui_elements = [
            ('chargen_ui',    0x5160, 128, 105, 0x78C0),
            ('chargen_logo',  0x7F50, 192, 47, None),
            ('stats_panel',   0xD758, 128, 62, 0xEE98),
            ('sigil_0',       0xAE68, 32, 14, None),
            ('sigil_1',       0xAFB8, 32, 14, None),
            ('sigil_2',       0xB108, 32, 14, None),
            ('sigil_3',       0xB258, 32, 14, None),
            ('sigil_4',       0xB3A8, 32, 14, None),
            ('guild_fighter', 0xB658, 128, 22, GUILD_MASK_OFF),
            ('guild_cleric',  0xBE98, 128, 22, GUILD_MASK_OFF),
            ('guild_mage',    0xC6D8, 128, 22, GUILD_MASK_OFF),
            ('guild_druid',   0xCF18, 128, 22, GUILD_MASK_OFF),
        ]
        # 11 numerals, 16x7 each, 84 bytes per glyph.
        numerals = [0xF286, 0xF2DA, 0xF32E, 0xF382, 0xF3D6, 0xF42A,
                    0xF47E, 0xF4D2, 0xF526, 0xF57A, 0xF5CE]
        ui_elements += [(f'numeral_{i}', off, 16, 7, None) for i, off in enumerate(numerals)]

        sprites = []
        for name, off, w, h, mask_off in ui_elements:
            size = (w // 8) * h * 6
            idx = bclib.decode_planar(bcdfo[off:off + size], w, h, 6)
            if idx is None:
                print(f'  WARN ui {name}: short data')
                continue
            if mask_off is not None:
                mask = bclib.decode_planar(bcdfo[mask_off:mask_off + (w // 8) * h], w, h, 1)
                sprites.append((name, bclib.to_rgba(idx, ehb_game, mask=mask)))
            else:
                sprites.append((name, bclib.to_rgba(idx, ehb_game, transparent_index0=True)))
        if sprites:
            sheet, frames = bclib.pack_atlas(sprites)
            entries.append(bclib.write_atlas('ui', sheet, frames, register=False))
            print(f'  sprites/ui: {len(frames)} elements')

    # ── bcdfa BCSPEED.GFK effect animations ───────────────────────────
    # 16x16 @ 7 planes (mask + 6bpp EHB), one 224-byte frame each; see
    # bclib/bcdfa.py for the container layout and the corrected stream start.
    bcdfa_path = AMIGA / 'bcdfa'
    if bcdfa_path.exists():
        bcdfa = bcdfa_path.read_bytes()
        sprites = []
        for n, fi, frame in bclib.gfk_frames(bcdfa):
            idx, mask = bclib.decode_masked(frame, bclib.GFK_WIDTH, bclib.GFK_HEIGHT,
                                            bclib.GFK_COLOR_PLANES)
            if idx is None:
                print(f'  WARN bcspeed {n:02d}/{fi}: short frame')
                continue
            sprites.append((f'gfk{n:02d}_f{fi}',
                            bclib.to_rgba(idx, ehb_game, mask=mask)))
        if sprites:
            sheet, frames = bclib.pack_atlas(sprites, max_width=16 * 12)
            entries.append(bclib.write_atlas('bcspeed', sheet, frames, register=False))
            print(f'  sprites/bcspeed: {len(frames)} frames')

    bclib.write_manifest(entries)
    bclib.write_platform_index([('blackcrypt', 'amiga')])
    print(f'  manifest: +{len(entries)} groups')


if __name__ == '__main__':
    main()
