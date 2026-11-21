/**
 * Unpack every ArtGame directory entry of Abandoned Places 1 or 2 into
 * build/cache/<game>/ (flat, by name; names are unique per game except AP1
 * files duplicated across disks, which are written once and compared).
 *   npx tsx tools/abandonedplaces/unpack.ts <abandonedplaces|abandonedplaces2>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadArtVolume, readVolumeEntry, type ArtVolume } from '../shared/artgame-kernel.ts';

export function unpackAll(game: ArtVolume['game']): { files: number; bytes: number; dir: string } {
  const dataDir = resolve('data', game, 'amiga');
  const v = loadArtVolume(game, dataDir);
  const out = resolve('build/cache', game);
  mkdirSync(out, { recursive: true });
  const seen = new Map<string, Uint8Array>();
  let bytes = 0;
  for (const e of v.entries) {
    const data = readVolumeEntry(v, e);
    const prev = seen.get(e.name);
    if (prev) {
      // Same name on several disks: keep the first, require identical content.
      if (Buffer.compare(Buffer.from(prev), Buffer.from(data)) !== 0) {
        writeFileSync(resolve(out, `${e.name}.disk${e.section + 1}`), data);
      }
      continue;
    }
    seen.set(e.name, data);
    writeFileSync(resolve(out, e.name), data);
    bytes += data.length;
  }
  return { files: seen.size, bytes, dir: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const game = (process.argv[2] ?? 'abandonedplaces') as ArtVolume['game'];
  const r = unpackAll(game);
  console.log(`${game}: ${r.files} files, ${r.bytes} bytes -> ${r.dir}`);
}
