#!/usr/bin/env python3
"""
Extract all resources from the Black Crypt Windows version's clipper.clp.

Format:
  [2 bytes]  Entry count (uint16 LE)
  [816 × 56 byte entries]
  [Raw data]

Entry (56 bytes):
  +0x00: char[40]  Null-terminated name
  +0x28: uint8     Type (1=marker, 2=image, 3=palette, 4=sound, 5=speedfx)
  +0x2A: uint32    Data size
  +0x2E: uint32    Data offset (from start of file)
  +0x34: uint16    Width (for images)
  +0x36: uint16    Height (for images)

Images: raw 8-bit indexed pixels, no compression.
Palettes: 768 bytes (256 × RGB).
Sounds: raw WAV/IFF data (some have WAV headers, some don't).
"""
import struct, os, sys
from pathlib import Path
from collections import Counter
from PIL import Image

BASE = Path(__file__).parent.parent
DEFAULT_CLP = BASE / 'data' / 'blackcrypt' / 'dosvga' / 'clipper.clp'
DEFAULT_OUT = BASE / 'data' / 'blackcrypt' / 'extracted' / 'clipper'


def parse_clp(path):
    """Parse clipper.clp and return list of entry dicts."""
    with open(path, 'rb') as f:
        data = f.read()
    
    num = struct.unpack_from('<H', data, 0)[0]
    entries = []
    
    for i in range(num):
        off = 2 + i * 56
        name = data[off:off+40].split(b'\x00')[0].decode('ascii', errors='replace')
        typ = data[off+40]
        sz = struct.unpack_from('<I', data, off+42)[0]
        data_off = struct.unpack_from('<I', data, off+46)[0]
        w = struct.unpack_from('<H', data, off+52)[0]
        h = struct.unpack_from('<H', data, off+54)[0]
        
        entries.append({
            'index': i,
            'name': name,
            'type': typ,
            'size': sz,
            'data_offset': data_off,
            'width': w,
            'height': h,
            'data': data[data_off:data_off+sz],
        })
    
    return entries


def extract_all(entries, out_dir):
    """Extract all resources into organized directories."""
    out_dir = Path(out_dir)
    img_dir = out_dir / 'images'
    pal_dir = out_dir / 'palettes'
    snd_dir = out_dir / 'sounds'
    
    img_dir.mkdir(parents=True, exist_ok=True)
    pal_dir.mkdir(parents=True, exist_ok=True)
    snd_dir.mkdir(parents=True, exist_ok=True)
    
    # Load palettes first
    palettes = {}
    for e in entries:
        if e['type'] == 3:
            palettes[e['name']] = e['data']
    
    # Default palette (use first one if needed)
    default_pal = list(palettes.values())[0] if palettes else None
    
    stats = Counter()
    
    for e in entries:
        name = e['name']
        safe_name = name.replace('/', '_').replace('\\', '_').replace(' ', '_')
        if not safe_name:
            safe_name = f'entry_{e["index"]:04d}'
        
        typ = e['type']
        
        if typ == 2:  # Image
            stats['images'] += 1
            img_data = e['data']
            
            # Try each palette to find the best one
            # (Some images use specific palettes)
            pal_data = pick_palette(name, palettes, default_pal)
            
            # Create P-mode (indexed) image with palette
            img_p = Image.frombytes('P', (e['width'], e['height']), bytes(img_data))
            if pal_data and len(pal_data) >= 768:
                img_p.putpalette(pal_data[:768])
            
            # Convert to RGBA
            img = img_p.convert('RGBA')
            
            # Known background colors in clipper.clp images:
            # Brown (95,67,51) = palette ~index 33 (monster/item/UI sprites)
            # Cyan (0,255,255) = sky/wall tile background
            KNOWN_BG = {(95, 67, 51), (0, 255, 255)}
            arr = bytearray(img.tobytes())
            for pi in range(0, len(arr), 4):
                if (arr[pi], arr[pi+1], arr[pi+2]) in KNOWN_BG:
                    arr[pi+3] = 0
            img = Image.frombytes('RGBA', img.size, bytes(arr))
            
            img.save(img_dir / f'{safe_name}.png')
        
        elif typ == 3:  # Palette
            stats['palettes'] += 1
            with open(pal_dir / f'{safe_name}.pal', 'wb') as f:
                f.write(e['data'])
            # Also save as PNG palette swatch
            create_palette_swatch(e['data'], pal_dir / f'{safe_name}.png', name)
        
        elif typ == 4:  # Sound
            stats['sounds'] += 1
            snd_data = e['data']
            fname = safe_name if safe_name else f'sound_{e["index"]:04d}'
            
            # Check for WAV header
            if snd_data[:4] == b'RIFF':
                ext = '.wav'
            elif snd_data[:4] in (b'FORM', b'8SVX', b'AIFF'):
                ext = '.iff'
            else:
                ext = '.raw'
            
            with open(snd_dir / f'{fname}{ext}', 'wb') as f:
                f.write(snd_data)
        
        elif typ == 5:  # Speed effects / unknown
            stats['other'] += 1
        
        elif typ == 1:  # Marker
            pass  # Skip markers
    
    return stats


def pick_palette(name, palettes, default):
    """Pick the most appropriate palette for an image based on its name."""
    name_lower = name.lower()
    
    # Game-specific palette hints from our analysis
    if any(kw in name_lower for kw in ['automap', 'map']):
        return palettes.get('Automap Palette', default)
    if any(kw in name_lower for kw in ['char', 'portrait', 'guild']):
        return palettes.get('Character Gen Palette', default)
    if any(kw in name_lower for kw in ['title', 'logo', 'raven']):
        return palettes.get('Title Palette', default)
    if 'options' in name_lower:
        return palettes.get('Options Palette', default)
    
    return default


def create_palette_swatch(pal_data, out_path, name):
    """Create a PNG preview of a palette."""
    from PIL import ImageDraw, ImageFont
    try:
        n_colors = len(pal_data) // 3
        swatch_w = 16 * 16  # 16x16 grid
        swatch_h = ((n_colors + 15) // 16) * 16 + 20
        
        img = Image.new('RGB', (swatch_w, swatch_h), (64, 64, 64))
        draw = ImageDraw.Draw(img)
        
        for i in range(min(n_colors, 256)):
            x = (i % 16) * 16
            y = (i // 16) * 16 + 20
            r, g, b = pal_data[i*3:i*3+3]
            draw.rectangle([x, y, x+15, y+15], fill=(r, g, b))
        
        draw.text((2, 2), f'{name} ({n_colors} colors)', fill=(255, 255, 255))
        img.save(out_path)
    except Exception:
        pass


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Extract clipper.clp resources')
    parser.add_argument('clp', nargs='?', default=str(DEFAULT_CLP),
                        help='Path to clipper.clp')
    parser.add_argument('out', nargs='?', default=str(DEFAULT_OUT),
                        help='Output directory')
    parser.add_argument('--images-only', action='store_true',
                        help='Only extract images')
    args = parser.parse_args()
    
    print(f"Parsing {args.clp}...")
    entries = parse_clp(args.clp)
    print(f"  {len(entries)} entries found")
    
    print(f"Extracting to {args.out}...")
    stats = extract_all(entries, args.out)
    
    print(f"\nDone:")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == '__main__':
    main()
