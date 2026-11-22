/**
 * The Wizardry 6 SNES ROM's own dungeon routines, driven headlessly in the
 * `cpu65816.ts` core -- the walker's parity oracle and the maze-window
 * exporter's engine (`docs/wizardry6/snes/data-structure.md` §3.14.13).
 *
 * Nothing here re-implements game logic: each entry point below is a real
 * ROM routine entered directly with the registers/WRAM its caller would
 * have set up. The harness only (a) zeroes WRAM to model a new game (every
 * quest flag, `$096C`, `$094D`, `$0964`, `$0B74`... clear), (b) installs the
 * CGRAM shadow the boot task copies (ROM file `0x127E4`, §3.14.10), (c)
 * replaces the one-frame coroutine yield `$80:8267` with a plain RTS, and
 * (d) reads results back out of WRAM/VRAM.
 *
 * Entry points:
 * - `$80:D06C` -> `$80:D073`: maze reload (`$8B:DE64`) + the 24x24 window
 *   builder (`D15A`/`D1B7`/`D2BE`/`D450`/`D412`, origin probes `$80:D758`,
 *   `$0896` early stop). Fills `$7E:4300` wall / `$7E:4540` feature /
 *   `$7E:4780` variant / `$7E:DBC0` stairs flag, sets `$a8`/`$aa` (window
 *   centre-region origin y/x), `$c0` (region) and `$be` (level*48+region*4).
 * - `$82:F842` + `$82:867F`: dungeon palette into CGRAM.
 * - `$83:E1CC` / `$83:E223`: BG2 tilemap install, then the view walk
 *   (`$80:C69F`) + the `$83:E25A` painter into `$7E:5000`.
 * - `$80:BF78`: the NMI-side DMA flush to VRAM.
 * - `$80:C40B`+4*rel: the movement decision (forward/right/back/left).
 */
import { Bus, CPU } from './cpu65816.ts';

export const DEFAULT_ROM_PATH = 'data/wizardry6/snes/Wizardry VI - Kindan no Mahitsu (Japan).sfc';

/** WRAM planes of one 24x24 maze window, exactly as `$80:D073` leaves them. Row-major, index = row*24+col; row 0 is the window's north edge. */
export interface RawWindow {
  wall: Uint8Array;
  feature: Uint8Array;
  variant: Uint8Array;
  dbc0: Uint8Array;
  /** `$aa`, `$a8`: global x / y of the centre region's origin (window cell (row 15, col 8) holds global (aa, a8)). */
  originX: number;
  originY: number;
  /** `$c0`: the centre region index 0-11; `$be` = level*48 + region*4. */
  region: number;
  be: number;
}

export interface PoseResult {
  window: RawWindow;
  /** The compose list the walk left at `$7E:421C` (length `$a4`). */
  words: number[];
  /** 144x120 4bpp pixel values read back through BG2 (tilemap `$7800`, chars `$2000`). */
  idx: Uint8Array;
  /** Per pixel, the BG2 tilemap entry's palette number (CGRAM row) -- colour = `cgram[palNo*16 + idx]`. */
  palNo: Uint8Array;
  cgram: Uint16Array;
  /** `$50`: the party's window cell index. */
  cell: number;
  /** `$44`-`$47`: the walk's own-cell edge codes (ahead, right, behind, left). */
  codes: [number, number, number, number];
  error: string | null;
}

const VIEW_W = 144;
const VIEW_H = 120;

export class SnesW6Machine {
  readonly bus: Bus;
  readonly cpu: CPU;
  private moveResult: boolean | null = null;

  constructor(rom: Uint8Array) {
    this.bus = new Bus(rom);
    this.cpu = new CPU(this.bus);
    const rts = (c: CPU) => {
      c.PC = (c.pull16() + 1) & 0xffff;
    };
    // one-frame coroutine yield -> return immediately
    this.cpu.hooks.set(0x808267, rts);
    this.cpu.hooks.set(0x008267, rts);
    // movement: $80:C4AA is the "step accepted" path; $80:BDAE the bump message/sound
    this.cpu.hooks.set(0x80c4aa, (c) => {
      this.moveResult = true;
      rts(c);
    });
    this.cpu.hooks.set(0x80bdae, rts);
  }

  r8(a: number): number {
    return this.bus.read(a);
  }
  r16(a: number): number {
    return this.bus.read(a) | (this.bus.read(a + 1) << 8);
  }
  w8(a: number, v: number): void {
    this.bus.write(a, v);
  }
  w16(a: number, v: number): void {
    this.bus.write(a, v & 0xff);
    this.bus.write(a + 1, (v >> 8) & 0xff);
  }

  private resetCpu(): void {
    const c = this.cpu;
    c.S = 0x1e80;
    c.DP = 0;
    c.DBR = 0x80;
    c.P = 0x20;
    c.E = false;
    c.A = 0;
    c.X = 0;
    c.Y = 0;
  }

  /**
   * New-game state: all WRAM/VRAM/CGRAM zero, CGRAM shadow installed, and
   * the palette selector `$094C` at its start value (`$80:891B` entry 0,
   * 0x50 = group 40). `$82:F842` only changes `$094C` on a matching
   * environment record, so in play it carries over from the last one.
   */
  clear(): void {
    this.bus.wram.fill(0);
    this.bus.vram.fill(0);
    this.bus.cgram.fill(0);
    for (let i = 0; i < 512; i++) this.bus.wram[0x3800 + i] = this.bus.rom[0x127e4 + i]!;
    this.bus.wram[0x094c] = this.bus.rom[0x0921]!;
  }

  private setPose(level: number, gx: number, gy: number, facing: number): void {
    this.w8(0x0905, level);
    this.w16(0x0906, gy);
    this.w16(0x0908, gx);
    this.w8(0x0904, facing);
  }

  /** Run `$80:D06C` (reload + window build) for a party at global (gx, gy). `fresh` = start from new-game WRAM. */
  buildWindow(level: number, gx: number, gy: number, fresh = true): RawWindow {
    if (fresh) this.clear();
    this.setPose(level, gx, gy, 0);
    this.resetCpu();
    this.cpu.callLong(0x80d06c);
    return this.readWindow();
  }

  readWindow(): RawWindow {
    const w = this.bus.wram;
    return {
      wall: w.slice(0x4300, 0x4300 + 576),
      feature: w.slice(0x4540, 0x4540 + 576),
      variant: w.slice(0x4780, 0x4780 + 576),
      dbc0: w.slice(0xdbc0, 0xdbc0 + 576),
      originX: this.r16(0xaa),
      originY: this.r16(0xa8),
      region: this.r8(0xc0),
      be: this.r16(0xbe),
    };
  }

  /** The full per-pose pipeline from new-game WRAM: window build, palette, tilemap, walk + painter, DMA, BG2 readback. */
  runPose(level: number, gx: number, gy: number, facing: number): PoseResult {
    this.clear();
    let error: string | null = null;
    let stage = 'load';
    try {
      this.setPose(level, gx, gy, facing);
      this.resetCpu();
      this.cpu.callLong(0x80d06c);
      stage = 'palette';
      this.resetCpu();
      this.cpu.callLong(0x82f842);
      this.resetCpu();
      this.cpu.callLong(0x82867f);
      stage = 'tilemap';
      this.resetCpu();
      this.cpu.callLong(0x83e1cc);
      stage = 'compose';
      this.resetCpu();
      this.cpu.callLong(0x83e223);
      stage = 'dma';
      this.resetCpu();
      this.w8(0x23, this.r8(0x23) | 0x02 | 0x08 | 0x40);
      this.cpu.callShort(0x80bf78);
    } catch (e) {
      error = `${stage}: ${(e as Error).message}`;
    }
    return this.readPose(error); // list length: $a4, saved by $83:E23D ($4c is reused as the blit cursor)
  }

  /**
   * Move the party to (gx, gy, facing) keeping the current WRAM -- as the
   * game does after a step -- and re-run `$80:D039` (keep the window while
   * the party stays in its centre region, else rebuild via `$80:D065`),
   * then the tilemap/walk/painter/DMA. The palette is not re-run (the game
   * re-runs `$82:F842` only at scripted transitions).
   */
  continuePose(gx: number, gy: number, facing: number): PoseResult {
    let error: string | null = null;
    let stage = 'keep';
    try {
      this.w16(0x0906, gy);
      this.w16(0x0908, gx);
      this.w8(0x0904, facing);
      this.resetCpu();
      this.cpu.callLong(0x80d039);
      stage = 'tilemap';
      this.resetCpu();
      this.cpu.callLong(0x83e1cc);
      stage = 'compose';
      this.resetCpu();
      this.cpu.callLong(0x83e223);
      stage = 'dma';
      this.resetCpu();
      this.w8(0x23, this.r8(0x23) | 0x02 | 0x08 | 0x40);
      this.cpu.callShort(0x80bf78);
    } catch (e) {
      error = `${stage}: ${(e as Error).message}`;
    }
    return this.readPose(error);
  }

  private readPose(error: string | null): PoseResult {
    const n = this.r16(0xa4);
    const words: number[] = [];
    for (let i = 0; i < n && i < 0x400; i += 2) words.push(this.r16(0x7e421c + i));
    return {
      window: this.readWindow(),
      words,
      ...this.readBg2(),
      cgram: this.bus.cgram.slice(),
      cell: this.r16(0x50),
      codes: [this.r8(0x44), this.r8(0x45), this.r8(0x46), this.r8(0x47)],
      error,
    };
  }

  /**
   * The game's own movement decision for the pose `runPose` just left in
   * WRAM: `rel` 0 = forward, 1 = right, 2 = back, 3 = left (`$80:C40B`,
   * `C40F`, `C413`, `C417`). True iff control reaches the accept path
   * `$80:C4AA`. Call immediately after `runPose`.
   */
  tryMove(rel: 0 | 1 | 2 | 3): boolean {
    this.moveResult = false;
    this.resetCpu();
    this.cpu.callShort(0x80c40b + rel * 4);
    return this.moveResult;
  }

  private readBg2(): { idx: Uint8Array; palNo: Uint8Array } {
    const vram = this.bus.vram;
    const idx = new Uint8Array(VIEW_W * VIEW_H);
    const palNo = new Uint8Array(VIEW_W * VIEW_H);
    for (let ty = 0; ty < 15; ty++) {
      for (let tx = 0; tx < 18; tx++) {
        const te = vram[0x7800 + (ty + 3) * 32 + (tx + 7)]!;
        const tile = te & 0x3ff;
        const pal = (te >> 10) & 7;
        const hf = (te >> 14) & 1;
        const vf = (te >> 15) & 1;
        const base = (0x2000 + tile * 16) & 0x7fff;
        for (let py = 0; py < 8; py++) {
          const row = vf ? 7 - py : py;
          const w01 = vram[(base + row) & 0x7fff]!;
          const w23 = vram[(base + 8 + row) & 0x7fff]!;
          for (let px = 0; px < 8; px++) {
            const bit = hf ? px : 7 - px;
            palNo[(ty * 8 + py) * VIEW_W + tx * 8 + px] = pal;
            idx[(ty * 8 + py) * VIEW_W + tx * 8 + px] =
              ((w01 >> bit) & 1) | (((w01 >> (8 + bit)) & 1) << 1) | (((w23 >> bit) & 1) << 2) | (((w23 >> (8 + bit)) & 1) << 3);
          }
        }
      }
    }
    return { idx, palNo };
  }
}

/** `$80:D78E`: the level's 12 region origins `{x, y}` (u16 pairs, `level*48 + region*4`). */
export function regionOrigins(rom: Uint8Array, level: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < 12; r++) {
    const o = 0x578e + level * 48 + r * 4;
    out.push({ x: rom[o]! | (rom[o + 1]! << 8), y: rom[o + 2]! | (rom[o + 3]! << 8) });
  }
  return out;
}

/**
 * Every global cell a party can stand on for `level`: the union of the
 * level's region 8x8 boxes, minus the (0,0) placeholder slots (regions
 * whose origin is exactly (0,0) are unused table entries that all shadow
 * each other -- levels 10, 11, 13). Ordered by region then row then column.
 */
export function partyCells(rom: Uint8Array, level: number): Array<{ gx: number; gy: number; region: number }> {
  const seen = new Set<string>();
  const out: Array<{ gx: number; gy: number; region: number }> = [];
  regionOrigins(rom, level).forEach((o, region) => {
    if (o.x === 0 && o.y === 0) return;
    for (let dy = 0; dy < 8; dy++) {
      for (let dx = 0; dx < 8; dx++) {
        const k = `${o.x + dx},${o.y + dy}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ gx: o.x + dx, gy: o.y + dy, region });
      }
    }
  });
  return out;
}
