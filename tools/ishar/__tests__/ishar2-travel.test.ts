/**
 * Ishar 2's travel arrival table (MAIN `+0xee6`) against the shipped MAIN.DO:
 * every `ISHAR2_TRAVEL` entry is one arm of five `cstore oimmb` writes
 * (row 0x2ab4, col 0x2ab5, region 0x2d18, zone 0x4ef2, facing 0x2ab6).
 * Also the island scene groups (MAIN `+0x16f8`) and the zone add-ons
 * (`+0x2156`/`+0x24ce`), followed through MAIN's own switches.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ISHAR2_TITLE, ISHAR2_TRAVEL, ISHAR2_ZONE_ADDONS } from '../../shared/ishar-scene.ts';
import { unpackIsharScript } from '../../shared/ishar-firstperson.ts';
import { decodeAlisInstr } from '../../shared/alis-disasm.ts';

const MAIN = 'data/ishar2/amigaaga/MAIN.DO';

describe.skipIf(!existsSync(MAIN))('Ishar 2 travel table', () => {
  const main = unpackIsharScript(new Uint8Array(readFileSync(MAIN)));
  const hex = Buffer.from(main).toString('hex');
  const store = (v: number, addr: number) => `1e00${(v & 0xff).toString(16).padStart(2, '0')}06${addr.toString(16).padStart(4, '0')}`;
  it('every destination is an arm of the +0xee6 switch', () => {
    expect(hex.slice(0xee6 * 2, 0xee6 * 2 + 8)).toBe('2f0651bf');
    for (const d of ISHAR2_TRAVEL) {
      const arm = store(d.row, 0x2ab4) + store(d.col, 0x2ab5) + store(d.region, 0x2d18) + store(d.zone, 0x4ef2) + store(d.facingRaw, 0x2ab6);
      const at = hex.indexOf(arm);
      expect(at, `selector ${d.selector}`).toBeGreaterThan(0xee6 * 2);
      expect(at).toBeLessThan(0x10aa * 2);
    }
  });

  // MAIN's own `cload` list names each script id (ids can repeat across files: VLINGE.DO and VDEC1.DO are both 81)
  const names = new Map<number, string>();
  for (let pc = 0x1658; pc < 0x2160; ) {
    const i = decodeAlisInstr(main, pc) as { op: string; end: number; fields: Record<string, unknown> };
    if (i.op === 'cload' && typeof i.fields.name === 'string') names.set(i.fields.id as number, (i.fields.name as string).replace(/\.AO$/i, '').toUpperCase());
    pc = i.end;
  }
  /** Follow MAIN's zone starters for one zone, collecting the `clive`d script names. */
  const starters = (zone: number): string[] => {
    const out: string[] = [];
    let pc = 0x2156;
    for (let n = 0; n < 300; n++) {
      const i = decodeAlisInstr(main, pc) as { op: string; end: number; fields: Record<string, any> };
      if (i.op === 'cswitch2') {
        const k = zone + i.fields.base;
        pc = k >= 0 && k <= i.fields.count ? i.fields.targets[k] : i.end;
      } else if (i.op === 'cjmp') pc = i.fields.target;
      else if (i.op === 'cret') return out;
      else if (i.op === 'ceval') {
        // the one condition in there: `zone == K` (+0x2616, DJCOL)
        const next = decodeAlisInstr(main, i.end) as { op: string; end: number; fields: Record<string, any> };
        pc = zone === i.fields.expr.steps[1].arg.value ? next.end : next.fields.target;
      } else {
        if (i.op === 'clive') out.push(names.get(i.fields.id) ?? `#${i.fields.id}`);
        pc = i.end;
      }
    }
    throw new Error('runaway');
  };
  it('the zone add-ons are what MAIN +0x2156/+0x24ce start for every zone', () => {
    for (let zone = 1; zone <= 60; zone++) expect(starters(zone), `zone ${zone}`).toEqual(ISHAR2_ZONE_ADDONS[zone] ?? []);
  });
  it('the region groups are what MAIN +0x16f8 starts', () => {
    const sw = decodeAlisInstr(main, 0x16f8) as { op: string; fields: Record<string, any> };
    expect(sw.op).toBe('cswitch2');
    for (let region = 1; region <= 7; region++) {
      const k = region + sw.fields.base;
      const got: string[] = [];
      if (k >= 0 && k <= sw.fields.count) {
        for (let pc = sw.fields.targets[k]; ; ) {
          const i = decodeAlisInstr(main, pc) as { op: string; end: number; fields: Record<string, any> };
          if (i.op === 'cjmp' || i.op === 'cret') break;
          if (i.op === 'clive') got.push(names.get(i.fields.id)!);
          pc = i.end;
        }
      }
      // in MAIN's `clive` order (the entity order the scripts run and tie in)
      expect(got, `region ${region}`).toEqual(ISHAR2_TITLE.sceneGroup(region)?.scripts ?? []);
    }
  });
});
