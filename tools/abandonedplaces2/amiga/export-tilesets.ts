/**
 * Abandoned Places 2 (Amiga): decode every `.bpl` + `.def` (+ `.ofs`) image triplet into
 * shelf-packed PNG atlases under public/assets/abandonedplaces2/amiga/.
 *   npx tsx tools/abandonedplaces2/amiga/export-tilesets.ts
 * Unpacks the ArtGame volumes into build/cache/abandonedplaces2/ first (tools/shared/artgame-kernel.ts).
 * Spec: docs/abandonedplaces2/amiga/data-structure.md §5.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePNG } from '@seer-project/pipeline';
import { shelfPack } from '@seer-project/core';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex, type ManifestEntry } from '../../shared/asset-paths.ts';
import { checkGeometry, decodeRecord, imageToRGBA, parseDef, readClr } from '../../shared/artgame-tileset.ts';
import { unpackAll } from '../../abandonedplaces/unpack.ts';
import type { RGB } from '../../shared/amiga-planar.ts';

const GAME = 'abandonedplaces2';
const PLATFORM = 'amiga';

const FAMILY_LABEL: Record<string, string> = {
  wl: 'walls', onwl: 'on-wall decorations', fl: 'floor+ceiling', strd: 'stairs down', stru: 'stairs up',
  gt: 'gates/doors', pit: 'pits', swg: 'switch-g', swp: 'switch-p', sww: 'switch-w', obj: 'objects', mon: 'monsters',
};

export interface PaletteChoice { name: string; rgb: RGB[]; basis: string }

function readPal(cache: string, name: string): RGB[] | null {
  const p = resolve(cache, `${name}.clr`);
  return existsSync(p) ? readClr(new Uint8Array(readFileSync(p))) : null;
}

/**
 * Palette for a triplet. Dungeon-set families take `set_NN.clr` (indices 0–15); 5-plane images
 * additionally index 16–31, which the set palettes leave (almost) black, so those take the
 * shared UI half of `display.clr`. The second half is a hypothesis (see spec §5).
 */
export function choosePalette(cache: string, base: string, planes: number): PaletteChoice {
  const m = /^([a-z]+)_(\d\d)$/.exec(base);
  const display = readPal(cache, 'display') ?? [];
  let low: RGB[] | null = null;
  let basis = 'set';
  let name = 'set_00';
  if (m) {
    const nn = Number(m[2]);
    const direct = readPal(cache, `set_${m[2]}`);
    if (direct && ['wl', 'onwl', 'fl', 'strd', 'stru', 'gt', 'pit', 'swg', 'swp', 'sww'].includes(m[1])) { low = direct; name = `set_${m[2]}`; }
    else if (direct && nn < 8) { low = direct; name = `set_${m[2]}`; basis = 'set-number-matches-index'; }
  }
  if (!low) { low = readPal(cache, 'set_00')!; basis = 'fallback-set_00-unconfirmed'; name = 'set_00'; }
  const rgb = low.slice(0, 16);
  if (planes > 4) {
    const hi = base === 'items' || !m ? display : display; // shared UI palette half
    for (let i = 16; i < 32; i++) rgb[i] = hi[i] ?? { r: 0, g: 0, b: 0 };
    basis += '+display.clr[16..31]';
  }
  return { name, rgb, basis };
}

function exportTriplet(cache: string, base: string, outSprites: string, outData: string): ManifestEntry | null {
  const defP = resolve(cache, `${base}.def`), bplP = resolve(cache, `${base}.bpl`), ofsP = resolve(cache, `${base}.ofs`);
  if (!existsSync(defP) || !existsSync(bplP)) return null;
  const bpl = new Uint8Array(readFileSync(bplP));
  const ofs = existsSync(ofsP) ? new Uint8Array(readFileSync(ofsP)) : null;
  const recs = parseDef(new Uint8Array(readFileSync(defP)), ofs, bpl.length);
  const live = recs.filter((r) => !r.empty && r.offset + r.planeSize * (r.planes + (r.hasMask ? 1 : 0)) <= bpl.length);
  if (!live.length) return null;
  const planes = Math.max(...live.map((r) => r.planes));
  const pal = choosePalette(cache, base, planes);
  const packed = shelfPack(live.map((r) => ({ name: `${base}.${r.index}`, width: r.w, height: r.h })), 1024);
  const atlas = new Uint8Array(packed.width * packed.height * 4);
  const frames = [];
  for (const slot of packed.frames) {
    const idx = Number(slot.name.split('.').pop());
    const r = recs[idx];
    const rgba = imageToRGBA(decodeRecord(bpl, r), pal.rgb);
    for (let y = 0; y < r.h; y++) atlas.set(rgba.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((slot.y + y) * packed.width + slot.x) * 4);
    frames.push({
      name: slot.name, index: idx, x: slot.x, y: slot.y, w: r.w, h: r.h,
      slotX: r.x, slotY: r.y, slotW: r.frameW, slotH: r.frameH, planes: r.planes, masked: r.hasMask,
    });
  }
  void writePNG(resolve(outSprites, `${base}.png`), atlas, packed.width, packed.height);
  writeJson(resolve(outSprites, `${base}.json`), {
    source: `${base}.bpl/.def${ofs ? '/.ofs' : ''}`, palette: pal.name, paletteBasis: pal.basis, frames,
    width: packed.width, height: packed.height,
  });
  void outData;
  return manifestEntry(`sprites/${base}`, frames.length, true);
}

export function exportTilesets(): { atlases: number; frames: number; geometry: { checked: number; ok: number } } {
  const { dir: cache } = unpackAll(GAME);
  const sprites = assetDir('sprites', GAME, PLATFORM);
  const data = assetDir('data', GAME, PLATFORM);
  mkdirSync(sprites, { recursive: true });
  const bases = readdirSync(cache).filter((f) => f.endsWith('.def')).map((f) => f.slice(0, -4)).sort();
  const entries: ManifestEntry[] = [];
  let frames = 0, checked = 0, ok = 0;
  const geo: Record<string, { checked: number; ok: number; failures: string[] }> = {};
  for (const base of bases) {
    const bplP = resolve(cache, `${base}.bpl`);
    if (!existsSync(bplP)) continue;
    const ofsP = resolve(cache, `${base}.ofs`);
    const bplSize = readFileSync(bplP).length;
    const recs = parseDef(new Uint8Array(readFileSync(resolve(cache, `${base}.def`))), existsSync(ofsP) ? new Uint8Array(readFileSync(ofsP)) : null, bplSize);
    const rep = checkGeometry(recs, null, bplSize);
    geo[base] = { checked: rep.nonEmpty, ok: rep.ok, failures: rep.failures };
    checked += rep.nonEmpty; ok += rep.ok;
    const e = exportTriplet(cache, base, sprites, data);
    if (e) { entries.push(e); frames += e.sprites; }
  }
  writeJson(resolve(data, 'tileset-geometry.json'), { checked, ok, perTriplet: geo });
  writeJson(resolve(data, 'tileset-families.json'), FAMILY_LABEL);
  writeManifest(entries, GAME, PLATFORM);
  writePlatformIndex([{ game: GAME, platform: PLATFORM }]);
  return { atlases: entries.length, frames, geometry: { checked, ok } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = exportTilesets();
  console.log(`${GAME}/${PLATFORM}: ${r.atlases} atlases, ${r.frames} frames; geometry ${r.geometry.ok}/${r.geometry.checked}`);
}
