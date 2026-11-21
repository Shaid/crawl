/**
 * Dungeon Master / Chaos Strikes Back (Amiga) walker asset exporter.
 *
 * Emits `public/assets/<game>/amiga/data/`:
 *  - `walker-gfx.json`  -- the Graphics.DAT items the viewport compositor draws
 *    (palette-index bytes, base64) + the item-696 zone layout (raw, base64) + palettes.
 *  - `walker-maps.json` -- every map normalised to per-cell faces
 *    (`deriveFaces`), raw squares, door info.
 *
 * Usage: `npx tsx tools/dungeonmaster/amiga/export-walker.ts [dm|csb]`
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetDir, writeJson } from '../../shared/asset-paths.ts';
import { parseDataFileHeader, readItem } from '../../shared/dungeonmaster-container.ts';
import { decodeImg1, ensureDungeonDecompressed } from '../../shared/dungeonmaster-codec.ts';
import { findDungeonDataOffsets, parseDungeon, resolveDoors } from '../../shared/dungeonmaster-dungeon.ts';
import { deriveFaces, type DmMapData } from './model.ts';
import { parseLayout, type DmGfx, type Bitmap } from './viewport.ts';
import { a5Word, parseFtl } from './ftl.ts';

/**
 * Items the compositor draws (viewport.ts): ceiling-pit and pit items 50..69
 * (K+0x15A0C .. K+0x166CE push them as literals), floor/ceiling 78/79
 * (K+0x1277E, `78 + 2*set`), wall set 0 = 86..107 (K+0x12862, `86 + 40*set`),
 * stairs 108..125 (K+0x12AF8) and door sets 0..3 = 246..257 (K+0x12D3A).
 * The far-side pit item 49 (D3L2/D3R2, K+0x152B4) is not shipped, so those
 * two squares draw no pit (kept as shipped; see TODO `dm1-walker-ornaments`).
 */
export const WALKER_ITEMS: number[] = [
  ...range(50, 69),
  78, 79,
  ...range(86, 107),
  ...range(108, 125),
  ...range(246, 257),
];

function range(a: number, b: number): number[] {
  const r: number[] = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}

/**
 * The six dungeon-view palettes (light levels 0..5, 16 x 12-bit RGB each),
 * read from the game's own `KAOS.FTL` initialised-data block: DM at
 * `A5-0x36BA`, selected by `light * 32` at K+0x13466; CSB at `A5-0x3A5C`,
 * selected the same way at K+0x1599A (CSB code). Decoded with `ftl.ts`.
 */
export function kaosDungeonPalettes(kaos: Uint8Array, a5Offset: number): number[][] {
  const m = parseFtl(kaos);
  if (m.codeSum !== m.header.words[4]) throw new Error('KAOS.FTL: code checksum mismatch');
  return Array.from({ length: 6 }, (_, l) => Array.from({ length: 16 }, (_, i) => a5Word(m, a5Offset - 32 * l - 2 * i)));
}

/**
 * How many of the 16 light-level-0 words the packed `KAOS.FTL` file holds
 * verbatim at file `offset` (the data block stores this run unpacked), as an
 * independent check on the decoded table.
 */
export function kaosPalette0Matches(kaos: Uint8Array, offset: number, a5Offset = 0x36ba): number {
  const p0 = kaosDungeonPalettes(kaos, a5Offset)[0]!;
  let n = 0;
  for (let i = 0; i < 16; i++) {
    const w = (kaos[offset + 2 * i]! << 8) | kaos[offset + 2 * i + 1]!;
    if (w === p0[i]) n++;
  }
  return n;
}

interface DungeonSrc {
  file: string;
  base: number;
  group: number;
  embedded?: boolean;
}
const GAMES: Record<string, { id: string; dir: string; gfx: string; dungeons: DungeonSrc[]; kaos: string; kaosOff: number; palettesA5: number }> = {
  dm: { id: 'dungeonmaster', dir: 'data/dungeonmaster/amiga', gfx: 'Graphics.DAT', dungeons: [{ file: 'Dungeon.DAT', base: 0, group: 0 }], kaos: 'KAOS.FTL', kaosOff: 0xfbc, palettesA5: 0x36ba },
  // CSB: the main 11-map dungeon exists only inside the disk2 saved game; the 2-map Prison is disk1/Dungeon.DAT.
  csb: {
    id: 'chaosstrikesback',
    dir: 'data/chaosstrikesback/amiga',
    gfx: 'disk1/Graphics.DAT',
    dungeons: [{ file: 'disk2/MINI.DAT', base: 0, group: 0, embedded: true }, { file: 'disk1/Dungeon.DAT', base: 100, group: 1 }],
    kaos: 'disk1/KAOS.FTL',
    kaosOff: 0x100a,
    palettesA5: 0x3a5c,
  },
};

function b64(u: Uint8Array): string {
  return Buffer.from(u).toString('base64');
}

export function buildMaps(dungeonBytes: Uint8Array, base = 0, group = 0, embedded = false): { maps: DmMapData[]; start: { mapIndex: number; x: number; y: number; facing: number } } {
  let d = ensureDungeonDecompressed(dungeonBytes);
  if (embedded) {
    // not a standalone dungeon file (CSB MINI.DAT saved game): locate the embedded Dungeon Data
    const hits = findDungeonDataOffsets(d);
    if (hits.length !== 1) throw new Error(`expected exactly one embedded dungeon, got ${hits.length}`);
    d = d.subarray(hits[0]!);
  }
  const parsed = parseDungeon(d);
  const sp = parsed.header.startPosition;
  const doors = resolveDoors(d, parsed);
  const maps = parsed.maps.map((m, i) => {
    const { width, height } = m.def;
    const raw: number[] = new Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * width + x] = m.squares[y]![x]!.raw;
    const dm: Record<string, { type: number; vertical: boolean }> = {};
    for (const [cell, info] of doors[i]!) dm[String(cell)] = { type: info.type, vertical: info.vertical };
    return {
      index: base + i,
      group,
      level: m.def.level,
      width,
      height,
      offsetX: m.def.offsetX,
      offsetY: m.def.offsetY,
      doorSets: [m.def.doorType0Index, m.def.doorType1Index] as [number, number],
      raw,
      doors: dm,
      faces: deriveFaces(width, height, raw),
    };
  });
  return { maps, start: { mapIndex: base, x: sp.x, y: sp.y, facing: sp.direction } };
}

export function exportWalker(key: 'dm' | 'csb', outRoot?: string): void {
  const g = GAMES[key];
  const gfxPath = resolve(g.dir, g.gfx);
  if (!existsSync(gfxPath)) throw new Error(`missing ${gfxPath}`);
  const data = new Uint8Array(readFileSync(gfxPath));
  const df = parseDataFileHeader(data);
  const items: Record<string, { w: number; h: number; px: string }> = {};
  for (const n of WALKER_ITEMS) {
    const it = df.items[n];
    if (!it) throw new Error(`item ${n} missing`);
    const img = decodeImg1(readItem(data, it));
    items[String(n)] = { w: img.width, h: img.height, px: b64(Uint8Array.from(img.pixels as ArrayLike<number>, (v) => (v < 0 ? 10 : v))) };
  }
  const layoutRaw = readItem(data, df.items[696]!);
  parseLayout(layoutRaw); // throws unless it tiles item 696 exactly
  const kaos = new Uint8Array(readFileSync(resolve(g.dir, g.kaos)));
  const palettes = kaosDungeonPalettes(kaos, g.palettesA5);
  const match0 = kaosPalette0Matches(kaos, g.kaosOff, g.palettesA5);
  console.log(`${g.id}: palette-0 words reproduced by ${g.kaos}+0x${g.kaosOff.toString(16)}: ${match0}/16`);

  const dir = outRoot ?? assetDir('data', g.id, 'amiga');
  writeJson(resolve(dir, 'walker-gfx.json'), {
    source: g.gfx,
    items,
    layout696: b64(layoutRaw),
    palettes,
    palette0KaosMatch: match0,
  }, false);
  const built = g.dungeons.map((src) => buildMaps(new Uint8Array(readFileSync(resolve(g.dir, src.file))), src.base, src.group, src.embedded));
  const maps = built.flatMap((b) => b.maps);
  // default start: the game's first dungeon-file (CSB: the Prison, as in the retail disk1 boot)
  const start = built[built.length - 1]!.start;
  writeJson(resolve(dir, 'walker-maps.json'), { source: g.dungeons.map((x) => x.file), start, maps }, false);
  console.log(`${g.id}: ${Object.keys(items).length} items, ${maps.length} maps -> ${dir}`);
}

if (process.argv[1]?.endsWith('export-walker.ts')) {
  const which = (process.argv[2] ?? 'dm') as 'dm' | 'csb';
  exportWalker(which);
}

/** Build the compositor's graphics bundle straight from a Graphics.DAT (tests / headless renders). */
export function gfxFromDat(path: string): DmGfx {
  const data = new Uint8Array(readFileSync(path));
  const df = parseDataFileHeader(data);
  const items: Record<number, Bitmap> = {};
  for (const n of WALKER_ITEMS) {
    const img = decodeImg1(readItem(data, df.items[n]!));
    items[n] = { w: img.width, h: img.height, px: Uint8Array.from(img.pixels as ArrayLike<number>, (v) => (v < 0 ? 10 : v)) };
  }
  return { items, layout: parseLayout(readItem(data, df.items[696]!)) };
}
