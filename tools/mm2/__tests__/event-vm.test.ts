import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeEventFile } from '../event.ts';
import {
  EVENT_OPCODES,
  disassembleEventLocationScript,
  formatEventVmScript,
  lookupEventOpcode,
} from '../event-vm.ts';

describe('EVENT_OPCODES table', () => {
  it('has exactly 51 opcodes, 0x00..0x32, no gaps or duplicates', () => {
    expect(EVENT_OPCODES.length).toBe(51);
    const seen = new Set<number>();
    for (const op of EVENT_OPCODES) {
      expect(seen.has(op.opcode)).toBe(false);
      seen.add(op.opcode);
    }
    for (let i = 0; i <= 0x32; i++) expect(seen.has(i)).toBe(true);
  });

  it('lookupEventOpcode resolves known ops and rejects out-of-range ones', () => {
    expect(lookupEventOpcode(0x01)?.mnemonic).toBe('TEXT_LINE');
    expect(lookupEventOpcode(0x0c)?.mnemonic).toBe('MAP_TRANSITION');
    expect(lookupEventOpcode(0x32)?.mnemonic).toBe('TITLE_COUNT');
    expect(lookupEventOpcode(0x33)).toBeUndefined();
    expect(lookupEventOpcode(0xff)).toBeUndefined();
  });

  it('token-skip opcodes (0x10, 0x11, 0x2B) are marked var argc', () => {
    expect(lookupEventOpcode(0x10)?.argc).toBe('var');
    expect(lookupEventOpcode(0x11)?.argc).toBe('var');
    expect(lookupEventOpcode(0x2b)?.argc).toBe('var');
  });
});

describe('disassembleEventLocationScript (synthetic)', () => {
  it('splits a script blob into handler_id-indexed 0xFF-terminated segments', () => {
    // handler 0: DOOR_LABEL(1) ; handler 1: TEXT_LINE(5), END_SCRIPT
    const script = Uint8Array.from([0x04, 0x01, 0xff, 0x01, 0x05, 0x0f, 0xff]);
    const segs = disassembleEventLocationScript(script);
    expect(segs.length).toBe(2);
    expect(segs[0].clean).toBe(true);
    expect(segs[0].instructions).toEqual([{ offset: 0, opcode: 0x04, mnemonic: 'DOOR_LABEL', operands: [1] }]);
    expect(segs[1].clean).toBe(true);
    expect(segs[1].instructions).toEqual([
      { offset: 0, opcode: 0x01, mnemonic: 'TEXT_LINE', operands: [5] },
      { offset: 2, opcode: 0x0f, mnemonic: 'END_SCRIPT', operands: [] },
    ]);
  });

  it('a 0xFF byte inside an operand is not mistaken for a segment terminator', () => {
    // TEXT_LINE(0xFF) -- the string-index operand happens to be 0xFF -- then a real terminator.
    const script = Uint8Array.from([0x01, 0xff, 0xff]);
    const segs = disassembleEventLocationScript(script);
    expect(segs.length).toBe(1);
    expect(segs[0].clean).toBe(true);
    expect(segs[0].instructions).toEqual([{ offset: 0, opcode: 0x01, mnemonic: 'TEXT_LINE', operands: [0xff] }]);
  });

  it('flags an out-of-range opcode as INVALID_OP and marks the segment dirty', () => {
    const script = Uint8Array.from([0x50, 0xff]);
    const segs = disassembleEventLocationScript(script);
    expect(segs[0].clean).toBe(false);
    expect(segs[0].instructions).toEqual([{ offset: 0, opcode: 0x50, mnemonic: 'INVALID_OP', operands: [] }]);
  });

  it('marks a segment without a closing 0xFF as dirty (unterminated)', () => {
    const script = Uint8Array.from([0x0f]); // END_SCRIPT with no terminator
    const segs = disassembleEventLocationScript(script);
    expect(segs.length).toBe(1);
    expect(segs[0].clean).toBe(false);
  });

  it('formatEventVmScript renders a readable listing', () => {
    const script = Uint8Array.from([0x0c, 0x0b, 0x37, 0xff]);
    const segs = disassembleEventLocationScript(script);
    expect(formatEventVmScript(segs[0])).toBe('   0: 0c MAP_TRANSITION 0b 37');
  });
});

// Real retail data check — only runs when data/mm2/amiga/data/event.dat is present.
const EVENT_PATH = resolve('data/mm2/amiga/data/event.dat');
const hasEvent = existsSync(EVENT_PATH);

describe('event.dat real retail data', { skip: !hasEvent }, () => {
  it('every handler segment in the standard/mixed locations (0-59) disassembles clean: 0 leftover bytes, 0 invalid opcodes', () => {
    const file = decodeEventFile(readFileSync(EVENT_PATH));
    let total = 0;
    let clean = 0;
    const dirtyLocs = new Set<number>();
    for (const loc of file.locations) {
      if (loc.id > 59) continue; // 60-70 use alternate/overlay layouts (documented separately)
      if (loc.script.length === 0) continue;
      for (const seg of disassembleEventLocationScript(loc.script)) {
        total++;
        if (seg.clean) clean++;
        else dirtyLocs.add(loc.id);
      }
    }
    expect(dirtyLocs.size).toBe(0);
    expect(total).toBeGreaterThan(1000);
    expect(clean).toBe(total);
  });

  it('location 67 (Hall of Spells mixed_pool) is the one documented exception: some segments contain non-bytecode text (opcodes > 0x32)', () => {
    const file = decodeEventFile(readFileSync(EVENT_PATH));
    const loc67 = file.locations.find((l) => l.id === 67)!;
    expect(loc67.kind).toBe('mixed-pool');
    const segs = disassembleEventLocationScript(loc67.script);
    const dirty = segs.filter((s) => !s.clean);
    expect(dirty.length).toBeGreaterThan(0);
  });

  it('triplet handler_id is a direct index into the handler-script segment list (spot check: Sandsobar Beggar\'s Gift, location 4)', () => {
    // Cross-check against Vairn's own FAQ validation table (06-event-dat-format.md
    // §FAQ event validation, location 4 row): door sign "The Beggar's Gift" at
    // (y=4,x=8), and a paired trigger at (y=4,x=7) that execs selector 0x51.
    const file = decodeEventFile(readFileSync(EVENT_PATH));
    const loc4 = file.locations.find((l) => l.id === 4)!;
    const segs = disassembleEventLocationScript(loc4.script);

    const signTriplet = loc4.triplets.find((t) => t.handlerId === 42)!;
    expect(signTriplet).toBeDefined();
    expect([(signTriplet.pos >> 4) & 0xf, signTriplet.pos & 0xf]).toEqual([4, 8]); // (y,x)
    const signSeg = segs[signTriplet.handlerId];
    expect(signSeg.instructions).toEqual([{ offset: 0, opcode: 0x04, mnemonic: 'DOOR_LABEL', operands: [0x1b] }]);
    expect(loc4.strings[0x1b]).toBe("The Beggar's Gift");

    const execTriplet = loc4.triplets.find((t) => t.handlerId === 43)!;
    expect([(execTriplet.pos >> 4) & 0xf, execTriplet.pos & 0xf]).toEqual([4, 7]);
    const execSeg = segs[execTriplet.handlerId];
    const dispatch = execSeg.instructions.find((i) => i.mnemonic === 'SELECTOR_DISPATCH');
    expect(dispatch?.operands).toEqual([0x51]);
  });

  it('spot check: Middlegate Inn door label at (5,7), location 0 (matches Vairn\'s FAQ validation row)', () => {
    const file = decodeEventFile(readFileSync(EVENT_PATH));
    const loc0 = file.locations.find((l) => l.id === 0)!;
    const segs = disassembleEventLocationScript(loc0.script);
    const t = loc0.triplets.find((t) => t.handlerId === 1)!;
    expect([(t.pos >> 4) & 0xf, t.pos & 0xf]).toEqual([5, 7]);
    expect(segs[1].instructions).toEqual([{ offset: 0, opcode: 0x04, mnemonic: 'DOOR_LABEL', operands: [1] }]);
    expect(loc0.strings[1]).toBe('Middlegate Inn');
  });

  it('spot check: an outdoor map-transition script (Y/N confirm then OP_0C), location 0 handler 20', () => {
    const file = decodeEventFile(readFileSync(EVENT_PATH));
    const loc0 = file.locations.find((l) => l.id === 0)!;
    const segs = disassembleEventLocationScript(loc0.script);
    const seg = segs[20];
    const mnemonics = seg.instructions.map((i) => i.mnemonic);
    expect(mnemonics).toEqual(['TEXT_LINE', 'YN_CLEAR_COND', 'SKIP_IF_COND', 'END_SCRIPT', 'MAP_TRANSITION']);
    const transition = seg.instructions.find((i) => i.mnemonic === 'MAP_TRANSITION')!;
    expect(transition.operands.length).toBe(2);
  });
});
