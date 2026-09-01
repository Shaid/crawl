/**
 * Ishar 1 (Amiga AGA) first-person outdoor renderer — composites one real
 * frame of the frustum-scan first-person view for a given party
 * position/facing, by actually *executing* a location script's compiled
 * ALIS bytecode (`tools/shared/alis-interp.ts`) against the CONFIRMED
 * `CONT*.FIC` region grid (`tools/shared/ishar-regions.ts`) and the
 * CONFIRMED sprite/bitmap decoder (`tools/shared/ishar-sprites.ts`).
 *
 * Scope, honestly: this renders exactly ONE Ishar 1 outdoor biome —
 * `FORET.bin` (forest) plus its `FOND.bin` backdrop companion — chosen
 * because it's the one script this session hand-verified byte-for-byte
 * against the reference source (`docs/ishar-container-format.md` §8's
 * "First-person rendering mechanism" section). `VILLAGE.bin` shares the
 * identical facing/ring-loop shell (byte-for-byte, including the whole
 * per-ring elevation/scale constant table) but dispatches its CELL value
 * via `cswitch2` rather than `FORET`'s `cswitch1` — the interpreter handles
 * both dispatch shapes fine (see `alis-interp.ts`), so `renderIsharScene()`
 * below is not actually FORET-specific; it was simply only exercised
 * end-to-end against FORET this session. Not attempted this session:
 * TEMPLE/RAMPART/PLAINE, caves/dungeons (a materially different indoor
 * shape wasn't traced), and Ishar 2/3 (different global-variable offsets
 * and screen geometry — see the module-level constants below, which are
 * Ishar-1-specific).
 *
 * Confidence: the underlying algorithm execution is CONFIRMED (the
 * interpreter reproduces, from real bytecode + real grid data + a real
 * party pose, exactly the per-ring elevation/lateral-scale constants and
 * per-cell sprite-index-base values that were hand-decoded and cross-
 * checked against `github.com/maestun/alis`'s C source this session — see
 * `alis-interp.ts`'s module doc). The PIXEL COMPOSITING below (sprite
 * anchor point, backdrop layering, palette) is RENDERED/HYPOTHESIS: no
 * real screenshot or emulator capture was available to check pixel-exact
 * placement, sprite anchor convention (this renderer assumes each sprite's
 * pixel-X is its horizontal center and pixel-Y is its ground/base line —
 * a reasonable but UNVERIFIED convention for "billboarded objects standing
 * on terrain"), or the FOND backdrop's real tiling/parallax behavior (see
 * that function's own doc comment for what wasn't resolved).
 */

import { scriptEntryPoint } from './alis-disasm.ts';
import { runIsharScene, resolveIsharComposite, type SceneEnv } from './alis-interp.ts';
import { findIsharDirectory, resolveIsharSlot, decodeIsharBitmap, isharBitmapToNormalizedGreyscaleRGBA, type IsharBitmap } from './ishar-sprites.ts';
import { unpackSilmarilsScript } from './silmarils-unpack.ts';

/** Ishar 1's confirmed party-state/world globals (`docs/ishar-container-format.md` §9, `basemain`-relative). Ishar 2/3 use different offsets -- not re-derived this session (see module doc). */
export const ISHAR1_GLOBALS = {
  partyX: 0x137c,
  partyY: 0x137d,
  partyFacing: 0x137e,
  locationType: 0x1508,
  gridBufferA: 0x80,
  gridBufferB: 0x234a,
} as const;

/**
 * Ishar 1's game screen (`cscreen 0x000e`, defined by `MAIN.bin`'s own
 * `cdefsc` call) — CONFIRMED from `MAIN.bin`'s decompiled `cdefsc scr=0x000e`
 * 32-byte config block: `config[4:6]`/`config[6:8]` (u16 BE) give the
 * post-projection pixel X-center and horizon-line Y, `config[0xc:0xe]`/
 * `config[0xe:0x10]` give the viewport width/height, and `config[0x18]`
 * (0xff) confirms the perspective divide is disabled (matching the already-
 * confirmed `creducing`-negative-disables-divide finding). This corrects a
 * byte-offset transcription in the originating `re-oracle` escalation
 * (which cited +0xa/+0xc/+0x12/+0x14/+0x1c/+0x1d against the SAME 32-byte
 * block) — the VALUES match exactly (127/86/255/125), only the offsets were
 * off by a constant 5; re-derived directly from `MAIN.bin`'s real bytes
 * this session, not assumed.
 */
export const ISHAR1_GAME_SCREEN = { xCenter: 127, horizonY: 86, width: 255, height: 125 } as const;

export interface RegionGridSource {
  width: number;
  height: number;
  /** Sign-extended cell reader for one buffer ('A' = `basemain+0x80`, 'B' = `basemain+0x234a`). Ishar 1 has only one real layer -- pass the same reader for both. */
  read(buffer: 'A' | 'B', x: number, y: number): number;
}

function makeSceneEnv(globals: Record<number, number>, grid: RegionGridSource): SceneEnv {
  return {
    readMain(addr) {
      return globals[addr] ?? 0;
    },
    readGrid(addr, x, y) {
      const buf = addr === ISHAR1_GLOBALS.gridBufferB ? 'B' : 'A';
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
      return grid.read(buf, x, y);
    },
  };
}

export interface ScenePlacementLeaf {
  /** Screen-space, pre-projection: pixelX = screen.xCenter + x; pixelY = screen.horizonY - z. */
  x: number;
  z: number;
  /** World depth -- used only for far-to-near draw-order sorting, not a pixel coordinate. */
  sortY: number;
  bitmap: IsharBitmap;
  invertX: boolean;
}

/** Run one script's frame logic and resolve every `cput`/`cputnat`/`cxputat` placement's `idx` to real decoded bitmap(s) (recursively expanding composite records). Returns leaves in emission order (NOT sorted). */
export function computeScenePlacements(scriptData: Uint8Array, env: SceneEnv, warnings: string[]): ScenePlacementLeaf[] {
  const entry = scriptEntryPoint(scriptData);
  const { placements, warnings: runWarnings } = runIsharScene(scriptData, entry, env);
  warnings.push(...runWarnings);

  const dir = findIsharDirectory(scriptData);
  if (!dir) {
    warnings.push('script has no resource directory -- cannot resolve placement indices');
    return [];
  }
  const resolveSlot = (idx: number) => resolveIsharSlot(scriptData, dir, idx);

  const leaves: ScenePlacementLeaf[] = [];
  for (const p of placements) {
    if (p.idx < 0 || p.idx >= dir.length) continue;
    const composite = resolveIsharComposite(scriptData, dir, p.idx, resolveSlot);
    for (const leaf of composite) {
      const headerOffset = resolveSlot(leaf.index);
      if (headerOffset < 0) continue;
      const bmp = decodeIsharBitmap(scriptData, leaf.index, headerOffset);
      if (!bmp) continue;
      leaves.push({
        x: p.x + leaf.dx,
        z: p.z + leaf.dz,
        sortY: p.y + leaf.dy,
        bitmap: bmp,
        invertX: leaf.invertX,
      });
    }
  }
  return leaves;
}

export interface FirstPersonFrame {
  width: number;
  height: number;
  /** RGBA, row-major, straight (non-premultiplied) alpha. */
  rgba: Uint8Array;
  placementCount: number;
  warnings: string[];
}

function blit(canvas: Uint8Array, cw: number, ch: number, bmp: IsharBitmap, dstX: number, dstY: number, invertX: boolean): void {
  const src = isharBitmapToNormalizedGreyscaleRGBA(bmp);
  for (let y = 0; y < bmp.height; y++) {
    const py = dstY + y;
    if (py < 0 || py >= ch) continue;
    for (let x = 0; x < bmp.width; x++) {
      const sx = invertX ? bmp.width - 1 - x : x;
      const a = src[(y * bmp.width + sx) * 4 + 3]!;
      if (a === 0) continue;
      const px = dstX + x;
      if (px < 0 || px >= cw) continue;
      const si = (y * bmp.width + sx) * 4;
      const di = (py * cw + px) * 4;
      canvas[di] = src[si]!;
      canvas[di + 1] = src[si + 1]!;
      canvas[di + 2] = src[si + 2]!;
      canvas[di + 3] = 255;
    }
  }
}

/**
 * Draw a resolved placement list (already sorted far-to-near by the caller)
 * onto an RGBA canvas. Anchor convention (UNVERIFIED, see module doc):
 * pixelX is the sprite's horizontal CENTER, pixelY is its BASE (bottom
 * edge) -- the natural convention for a "standing on the ground" billboard.
 */
export function compositeFrame(
  leaves: ScenePlacementLeaf[],
  screen: { xCenter: number; horizonY: number; width: number; height: number },
  canvas: Uint8Array,
): void {
  for (const leaf of leaves) {
    const pixelX = screen.xCenter + leaf.x;
    const pixelY = screen.horizonY - leaf.z;
    const dstX = Math.round(pixelX - leaf.bitmap.width / 2);
    const dstY = Math.round(pixelY - leaf.bitmap.height);
    blit(canvas, screen.width, screen.height, leaf.bitmap, dstX, dstY, leaf.invertX);
  }
}

export interface ForestFrameOptions {
  /** Decompressed `FORET.bin`. */
  foret: Uint8Array;
  /** Decompressed `FOND.bin` (sky/backdrop companion) -- optional; omit to skip the backdrop layer. */
  fond?: Uint8Array;
  partyX: number;
  partyY: number;
  facing: 0 | 1 | 2 | 3;
  locationType?: number;
  grid: RegionGridSource;
  screen?: { xCenter: number; horizonY: number; width: number; height: number };
}

/**
 * Render one Ishar 1 forest-biome first-person frame. See module doc for
 * scope/confidence. `facing` uses this project's own N/E/S/W = 0/1/2/3
 * convention (`tools/walker/games-ishar.ts`'s `dirs` array) -- internally
 * converted to the raw bytecode facing value (CONFIRMED empirically: the
 * script's `cswitch2 omainb(0x137e) ... base=-1` dispatch needs
 * `rawValue = facingIndex + 1` to land on slot `facingIndex`, and each
 * slot's own axis arithmetic was hand-verified to match N/E/S/W in table
 * order -- see `alis-interp.ts`'s test coverage and
 * `docs/ishar-container-format.md` §8).
 */
export function renderIsharForestFrame(opts: ForestFrameOptions): FirstPersonFrame {
  const screen = opts.screen ?? ISHAR1_GAME_SCREEN;
  const warnings: string[] = [];
  const canvas = new Uint8Array(screen.width * screen.height * 4);
  // Sky/ground fill -- a flat two-tone placeholder split at the horizon line,
  // NOT derived from real palette data (see module doc). Deliberately flat
  // (not a gradient) so it reads unambiguously as "sky" vs "ground" during
  // visual verification, rather than producing an internal colour-banding
  // artifact that can be mistaken for backdrop sprite content.
  for (let y = 0; y < screen.height; y++) {
    const above = y < screen.horizonY;
    for (let x = 0; x < screen.width; x++) {
      const i = (y * screen.width + x) * 4;
      if (above) {
        canvas[i] = 70; canvas[i + 1] = 110; canvas[i + 2] = 170; // flat placeholder sky blue
      } else {
        canvas[i] = 60; canvas[i + 1] = 95; canvas[i + 2] = 50; // flat placeholder ground green
      }
      canvas[i + 3] = 255;
    }
  }

  const globals: Record<number, number> = {
    [ISHAR1_GLOBALS.partyX]: opts.partyX,
    [ISHAR1_GLOBALS.partyY]: opts.partyY,
    [ISHAR1_GLOBALS.partyFacing]: opts.facing + 1,
    [ISHAR1_GLOBALS.locationType]: opts.locationType ?? 0,
  };
  const env = makeSceneEnv(globals, opts.grid);

  let placementCount = 0;

  if (opts.fond) {
    const fondLeaves = computeScenePlacements(opts.fond, env, warnings);
    compositeFrame(fondLeaves, screen, canvas);
    placementCount += fondLeaves.length;
  }

  const foretLeaves = computeScenePlacements(opts.foret, env, warnings);
  foretLeaves.sort((a, b) => b.sortY - a.sortY); // far-to-near painter's algorithm
  compositeFrame(foretLeaves, screen, canvas);
  placementCount += foretLeaves.length;

  return { width: screen.width, height: screen.height, rgba: canvas, placementCount, warnings };
}

/** Convenience: unpack a raw `.DO` file straight to its decompressed bytes (small helper so callers don't need to import `silmarils-unpack.ts` separately). */
export function unpackIsharScript(raw: Uint8Array): Uint8Array {
  const result = unpackSilmarilsScript(raw);
  if (!result) throw new Error('not a recognized Silmarils container');
  return result.data;
}
