/**
 * Oracle check: the TS city wall composer (view-model.ts) against captiveII's
 * own window fill + slot walk + CPU blitters run in the musashi harness
 * (emu/gen.c, vector-object handlers skipped). Compares the 75-byte window and
 * all 6 x 2400 planar bytes per pose.
 *
 *   bash tools/liberation/cd32/emu/build.sh
 *   npx tsx tools/liberation/cd32/verify-view.ts [world zone count]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitCaptive, readEngineTables, readBackdrop } from './engine-tables.ts';
import { parseVgm, fillWindow, composeView, PLANE_BYTES, type CityZone } from './view-model.ts';

const DATA = resolve('data/liberation/cd32/data');
const CACHE = resolve('build/cache/liberation');

export function runGen(world: number, zone: number, views?: string, viewOut?: string): { zone: CityZone; wall: number; cmap: number } {
  mkdirSync(CACHE, { recursive: true });
  const out = resolve(CACHE, `w${world}z${zone}.bin`);
  const env = { ...process.env } as Record<string, string>;
  if (views) { env.LIB_VIEWS = views; env.LIB_VIEWOUT = viewOut!; }
  execFileSync(resolve(CACHE, 'gen'), [DATA, String(world), String(zone), out], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const b = new Uint8Array(readFileSync(out));
  const pb = b.subarray(0x3000, 0x3000 + 1200);
  const s = (pb[32]! << 8) | pb[33]!;
  const t = 0x3000 + 1200;
  return {
    zone: { world, zone, planes: b.slice(0, 0x3000), start: { x: s & 63, y: (s >> 6) & 63, z: s >> 12, facing: pb[35]! & 3 } },
    wall: (b[t]! << 8) | b[t + 1]!,
    cmap: ((b[t + 2]! << 24) | (b[t + 3]! << 16) | (b[t + 4]! << 8) | b[t + 5]!) >>> 0,
  };
}

function main() {
  const world = Number(process.argv[2] ?? 0), zoneN = Number(process.argv[3] ?? 8), count = Number(process.argv[4] ?? 200);
  const img = splitCaptive(new Uint8Array(readFileSync(resolve(DATA, 'captiveII'))));
  const t = readEngineTables(img.code);
  const backdrop = readBackdrop(img);
  const first = runGen(world, zoneN);
  const vgm = parseVgm(new Uint8Array(readFileSync(resolve(DATA, `Wall${String(first.wall).padStart(2, '0')}.VGM`))));
  // deterministic pose sample: every street-ish cell, all facings, z = 1 (and some z = 0/2)
  const poses: Array<[number, number, number, number]> = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  while (poses.length < count) poses.push([Math.floor(rnd() * 64), Math.floor(rnd() * 64), rnd() < 0.8 ? 1 : Math.floor(rnd() * 3), Math.floor(rnd() * 4)]);
  const vout = resolve(CACHE, 'oracle-views.bin');
  runGen(world, zoneN, poses.map((p) => p.join(',')).join(';'), vout);
  const ov = new Uint8Array(readFileSync(vout));
  const rec = 75 + PLANE_BYTES * 6;
  let winOk = 0, viewOk = 0;
  const bad: string[] = [];
  poses.forEach(([x, y, z, f], k) => {
    const ow = ov.subarray(k * rec, k * rec + 75), of = ov.subarray(k * rec + 75, (k + 1) * rec);
    const w = fillWindow(t, first.zone, x, y, z, f);
    const wEq = w.every((v, i) => v === ow[i]);
    if (wEq) winOk++;
    const v = composeView(t, vgm[0]!, ow, 0, backdrop);
    let diff = 0;
    for (let i = 0; i < v.length; i++) if (v[i] !== of[i]) diff++;
    if (diff === 0) viewOk++;
    else if (bad.length < 12) bad.push(`${x},${y},${z},${f}: ${diff} bytes differ${wEq ? '' : ' (window differs too)'}`);
  });
  console.log(`world ${world} zone ${zoneN} wall ${first.wall}: window ${winOk}/${poses.length}, view ${viewOk}/${poses.length} byte-exact`);
  for (const b of bad) console.log('  ' + b);
}

if (process.argv[1]?.endsWith('verify-view.ts')) main();
