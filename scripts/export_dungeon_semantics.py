#!/usr/bin/env python3
"""Generate `public/assets/blackcrypt/amiga/dungeon/semantics.json`.

Binds Black Crypt's `wallFlags` bit values (as exported by
`export_dungeon_levels.py`'s `wallStorage: {kind:'bitflags', bits:[1,2,4,8]}`)
to movement/sight behaviour. `confidence: 'confirmed'` because these bits are
independently cross-checked by two separate systems already in this repo:
the party movement state machine (`docs/blackcrypt/amiga/data-structure.md`,
"Party Movement / Facing State Machine", `S_1 +0x1702A` and neighbours) and
`scripts/automap_tiles.py`'s wall-tile rendering (`reveal_around`, S_1
`+0x0382A`) -- both read the exact same 4 bits this file describes, and
agree.

`buildViewList` and `canStep` (in `@seer/dungeon`) don't yet *consume*
`walls`/`features` for Black Crypt's plain wall geometry -- both accept
`semantics` per the walker plan's documented signature but only need the
`wallAt()` boolean itself (see their own doc comments). This file exists so
the debug harness has something real to show in its confidence banner, and
so a future milestone (secret/illusionary walls, `automap_tiles.py`'s tile
21) has a place to add a `discoveredPieceKind` override without a schema
change.

Usage:
    python3 scripts/export_dungeon_semantics.py
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bclib import paths

DOC = 'docs/blackcrypt/amiga/data-structure.md'


def main():
    doc = {
        'schemaVersion': 1,
        'confidence': 'confirmed',
        'source': f'{DOC}#bcdfs--mapdungeon-format (wallFlags bits), '
                  'cross-checked against scripts/automap_tiles.py (reveal_around)',
        'walls': {
            '1': {'label': 'north wall', 'blocksMovement': True, 'blocksSight': True, 'pieceKind': 'wall'},
            '2': {'label': 'east wall', 'blocksMovement': True, 'blocksSight': True, 'pieceKind': 'wall'},
            '4': {'label': 'south wall', 'blocksMovement': True, 'blocksSight': True, 'pieceKind': 'wall'},
            '8': {'label': 'west wall', 'blocksMovement': True, 'blocksSight': True, 'pieceKind': 'wall'},
        },
        # Populated as prop placement/interaction (walker plan M5) lands --
        # the 16-entry automap type dispatch (automap_tiles.py's TILE_NAMES)
        # is the eventual source for these, not re-derived here.
        'features': {},
    }

    out_path = paths.asset_root('blackcrypt', 'amiga') / 'dungeon' / 'semantics.json'
    paths.write_json(out_path, doc, pretty=True)
    print(f'  dungeon/semantics.json: confidence={doc["confidence"]!r}, '
          f'{len(doc["walls"])} wall meanings, {len(doc["features"])} feature meanings')


if __name__ == '__main__':
    main()
