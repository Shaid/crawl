/**
 * Shared export orchestration for the AGOS "old bundle" Amiga games
 * (Elvira, Elvira 2, Waxworks) — walks every zone's `.pkd` pair, decodes
 * every picture in its animation table, and writes one atlas PNG + sidecar
 * per zone plus a "largest image" screen render for a quick visual sample.
 *
 * See `agos-vga.ts` for the decode primitives this composes and
 * `docs/agos-pkd-format.md` for the format writeup.
 */
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { readBinary, writePNG, writeJson } from '@seer-project/pipeline';
import { assetDir, manifestEntry, writeManifest, type ManifestEntry } from './asset-paths.ts';
import { shelfPack } from './atlas-pack.ts';
import {
  simonDecr,
  loadPalette,
  readAnimTable,
  decodeImage,
  unpackIndices,
  indicesToRGBA,
  discoverZones,
  type AgosNamingScheme,
  type AgosZoneFiles,
} from './agos-vga.ts';

export interface AgosExportSummary {
  zonesFound: number;
  zonesDecoded: number;
  zonesMissingFile: number;
  zonesNoPictures: number;
  imagesDecoded: number;
  screensWritten: number;
  errors: { zone: number; message: string }[];
}

export async function exportAgosPictures(
  game: string,
  platform: string,
  dataDir: string,
  scheme: AgosNamingScheme,
  opts: { maxScreens?: number } = {},
): Promise<AgosExportSummary> {
  const maxScreens = opts.maxScreens ?? 40;
  const files = readdirSync(dataDir);
  const zones = discoverZones(files, scheme);

  const textureDir = assetDir('textures', game, platform);
  const screenDir = assetDir('screens', game, platform);
  const paletteDir = assetDir('palettes', game, platform);
  const dataDirOut = assetDir('data', game, platform);

  const summary: AgosExportSummary = {
    zonesFound: zones.length,
    zonesDecoded: 0,
    zonesMissingFile: 0,
    zonesNoPictures: 0,
    imagesDecoded: 0,
    screensWritten: 0,
    errors: [],
  };
  const manifestEntries: ManifestEntry[] = [];
  const zoneTable: Record<string, unknown> = {};
  const screenCandidates: { zone: number; area: number }[] = [];

  for (const zf of zones) {
    if (!zf.type1 || !zf.type2) {
      summary.zonesMissingFile++;
      continue;
    }
    try {
      const zoneResult = decodeZone(dataDir, zf);
      if (!zoneResult) continue;
      const { palette, entries } = zoneResult;
      if (entries.length === 0) {
        summary.zonesNoPictures++;
        continue;
      }

      const packItems = entries.map((e) => ({ name: `img${e.index}`, width: e.width, height: e.height }));
      const packed = shelfPack(packItems, 1024);
      const atlasRGBA = new Uint8Array(packed.width * packed.height * 4);
      let largest = entries[0];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.width * e.height > largest.width * largest.height) largest = e;
        const img = decodeImage(e.src, e.width, e.height, e.compressed);
        const indices = unpackIndices(img);
        const rgba = indicesToRGBA(indices, palette);
        const frame = packed.frames[i];
        blit(atlasRGBA, packed.width, rgba, e.width, e.height, frame.x, frame.y);
        summary.imagesDecoded++;
      }

      const zoneName = `zone${String(zf.zone).padStart(3, '0')}`;
      await writePNG(resolve(textureDir, `${zoneName}.png`), atlasRGBA, packed.width, packed.height);
      writeJson(resolve(textureDir, `${zoneName}.json`), {
        frames: packed.frames.map((f, i) => ({ name: f.name, x: f.x, y: f.y, w: entries[i].width, h: entries[i].height })),
        width: packed.width,
        height: packed.height,
      });
      manifestEntries.push(manifestEntry(`textures/${zoneName}`, entries.length, true));

      writeJson(resolve(paletteDir, `${zoneName}.json`), {
        colors: palette.map((c) => ({ r: c.r, g: c.g, b: c.b })),
      });

      zoneTable[zoneName] = {
        zone: zf.zone,
        type1: zf.type1,
        type2: zf.type2,
        type3: zf.type3,
        images: entries.map((e) => ({ index: e.index, width: e.width, height: e.height, flags: e.flags, compressed: e.compressed })),
      };

      screenCandidates.push({ zone: zf.zone, area: largest.width * largest.height });
      summary.zonesDecoded++;
    } catch (e) {
      summary.errors.push({ zone: zf.zone, message: (e as Error).message });
    }
  }

  // Render "screens/" for the N zones with the largest single image — the
  // best proxy for a full room/background picture vs. small icon/sprite
  // frames, without flooding screens/ with every zone.
  screenCandidates.sort((a, b) => b.area - a.area);
  for (const cand of screenCandidates.slice(0, maxScreens)) {
    const zf = zones.find((z) => z.zone === cand.zone)!;
    const zoneResult = decodeZone(dataDir, zf);
    if (!zoneResult) continue;
    const { palette, entries } = zoneResult;
    let largest = entries[0];
    for (const e of entries) if (e.width * e.height > largest.width * largest.height) largest = e;
    const img = decodeImage(largest.src, largest.width, largest.height, largest.compressed);
    const indices = unpackIndices(img);
    const rgba = indicesToRGBA(indices, palette);
    const name = `zone${String(cand.zone).padStart(3, '0')}_img${largest.index}`;
    await writePNG(resolve(screenDir, `${name}.png`), rgba, largest.width, largest.height);
    manifestEntries.push(manifestEntry(`screens/${name}`, 1, true));
    summary.screensWritten++;
  }

  writeJson(resolve(dataDirOut, 'zones.json'), zoneTable);
  writeManifest(manifestEntries, game, platform);

  return summary;
}

interface DecodedAnimEntry {
  index: number;
  width: number;
  height: number;
  flags: number;
  compressed: boolean;
  src: Uint8Array;
}

function decodeZone(dataDir: string, zf: AgosZoneFiles) {
  if (!zf.type1 || !zf.type2) return null;
  const vga1raw = readBinary(resolve(dataDir, zf.type1));
  const vga2raw = readBinary(resolve(dataDir, zf.type2));
  const vga1 = simonDecr(vga1raw);
  const vga2 = simonDecr(vga2raw);
  const palette = loadPalette(vga1, 0, 16);
  const table = readAnimTable(vga2);
  const entries: DecodedAnimEntry[] = table.map((e) => ({
    index: e.index,
    width: e.width,
    height: e.height,
    flags: e.flags,
    compressed: e.compressed,
    src: vga2.subarray(e.offset),
  }));
  return { palette, entries };
}

function blit(dst: Uint8Array, dstWidth: number, src: Uint8Array, srcWidth: number, srcHeight: number, dx: number, dy: number): void {
  for (let y = 0; y < srcHeight; y++) {
    const dstRow = ((dy + y) * dstWidth + dx) * 4;
    const srcRow = y * srcWidth * 4;
    dst.set(src.subarray(srcRow, srcRow + srcWidth * 4), dstRow);
  }
}
