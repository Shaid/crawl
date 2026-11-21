import {
  defineGameConfig,
  flattenConfigs,
  resolveDataDir,
  findFileCI,
  resType,
  getGameConfig as _getGameConfig,
  getSupportedPlatforms as _getSupportedPlatforms,
  type GameConfig as BaseGameConfig,
  type PlatformConfig as BasePlatformConfig,
} from '@seer-project/pipeline';
import {
  GAME_IDS,
  PLATFORM_IDS,
  DEFAULT_GAME,
  DEFAULT_PLATFORM,
  type GameId,
  type PlatformId,
} from '../../src/game-id.ts';

export { GAME_IDS, PLATFORM_IDS, DEFAULT_GAME, DEFAULT_PLATFORM, flattenConfigs, resolveDataDir, findFileCI, resType };
export type { GameId, PlatformId };

export interface PlatformConfig extends Omit<BasePlatformConfig, "platform"> {
  platform: PlatformId;
}

export interface GameConfig extends Omit<BaseGameConfig, "id" | "platforms"> {
  id: GameId;
  platforms: PlatformConfig[];
}

import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { writePNG } from '@seer-project/pipeline';
import {
  BCDFQ_PALETTES,
  amiga12ToRGB,
  blitRGBA,
  decodePlanar,
  ehbPalette,
  indicesToRGBA,
  readPaletteWords,
} from './amiga-planar.ts';
import { assetDir, manifestEntry, writeJson, writeManifest, writePlatformIndex, syncDataManifest } from './asset-paths.ts';

/** bcdfo portrait tiles: 32×24 @ 6bpp sequential planar, 96 bytes per plane. */
const TILE_W = 32, TILE_H = 24, TILE_BYTES = 576, BPP = 6;

/** Portrait tiles start at $60 in bcdfo; source = $60 + index × $240 (bcdfp LAB_010C). */
const BCDFO_TILE_BASE = 0x60;

/** Read the 32-colour in-game palette from bcdfq, expanded to 64 EHB entries. */
function loadGamePalette(dataDir: string): { words: number[]; rgb: number[] } {
  const { offset, count } = BCDFQ_PALETTES.game;
  const words = readPaletteWords(readFileSync(resolve(dataDir, 'bcdfq')), offset, count);
  return { words, rgb: ehbPalette(words) };
}

export const GAME_CONFIGS: GameConfig[] = defineGameConfig([{
  id: 'blackcrypt',
  displayName: 'Black Crypt',
  platforms: [{
    platform: 'amiga',
    dataDirs: ['blackcrypt/amiga'],
    executable: 'BlackCrypt',
    expectedFiles: ['bcdfa'],
    supported: true,
    assetDir: 'blackcrypt',
    features: {},

    async exportGameData(_cfg, dataDir) {
      const palDir = assetDir('palettes', 'blackcrypt', 'amiga');
      try {
        const d = readFileSync(resolve(dataDir, 'bcdfq'));
        for (const [name, { offset, count }] of Object.entries(BCDFQ_PALETTES)) {
          const colors = readPaletteWords(d, offset, count).map((v, i) => ({
            index: i,
            value: v,
            rgb: amiga12ToRGB(v),
          }));
          writeJson(resolve(palDir, `${name}.json`), { colors });
        }
        console.log(`  Extracted ${Object.keys(BCDFQ_PALETTES).length} palettes from bcdfq`);
      } catch { console.log('  Skipped palette'); }

      try {
        const d = readFileSync(resolve(dataDir, 'bcdfp'));
        // Item table: 20-byte records starting at 0x585C
        // Format: [2B prefix(0x0000)] [2B uniq] [1B marker(0x80)] [1B subGfx]
        //  [2B flags] [2B ?] [2B weight] [2B size] [1B ?] [1B AC] [2B extra] [2B extra]
        const itemStart = 0x585c;
        const itemSize = 20;
        const items: Record<string,unknown>[] = [];
        for (let i = 0; i < 22; i++) {
          const off = itemStart + i * itemSize;
          if (off + itemSize > d.length) break;
          const prefix = (d[off]<<8)|d[off+1];
          const uniq = (d[off+2]<<8)|d[off+3];
          const marker = d[off+4];
          const subGfx = d[off+5];
          const weight = (d[off+10]<<8)|d[off+11];
          const size = (d[off+12]<<8)|d[off+13];
          const ac = d[off+15];
          // Stop when record no longer has expected prefix + marker
          if (prefix !== 0 || marker !== 0x80) break;
          items.push({ uniq, subGfx, weight, size, ac });
        }
        writeJson(resolve(assetDir('data', 'blackcrypt', 'amiga'), 'items.json'), items);
        console.log(`  Extracted ${items.length} items from bcdfp`);
      } catch { console.log('  Skipped items'); }

      try {
        const d = readFileSync(resolve(dataDir, 'bcdfp'));
        const dataOff = 0x566c;
        const chunk = d.subarray(dataOff, dataOff + 1748);
        const classNamePattern = /(FIGHTER|CLERIC|MAGIC USER|DRUID)/g;
        const text = new TextDecoder('ascii').decode(chunk);
        const classes: Record<string, unknown>[] = [];
        let match: RegExpExecArray | null;
        while ((match = classNamePattern.exec(text)) !== null) {
          // Stats are 6 words (str/dex/con/int/wis/cha) immediately before the name.
          const statsOff = match.index - 12;
          if (statsOff < 0) continue;
          const word = (i: number) => (chunk[statsOff + i] << 8) | chunk[statsOff + i + 1];
          classes.push({
            name: match[0],
            stats: { str: word(0), dex: word(2), con: word(4), int: word(6), wis: word(8), cha: word(10) },
          });
        }
        writeJson(resolve(assetDir('data', 'blackcrypt', 'amiga'), 'classes.json'), classes);
        console.log(`  Extracted ${classes.length} classes from bcdfp`);
      } catch { console.log('  Skipped classes'); }
    },

    async buildAssets(_cfg, dataDir) {
      // Character portrait atlas from bcdfo.
      //
      // This previously read `bcdfa` as a run of raw 576-byte tiles from
      // offset 8. bcdfa is not that: it is the BCSPEED effect-animation
      // container (a mixed compressed/raw container — see
      // scripts/bclib/bcdfa.py), so decoding it as flat planar tiles produced
      // 343 frames of noise. bcdfo holds the tiles this atlas wants, at a
      // documented offset and with no compression.
      //
      // Correction: this loop used to run for all `(fileSize - 0x60) / 576`
      // = 109 "tiles". Only the first 36 are real character portraits —
      // visually confirmed (36 distinct, clean faces, then the picture
      // stops being a face at all at tile 36). That boundary isn't a guess:
      // BCDFO_TILE_BASE + 36 * TILE_BYTES == 0x5160 exactly, which is
      // bcdfp's LAB_010D desc00 source offset (`chargen_ui`, 128x105 — see
      // scripts/render_all.py's `ui_elements` table). Past that point the
      // file holds variously-sized UI descriptor graphics, not more 32x24
      // portrait tiles, and decoding them at the fixed 576-byte/tile stride
      // just tears them into "torn"/banded garbage. Those 23 UI elements are
      // already correctly extracted elsewhere (`sprites/ui.*`, by
      // scripts/render_all.py at their real documented offsets/sizes) — this
      // atlas should stop at the real portrait count instead of continuing
      // past it. See data-structure.md's "bcdfo" section for the full
      // writeup. (bcdfo is now fully accounted for — every byte from 0x5160
      // to EOF belongs to one of the 23 UI elements, its mask, one of three
      // 8x8 fonts, or the mouse-pointer sprite bank; 0 remainder.)
      const N_REAL_PORTRAITS = 36;
      try {
        const { words, rgb } = loadGamePalette(dataDir);
        const d = readFileSync(resolve(dataDir, 'bcdfo'));
        const n = Math.min(N_REAL_PORTRAITS, Math.floor((d.length - BCDFO_TILE_BASE) / TILE_BYTES));
        const cols = 12, rows = Math.ceil(n / cols);
        const aw = cols * TILE_W, ah = rows * TILE_H;
        const atlas = new Uint8Array(aw * ah * 4);

        const frames: { name: string; x: number; y: number; w: number; h: number }[] = [];
        for (let ti = 0; ti < n; ti++) {
          const off = BCDFO_TILE_BASE + ti * TILE_BYTES;
          const indices = decodePlanar(d.subarray(off, off + TILE_BYTES), TILE_W, TILE_H, BPP);
          const px = indicesToRGBA(indices, rgb, { transparentIndex0: true });
          const col = ti % cols, row = Math.floor(ti / cols);
          frames.push({ name: `tile_${ti}`, x: col * TILE_W, y: row * TILE_H, w: TILE_W, h: TILE_H });
          blitRGBA(atlas, aw, px, TILE_W, TILE_H, col * TILE_W, row * TILE_H);
        }

        const spriteDir = assetDir('sprites', 'blackcrypt', 'amiga');
        writePNG(resolve(spriteDir, 'portraits.png'), atlas, aw, ah);
        writeJson(resolve(spriteDir, 'portraits.json'), { frames, width: aw, height: ah });
        // Sidecar palette so the viewer can show a swatch bar for this atlas.
        writeJson(resolve(spriteDir, 'portraits.pal.json'), {
          colors: words.map(v => {
            const [r, g, b] = amiga12ToRGB(v);
            return { r, g, b };
          }),
        });

        writeManifest([manifestEntry('sprites/portraits', n, true)], 'blackcrypt', 'amiga');
        writePlatformIndex([{ game: 'blackcrypt', platform: 'amiga' }]);
        console.log(`  Built portrait atlas from bcdfo: ${n} tiles (${cols}x${rows})`);
      } catch (e) { console.log('  Skipped portraits:', e); }
    },
  }],
  },
  {
    id: 'wizardry6',
    displayName: 'Wizardry 6',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['wizardry6/amiga'],
      executable: undefined,
      expectedFiles: ['mazedata.ega'],
      supported: true,
      assetDir: 'wizardry6',
      features: {},

      async buildAssets(_cfg, dataDir) {
        // Order matters: the indexed atlas must exist on disk before
        // exportDungeonSlots runs, since it reads mazedata-indexed.json
        // back off disk to resolve atlas-absolute frame rects.
        const { exportDungeonLevels } = await import('../wizardry6/export-dungeon-levels.ts');
        exportDungeonLevels(dataDir);
        const { exportMazedataIndexed } = await import('../wizardry6/export-mazedata-indexed.ts');
        exportMazedataIndexed(dataDir);
        const { exportDungeonSlots } = await import('../wizardry6/export-dungeon-slots.ts');
        exportDungeonSlots(dataDir);
        console.log('  wizardry6/amiga: levels + indexed atlas + dungeon slots exported');
      },
    }, {
      platform: 'dosega',
      dataDirs: ['wizardry6/dosega/wiz6'],
      executable: undefined,
      expectedFiles: [],
      supported: false,
      assetDir: 'wizardry6',
      features: {},
    }, {
      platform: 'snes',
      dataDirs: ['wizardry6/snes'],
      executable: undefined,
      expectedFiles: [],
      supported: false,
      assetDir: 'wizardry6',
      features: {},
    }],
  },
  {
    id: 'mm1',
    displayName: 'Might & Magic: The Secret of the Inner Sanctum',
    platforms: [{
      platform: 'dosega',
      dataDirs: ['mm1/dosega'],
      executable: 'MM.EXE',
      expectedFiles: ['MAZEDATA.DTA'],
      supported: true,
      assetDir: 'mm1',
      features: {},

      async buildAssets() {
        const { exportMm1Maps } = await import('../mm1/export-maps.ts');
        const result = exportMm1Maps(resolve('data/mm1/dosega'));
        console.log(`  mm1/dosega: ${result.screens} maze screens decoded (slug-from-exe: ${result.slugFromExe}, ovr-match: ${result.ovrMatch})`);
        // Graphics decoders are Python (scripts/mm1lib/) — same pattern as mm3.
        const { execFileSync } = await import('node:child_process');
        const repo = process.cwd();
        const py = process.env.PYTHON ?? 'python3';
        execFileSync(py, [resolve(repo, 'scripts/extract_mm1_gfx.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm1_misc.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm1_tables.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm1_ovr.py')], { stdio: 'inherit', cwd: repo });
      },
    }],
  },
  {
    id: 'mm2',
    displayName: 'Might & Magic II: Gates to Another World',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['mm2/amiga'],
      executable: undefined,
      expectedFiles: [],
      supported: false,
      assetDir: 'mm2',
      features: {},
    }, {
      platform: 'dosega',
      dataDirs: ['mm2/dosega'],
      executable: undefined,
      expectedFiles: [],
      supported: false,
      assetDir: 'mm2',
      features: {},
    }],
  },
  {
    id: 'dungeonmaster',
    displayName: 'Dungeon Master',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['dungeonmaster/amiga'],
      executable: undefined,
      expectedFiles: ['Graphics.DAT'],
      // Extraction is a bespoke script (npm run dungeonmaster:export),
      // not wired into the shared runPipeline/buildAssets mechanism.
      supported: false,
      assetDir: 'dungeonmaster',
      features: {},
    }],
  },
  {
    id: 'chaosstrikesback',
    displayName: 'Chaos Strikes Back',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['chaosstrikesback/amiga'],
      executable: undefined,
      expectedFiles: ['disk1/Graphics.DAT'],
      supported: false,
      assetDir: 'chaosstrikesback',
      features: {},
    }],
  },
  {
    id: 'dungeonmaster2',
    displayName: 'Dungeon Master II: Skullkeep',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['dungeonmaster2/amiga'],
      executable: undefined,
      expectedFiles: ['GRAPHICS.DAT'],
      supported: false,
      assetDir: 'dungeonmaster2',
      features: {},
    }],
  },
  {
    id: 'abandonedplaces',
    displayName: 'Abandoned Places: A Time for Heroes',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['abandonedplaces/amiga'],
      executable: undefined,
      expectedFiles: ['Disk.1'],
      supported: true,
      assetDir: 'abandonedplaces',
      features: {},

      async buildAssets() {
        // ArtGame unpack (build/cache/abandonedplaces) + dungeon walker data (module pieces, backdrops, levels).
        const { exportWalker } = await import('../abandonedplaces/amiga/export-walker.ts');
        const w = exportWalker();
        console.log(`  abandonedplaces/amiga walker: ${w.levels} levels, ${w.modules} modules, ${w.backdrops} backdrops`);
      },
    }],
  },
  {
    id: 'abandonedplaces2',
    displayName: 'Abandoned Places 2',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['abandonedplaces2/amiga'],
      executable: undefined,
      expectedFiles: ['data/ap2.dir'],
      supported: true,
      assetDir: 'abandonedplaces2',
      features: {},

      async buildAssets() {
        // ArtGame unpack (build/cache/abandonedplaces2) + .bpl/.def/.ofs tileset atlases.
        const { exportTilesets } = await import('../abandonedplaces2/amiga/export-tilesets.ts');
        const r = exportTilesets();
        console.log(`  abandonedplaces2/amiga: ${r.atlases} atlases, ${r.frames} frames, geometry ${r.geometry.ok}/${r.geometry.checked}`);
        const { exportWalker } = await import('../abandonedplaces2/amiga/export-walker.ts');
        const w = exportWalker();
        console.log(`  abandonedplaces2/amiga walker: ${w.levels} levels, ${w.res} resource files`);
      },
    }],
  },
  {
    id: 'crystaldragon',
    displayName: 'Crystal Dragon',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['crystaldragon/amiga'],
      executable: undefined,
      expectedFiles: ['data/Crystal_Dragon'],
      supported: false,
      assetDir: 'crystaldragon',
      features: {},
    }],
  },
  {
    id: 'evilsdoom',
    displayName: "Evil's Doom",
    platforms: [{
      platform: 'amigaaga',
      dataDirs: ['evilsdoom/amigaaga'],
      executable: undefined,
      expectedFiles: ['data/PRG/INT.DAT'],
      supported: false,
      assetDir: 'evilsdoom',
      features: {},
    }],
  },
  {
    id: 'hiredguns',
    displayName: 'Hired Guns',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['hiredguns/amiga'],
      executable: undefined,
      expectedFiles: ['game/Hired Guns'],
      supported: false,
      assetDir: 'hiredguns',
      features: {},
    }],
  },
  {
    id: 'liberation',
    displayName: 'Liberation: Captive II',
    platforms: [{
      platform: 'cd32',
      dataDirs: ['liberation/cd32'],
      executable: undefined,
      expectedFiles: ['data/captiveII'],
      supported: false,
      assetDir: 'liberation',
      features: {},
    }],
  },
  {
    id: 'perihelion',
    displayName: 'Perihelion: The Prophecy',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['perihelion/amiga'],
      executable: undefined,
      expectedFiles: ['PerihelionData/Table.Dat'],
      supported: false,
      assetDir: 'perihelion',
      features: {},
    }],
  },
  {
    id: 'zombi',
    displayName: 'Zombi',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['zombi/amiga'],
      executable: undefined,
      expectedFiles: ['data/zombi'],
      supported: true,
      assetDir: 'zombi',
      features: {},

      async buildAssets(_cfg, dataDir) {
        const { exportZombiData } = await import('../zombi/amiga/export-data.ts');
        await exportZombiData(dataDir);
        const { exportZombiMap } = await import('../zombi/amiga/export-map.ts');
        exportZombiMap(dataDir);
      },
    }],
  },
  {
    id: 'bardstale1',
    displayName: "The Bard's Tale: Tales of the Unknown",
    platforms: [{
      platform: 'amiga',
      dataDirs: ['_unexplored_/BardsTaleNTSC/data/bards_data'],
      executable: undefined,
      expectedFiles: ['pics', 'levs', 'big_dung', 'dung_blank'],
      supported: true,
      assetDir: 'bardstale1',
      features: {},

      async buildAssets(_cfg, dataDir) {
        const { exportBardsTale1Data } = await import('../bardstale1/amiga/export-data.ts');
        await exportBardsTale1Data(dataDir);
        const { exportBardsTale1Dungeon } = await import('../bardstale1/amiga/export-dungeon.ts');
        exportBardsTale1Dungeon(dataDir);
      },
    }],
  },
  {
    id: 'bardstale2',
    displayName: "The Bard's Tale II: The Destiny Knight",
    platforms: [{
      platform: 'amiga',
      dataDirs: ['_unexplored_/BardsTale2/data/bards_data'],
      executable: undefined,
      expectedFiles: ['pics', 'levs', 'big_dung'],
      supported: true,
      assetDir: 'bardstale2',
      features: {},

      async buildAssets(_cfg, dataDir) {
        const { exportBardsTale2Data } = await import('../bardstale2/amiga/export-data.ts');
        await exportBardsTale2Data(dataDir);
        const { exportBardsTale2Dungeon } = await import('../bardstale2/amiga/export-dungeon.ts');
        exportBardsTale2Dungeon(dataDir);
      },
    }],
  },
  {
    id: 'bardstale3',
    displayName: "The Bard's Tale III: Thief of Fate",
    platforms: [{
      platform: 'amiga',
      dataDirs: ['_unexplored_/BardsTale3/data'],
      executable: undefined,
      expectedFiles: ['all.pic', 'bard3', 'maps.hi', 'maps.lo'],
      supported: true,
      assetDir: 'bardstale3',
      features: {},

      async buildAssets(_cfg, dataDir) {
        const { exportBardsTale3Data } = await import('../bardstale3/amiga/export-data.ts');
        await exportBardsTale3Data(dataDir);
        const { exportBardsTale3Maps } = await import('../bardstale3/amiga/export-maps.ts');
        exportBardsTale3Maps(dataDir);
      },
    }],
  },
  {
    id: 'eotb3',
    displayName: 'Eye of the Beholder III: Assault on Myth Drannor',
    platforms: [{
      platform: 'dosvga',
      dataDirs: ['eotb3/dosvga'],
      executable: 'EYE.BAT',
      expectedFiles: ['EYE.RES'],
      supported: true,
      assetDir: 'eotb3',
      features: {},

      async buildAssets() {
        // EYE.RES decoders are Python (scripts/eotb3lib/). The walker pack
        // (AESOP class bytecode + level objects + VFX bitmaps) is what
        // tools/walker/games-eotb3.ts runs.
        const { execFileSync } = await import('node:child_process');
        const repo = process.cwd();
        const py = process.env.PYTHON ?? 'python3';
        execFileSync(py, [resolve(repo, 'scripts/extract_eotb3_res.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_eotb3_walker.py')], { stdio: 'inherit', cwd: repo });
        console.log('  eotb3/dosvga: EYE.RES assets + walker pack extracted (python)');
      },
    }],
  },
  {
    id: 'mm3',
    displayName: 'Might & Magic III: Isles of Terra',
    platforms: [{
      platform: 'amiga',
      dataDirs: ['mm3/amiga'],
      executable: 'Might&MagicIII',
      expectedFiles: ['game.cc'],
      supported: true,
      assetDir: 'mm3',
      features: {},

      async buildAssets() {
        // The Amiga container/sprite decoders are Python (scripts/mm3lib/).
        // Run them, then merge the manifest through the shared helpers so the
        // viewer's index stays in sync.
        const { execFileSync } = await import('node:child_process');
        const repo = process.cwd();
        const py = process.env.PYTHON ?? 'python3';
        execFileSync(py, [resolve(repo, 'scripts/extract_mm3_amiga.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm3_amiga_sprites.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm3_amiga_screens.py')], { stdio: 'inherit', cwd: repo });
        syncDataManifest('mm3', 'amiga');
        writePlatformIndex([{ game: 'mm3', platform: 'amiga' }]);
        console.log('  mm3/amiga: sprites + container extracted (python)');
      },
    }, {
      platform: 'dosvga',
      dataDirs: ['mm3/dosvga'],
      executable: 'MM3.EXE',
      expectedFiles: ['MM3.CC'],
      supported: true,
      assetDir: 'mm3',
      features: {},

      async buildAssets() {
        const { execFileSync } = await import('node:child_process');
        const repo = process.cwd();
        const py = process.env.PYTHON ?? 'python3';
        execFileSync(py, [resolve(repo, 'scripts/extract_mm3_dos.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm3_dos_screens.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm3_dos_sprites.py')], { stdio: 'inherit', cwd: repo });
        execFileSync(py, [resolve(repo, 'scripts/extract_mm3_dos_mazes.py')], { stdio: 'inherit', cwd: repo });
        syncDataManifest('mm3', 'dosvga');
        writePlatformIndex([{ game: 'mm3', platform: 'dosvga' }]);
        console.log('  mm3/dosvga: container + screens + sprites + mazes extracted (python)');
      },
    }],
  },
]);

export const GAME_PLATFORMS = flattenConfigs(GAME_CONFIGS);

export function getGameConfig(game: GameId, platform: PlatformId): PlatformConfig | undefined {
  return _getGameConfig(GAME_PLATFORMS, game, platform) as PlatformConfig | undefined;
}

export function getSupportedPlatforms(game: GameId): PlatformId[] {
  return _getSupportedPlatforms(GAME_PLATFORMS, game) as PlatformId[];
}
