"""Where extracted assets go.

One place that knows the output layout, so scripts never hard-code paths:

    public/assets/<game>/<platform>/
      manifest.json                  index of every asset group
      palettes/<name>.json
      sprites/<name>.{png,json}      atlas + frame sidecar
      screens/<name>.png
      textures/<name>.{png,json}
      audio/<name>.*
      data/<name>.json

`public/assets` is gitignored build output — regenerate it, don't commit it.

Intermediates that the browser never loads (decompressed streams, .bin blobs)
belong in `build/cache/<game>/` instead.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from .atlas import frames_to_json

ROOT = Path(__file__).resolve().parents[2]

CATEGORIES = ('palettes', 'sprites', 'screens', 'textures', 'audio', 'data')


def asset_root(game='blackcrypt', platform='amiga'):
    return ROOT / 'public' / 'assets' / game / platform


def asset_dir(category, game='blackcrypt', platform='amiga'):
    """Directory for one asset category, created on demand."""
    if category not in CATEGORIES:
        raise ValueError(f'unknown asset category {category!r}; expected one of {CATEGORIES}')
    d = asset_root(game, platform) / category
    d.mkdir(parents=True, exist_ok=True)
    return d


def cache_dir(game='blackcrypt'):
    """Gitignored scratch space for decompressed streams and other blobs."""
    d = ROOT / 'build' / 'cache' / game
    d.mkdir(parents=True, exist_ok=True)
    return d


def data_dir(game='blackcrypt', platform='amiga'):
    """Original game files (read-only input)."""
    return ROOT / 'data' / game / platform


def write_json(path, obj, pretty=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2 if pretty else None))


def write_png(path, rgba):
    """Write an (h, w, 4) uint8 array as a PNG."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = np.ascontiguousarray(rgba, dtype=np.uint8)
    Image.fromarray(arr, 'RGBA').save(path)
    return path


def manifest_entry(name, sprites, has_palette=False):
    return {
        'name': name,
        'sprites': int(sprites),
        'hasPalette': bool(has_palette),
        'png': f'{name}.png',
    }


def write_manifest(entries, game='blackcrypt', platform='amiga'):
    """Merge `entries` into manifest.json, upserting by name.

    A merge rather than an overwrite because the TypeScript pipeline and several
    Python scripts each contribute entries, and they run in no fixed order.
    """
    root = asset_root(game, platform)
    root.mkdir(parents=True, exist_ok=True)
    path = root / 'manifest.json'

    existing = {}
    if path.exists():
        try:
            for e in json.loads(path.read_text()):
                existing[e['name']] = e
        except (json.JSONDecodeError, KeyError, TypeError):
            existing = {}

    for e in entries:
        existing[e['name']] = e

    merged = sorted(existing.values(), key=lambda e: e['name'])
    path.write_text(json.dumps(merged, indent=2))
    return merged


def write_atlas(name, sheet, frames, category='sprites',
                game='blackcrypt', platform='amiga', has_palette=False,
                register=True):
    """Write an atlas PNG + frame sidecar and register it in the manifest.

    `name` may contain a subpath ('monsters'); the manifest key becomes
    '<category>/<name>', which is what the viewer concatenates into its URLs.

    Sprites here are already resolved to RGBA — the source palette lives
    separately under `palettes/`. `has_palette` only controls whether the
    viewer additionally fetches `<name>.pal.json`; leave it False unless the
    caller writes that sidecar too.
    """
    out_dir = asset_dir(category, game, platform)
    png_path = out_dir / f'{name}.png'
    write_png(png_path, sheet)
    write_json(out_dir / f'{name}.json',
               frames_to_json(frames, sheet.shape[1], sheet.shape[0]), pretty=True)

    entry = manifest_entry(f'{category}/{name}', len(frames), has_palette)
    if register:
        write_manifest([entry], game, platform)
    return entry


def write_platform_index(platforms):
    """Write public/assets/index.json so a viewer can offer a platform switcher.

    `platforms` is a list of (game, platform) pairs.
    """
    out = ROOT / 'public' / 'assets'
    out.mkdir(parents=True, exist_ok=True)
    seen = {}
    idx = out / 'index.json'
    if idx.exists():
        try:
            for e in json.loads(idx.read_text()):
                seen[(e['game'], e['platform'])] = e
        except (json.JSONDecodeError, KeyError, TypeError):
            seen = {}
    for game, platform in platforms:
        seen[(game, platform)] = {
            'game': game,
            'platform': platform,
            'manifest': f'/assets/{game}/{platform}/manifest.json',
        }
    merged = sorted(seen.values(), key=lambda e: (e['game'], e['platform']))
    idx.write_text(json.dumps(merged, indent=2))
    return merged
