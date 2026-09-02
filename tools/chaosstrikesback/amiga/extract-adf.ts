/**
 * One-time extraction of Chaos Strikes Back's 3 Amiga ADF disk images into
 * a flat `data/chaosstrikesback/amiga/` tree (mirroring the layout every
 * other title in this repo's `data/<game>/<platform>/` convention).
 *
 * `data/_unexplored_/ChaosStrikesBack/disk.1|disk.2|Disk.3` are confirmed
 * (`docs/_unexplored_/probe-recon.md`) real 901,120-byte AmigaDOS `DOS\0`
 * OFS filesystems — mountable, not trackloader blobs. Uses this repo's
 * shared `@seer-project/amiga` `adf.ts` reader (read-only OFS/FFS walker),
 * not a hand-rolled parser.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { listAdf, readAdfFile, adfBootblockType } from '@seer-project/amiga';

const root = resolve(import.meta.dirname, '../../..');

const disks = [
  ['data/_unexplored_/ChaosStrikesBack/disk.1', 'disk1'],
  ['data/_unexplored_/ChaosStrikesBack/disk.2', 'disk2'],
  ['data/_unexplored_/ChaosStrikesBack/Disk.3', 'disk3'],
] as const;

const outRoot = join(root, 'data/chaosstrikesback/amiga');

let totalFiles = 0;
for (const [relPath, label] of disks) {
  const path = join(root, relPath);
  const data = new Uint8Array(readFileSync(path));
  const boot = adfBootblockType(data);
  console.log(`\n== ${label} (${relPath}) == boot=${boot} size=${data.length}`);
  const entries = listAdf(data);
  if (!entries) {
    console.log('  NOT a walkable AmigaDOS filesystem');
    continue;
  }
  for (const e of entries) {
    console.log(`  ${e.type === 'dir' ? '[D]' : '   '} ${label}/${e.path}  ${e.size}`);
    if (e.type === 'file') {
      const bytes = readAdfFile(data, e);
      const outPath = join(outRoot, label, e.path);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, bytes);
      totalFiles++;
    }
  }
}
console.log(`\nExtracted ${totalFiles} files to ${outRoot}`);
