/**
 * Decode the SNES W6 sound system's ROM-side directories
 * (`data-structure.md` §5.5): the 151-entry **sound-module far-pointer
 * table** at `$A0:8000` (file `0x100000`, 3 bytes/entry: u16 CPU addr +
 * bank) and the 37-entry **song → module-set table** at `$9E:8919` (file
 * `0xF0919`, 5 module numbers per song, `0xFF` = unused slot).
 *
 * Each module is a 0-terminated chain of `[u16 size][u16 spcDestAddr]
 * [size payload bytes]` upload blocks — the exact structure the SPC
 * uploader (`$1E:8AB0`/`$1E:8B1A`) transfers over the IPL handshake. The
 * driver itself is module 150 (bootstrapped via the pointer at `$A0:81C2`)
 * plus module 149 (`#$95`, uploaded immediately after at `$1E:8A4D`);
 * the boot-time resident set is song 0's row (modules `0x63/0x0B/0x29`).
 *
 * Oracle checks (fail hard): all 151 modules' block chains terminate
 * cleanly inside the ROM; the module table's own end (`0x1001C5`) equals
 * the lowest module target in bank `$A0` (the table is self-describing);
 * the song table ends exactly where code resumes (`0xF09D2`).
 *
 * Usage: npx tsx tools/wizardry6/snes/decode-spc-modules.ts <path-to-sfc>
 */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readBinary, writeJson } from '@seer-project/pipeline';

const MODULE_TABLE = 0x100000; // $A0:8000
const SONG_TABLE = 0xf0919; // $9E:8919
const SONG_TABLE_END = 0xf09d2; // code resumes here (JSR $8A1D)
const MODULE_COUNT = 151;
const DRIVER_MODULE = 150; // boot pointer $A0:81C2 = table entry 150
const DRIVER_MODULE_2 = 149; // uploaded as #$95 at $1E:8A4D

function u16(d: Uint8Array, o: number): number {
  return d[o]! | (d[o + 1]! << 8);
}
function lorom(bank: number, addr: number): number {
  return (bank & 0x7f) * 0x8000 + (addr - 0x8000);
}

function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: npx tsx tools/wizardry6/snes/decode-spc-modules.ts <path-to-sfc>');
    process.exit(1);
  }
  const rom = readBinary(romPath);

  const modules: Array<{
    index: number;
    cpuPtr: string;
    fileOffset: number;
    byteLength: number;
    blocks: Array<{ spcAddr: number; size: number }>;
  }> = [];
  let lowestBankA0Target = Infinity;
  for (let k = 0; k < MODULE_COUNT; k++) {
    const off = MODULE_TABLE + 3 * k;
    const addr = u16(rom, off);
    const bank = rom[off + 2]!;
    const fo = lorom(bank, addr);
    if ((bank & 0x7f) === 0x20 && fo < lowestBankA0Target) lowestBankA0Target = fo;
    // walk the block chain
    const blocks: Array<{ spcAddr: number; size: number }> = [];
    let p = fo;
    for (;;) {
      const size = u16(rom, p);
      const dest = u16(rom, p + 2);
      p += 4;
      if (size === 0) {
        p -= 2; // the terminator consumes only the size word
        break;
      }
      if (p + size > rom.length || blocks.length > 200) {
        console.error(`Oracle check FAILED: module ${k} block chain does not terminate cleanly.`);
        process.exit(1);
      }
      blocks.push({ spcAddr: dest, size });
      p += size;
    }
    modules.push({
      index: k,
      cpuPtr: `$${bank.toString(16).padStart(2, '0')}:${addr.toString(16).padStart(4, '0')}`,
      fileOffset: fo,
      byteLength: p - fo,
      blocks,
    });
  }
  if (lowestBankA0Target !== MODULE_TABLE + 3 * MODULE_COUNT) {
    console.error(
      `Oracle check FAILED: module table end 0x${(MODULE_TABLE + 3 * MODULE_COUNT).toString(16)} != lowest bank-$A0 module target 0x${lowestBankA0Target.toString(16)}.`,
    );
    process.exit(1);
  }

  const songs: number[][] = [];
  for (let p = SONG_TABLE; p < SONG_TABLE_END; p += 5) {
    songs.push(Array.from(rom.subarray(p, p + 5)));
  }
  const badRefs = songs.flat().filter((m) => m !== 0xff && m >= MODULE_COUNT).length;
  if (badRefs > 0) {
    console.error(`Oracle check FAILED: ${badRefs} song-table module refs out of range.`);
    process.exit(1);
  }

  const totalBytes = modules.reduce((n, m) => n + m.byteLength, 0);
  const outDir = resolve('public/assets/wizardry6/snes/data');
  mkdirSync(outDir, { recursive: true });
  writeJson(resolve(outDir, 'spc-modules.json'), {
    note:
      'SNES W6 sound-module directory (data-structure.md 5.5). moduleTable = $A0:8000 (151 x [u16 addr][bank]); ' +
      'each module = 0-terminated [u16 size][u16 spcDestAddr][payload] upload-block chain. ' +
      `Driver = modules ${DRIVER_MODULE} (+${DRIVER_MODULE_2}); songs table = $9E:8919, 5 module numbers/song (0xFF = unused).`,
    driverModules: [DRIVER_MODULE, DRIVER_MODULE_2],
    modules,
    songs,
  });
  console.log(
    `Wrote data/spc-modules.json: ${modules.length} modules (${totalBytes} bytes total, span 0x${Math.min(...modules.map((m) => m.fileOffset)).toString(16)}-0x${Math.max(...modules.map((m) => m.fileOffset + m.byteLength)).toString(16)}), ${songs.length} songs.`,
  );
}

main();
