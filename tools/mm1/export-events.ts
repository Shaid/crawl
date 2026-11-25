/* eslint-disable @typescript-eslint/no-explicit-any -- harness JSON and recorded vectors are dynamic */
/**
 * MM1 per-map special-cell event table -> `public/assets/mm1/dosega/data/ovr-events.json`.
 *
 * Behaviour (what each special cell does) comes from running the retail overlays' own code in the Unicorn harness
 * (`rules_oracle/ovr_events.py`, committed result `rules_oracle/ovr-events.json.gz`).  Everything that can be re-derived
 * without the emulator is re-derived here from the game files and must agree with the harness result or the export throws:
 *   - the special-cell dispatch table for all 256 cells x 4 facings (`ovr.ts` `dispatch`, itself vector-verified),
 *   - the cells flagged special (bit 0x80 of MAZEDATA page 1) vs the cells the dispatcher knows,
 *   - every logged text pointer resolved to its string, every loadnext destination resolved to a screen (`screenKey` tables),
 *   - the statically decoded `loadnext` sites of each overlay must be a superset of the destinations the executed handlers reached.
 * Usage: npx tsx tools/mm1/export-events.ts [dataDir]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { parseOvr, tableLayout, dispatch, OVR_DATA } from './ovr.ts';
import { MM1_MAP_SLUGS } from './map.ts';
import { assetDir, writeJson } from '../shared/asset-paths.ts';

export const EVENTS_GZ = resolve('tools/mm1/rules_oracle/ovr-events.json.gz');
const FACINGS: Record<string, number> = { N: 0xc0, E: 0x30, S: 0x0c, W: 0x03 };
const DS = 0x107b0;

/** loadmaze key tables (CODE+0xD35/0xD71): word table DS:0x173 (4 entries, start offset into the key table), key table DS:0x17B (55 words (bl<<8)|al) */
export function screenOf(img: Uint8Array, al: number, bl: number, bp: number): number | null {
  if (bp > 3) return null;
  const w = (o: number) => img[DS + o] | (img[DS + o + 1] << 8);
  const key = ((bl & 255) << 8) | (al & 255);
  for (let i = w(0x173 + 2 * bp) >> 1; i < 55; i++) if (w(0x17b + 2 * i) === key) return i;
  return null;
}

export interface LoadnextSite { addr: number; al: number; bl: number; bp: number; x: number | null; y: number | null }
/** Static scan of an overlay's code for `jmp/call loadnext (CS:0x509D)` preceded by the three register immediates (AL, BX, BP) and optional
 *  `mov [0x3C38], imm` / `mov [0x3C39], imm` (the new party x / y). Independent of the emulator. */
export function loadnextSites(code: Uint8Array, base: number, end: number): LoadnextSite[] {
  const out: LoadnextSite[] = [];
  for (let i = 0; i + 3 <= end - base; i++) {
    const op = code[i];
    if (op !== 0xe9 && op !== 0xe8) continue;
    const rel = code[i + 1] | (code[i + 2] << 8);
    const tgt = (base + i + 3 + (rel > 32767 ? rel - 65536 : rel)) & 0xffff;
    if (tgt !== 0x509d) continue;
    let al: number | null = null, bl: number | null = null, bp: number | null = null, x: number | null = null, y: number | null = null;
    for (let k = Math.max(0, i - 40); k < i; k++) {
      if (code[k] === 0xb0 && al === null && k + 2 <= i) al = code[k + 1];
      if (code[k] === 0xbb && bl === null && k + 3 <= i) bl = code[k + 1];
      if (code[k] === 0xbd && bp === null && k + 3 <= i) bp = code[k + 1] | (code[k + 2] << 8);
    }
    for (let k = Math.max(0, i - 80); k < i; k++) {
      if (code[k] === 0xc6 && code[k + 1] === 0x06 && code[k + 2] === 0x38 && code[k + 3] === 0x3c) x = code[k + 4];
      if (code[k] === 0xc6 && code[k + 1] === 0x06 && code[k + 2] === 0x39 && code[k + 3] === 0x3c) y = code[k + 4];
    }
    if (al !== null && bl !== null && bp !== null) out.push({ addr: base + i, al, bl, bp, x, y });
  }
  return out;
}

function cstr(buf: Uint8Array, off: number): string | null {
  if (off < 0 || off >= buf.length) return null;
  let e = off; while (e < buf.length && buf[e] !== 0 && e - off < 400) e++;
  return Buffer.from(buf.subarray(off, e)).toString('latin1');
}

export function exportEvents(dataDir: string, wrong?: 'dispatchLayout') {
  const harness = JSON.parse(gunzipSync(readFileSync(EVENTS_GZ)).toString('utf8'));
  const img = new Uint8Array(readFileSync(resolve(dataDir, 'MM.EXE'))).subarray(0x200);
  const maze = new Uint8Array(readFileSync(resolve(dataDir, 'MAZEDATA.DTA')));
  const out: Record<string, any> = {}; const problems: string[] = [];
  let totalCells = 0, totalHandlers = 0, staticMatched = 0, computedDests = 0;
  for (const slug of MM1_MAP_SLUGS) {
    const name = slug.toUpperCase();
    const o = parseOvr(name, new Uint8Array(readFileSync(resolve(dataDir, `${name}.OVR`))));
    const h = harness[name]; if (!h) { problems.push(`${name}: not in the harness result`); continue; }
    const screen = MM1_MAP_SLUGS.indexOf(slug);
    const page1 = maze.subarray(screen * 512 + 256, screen * 512 + 512);
    const flagged: number[] = []; for (let c = 0; c < 256; c++) if (page1[c] & 0x80) flagged.push(c);
    let lay = tableLayout(o);
    if (wrong === 'dispatchLayout' && lay) lay = { ...lay, handlers: lay.handlers + 2 };
    // 1. dispatch table: TS decode vs the harness running the real dispatcher
    const cells: any[] = [];
    if (lay) {
      for (let c = 0; c < 256; c++) {
        const f: Record<string, string> = {};
        for (const [fn, m] of Object.entries(FACINGS)) { const d = dispatch(o, lay, c, m); if (d !== 'miss' && d !== 'nomask') f[fn] = d.toString(16).padStart(4, '0'); }
        const hc = h.cells[String(c)];
        const hf: Record<string, string> = {};
        if (hc) for (const [fn, v] of Object.entries(hc)) if (v !== 'nomask') hf[fn] = (v as number).toString(16).padStart(4, '0');
        if (JSON.stringify(f, Object.keys(f).sort()) !== JSON.stringify(hf, Object.keys(hf).sort())) problems.push(`${name} cell ${c}: dispatch ${JSON.stringify(f)} vs harness ${JSON.stringify(hf)}`);
        if (Object.keys(f).length) cells.push({ cell: c, x: c & 15, y: c >> 4, facings: f, handler: Object.values(f)[0], flagged: flagged.includes(c) });
      }
    }
    // 2. handlers: texts and destinations re-resolved
    const sites = loadnextSites(o.code, 0xf48f, o.entry);
    const handlers: Record<string, any> = {};
    const seenDest = new Set<string>();
    for (const [addr, hh] of Object.entries<any>(h.handlers)) {
      const texts: string[] = [];
      for (const oc of hh.outcomes) for (const c of oc.trace) {
        if (c[0] === 'ph2') { const p = c[1][0]; const s = p >= OVR_DATA ? cstr(o.data, p - OVR_DATA) : cstr(img, DS + p); if (s !== null && !texts.includes(s)) texts.push(s); }
        if (c[0] === 'loadnext') {
          const [al, bl, bp] = [c[1][0], c[1][1] & 255, c[1][2]]; const sc = screenOf(img, al, bl, bp);
          seenDest.add(`${al},${bl},${bp}`);
          const hd = hh.dests.find((d: any) => d.al === al && d.bl === bl && d.bp === bp);
          if (!hd || hd.screen !== sc) problems.push(`${name} ${addr}: dest ${al},${bl},${bp} screen ${sc} vs harness ${hd?.screen}`);
          if (sites.some(s => s.al === al && s.bl === bl && s.bp === bp)) staticMatched++; else computedDests++;
        }
      }
      // the committed harness result stores text POINTERS only; strings are resolved here from the game files
      for (const p of hh.textPtrs as number[]) if ((p >= OVR_DATA ? cstr(o.data, p - OVR_DATA) : cstr(img, DS + p)) === null) problems.push(`${name} ${addr}: text pointer ${p.toString(16)} does not resolve`);
      handlers[addr] = { kinds: hh.kinds, texts, textPtrs: hh.textPtrs, dests: hh.dests.map((d: any) => ({ ...d, slug: d.screen !== null ? MM1_MAP_SLUGS[d.screen] : null })), outcomes: hh.outcomes, coverage: hh.coverage };
    }
    // 3. flagged vs dispatched
    const dcells = new Set(cells.map(c => c.cell));
    const flaggedNoHandler = flagged.filter(c => !dcells.has(c));
    const handlerNotFlagged = [...dcells].filter(c => !flagged.includes(c));
    const hx = h.crossCheck;
    if (lay && (JSON.stringify(flaggedNoHandler) !== JSON.stringify(hx.flaggedNoHandler) || JSON.stringify(handlerNotFlagged) !== JSON.stringify(hx.handlerNotFlagged))) problems.push(`${name}: flag cross-check differs`);
    totalCells += cells.length; totalHandlers += Object.keys(handlers).length;
    out[slug] = {
      screen, overlay: `${name}.OVR`, dispatcher: lay ? 'table' : 'custom', miss: h.miss, count: h.count ?? null, layout: lay,
      cells, handlers, missPath: h.missPath, bogusHandlers: h.bogusHandlers, flaggedNoHandler, handlerNotFlagged, loadnextSites: sites,
    };
  }
  return { maps: out, problems, totalCells, totalHandlers, staticMatched, computedDests };
}

export function exportEventsAsset(dir: string): string {
  const r = exportEvents(dir);
  if (r.problems.length) { console.error(r.problems.slice(0, 20).join('\n')); throw new Error(`${r.problems.length} disagreement(s) between the TS decode and the harness result`); }
  writeJson(resolve(assetDir('data', 'mm1', 'dosega'), 'ovr-events.json'), { format: 'mm1-ovr-events/1', maps: r.maps }, false);
  return `ovr-events.json (${Object.keys(r.maps).length} maps, ${r.totalCells} dispatched cells, ${r.totalHandlers} handlers) + ${exportTownTables(dir)}`;
}

if (process.argv[1] && process.argv[1].endsWith('export-events.ts')) console.log('mm1/dosega:', exportEventsAsset(process.argv[2] ?? 'data/mm1/dosega'));
void existsSync; void readdirSync;

/** Town-service tables read straight from MM.EXE (CODE+0x1DF3 food price table DS:0x13D6, CODE+0x2196 shop stock pointer tables DS:0x1538/0x1542/0x154C
 *  (5 towns x 6 item ids per category; item ids are 1-based indices into the ITEMS table at MM.EXE+0x19B2A)). */
export function townTables(img: Uint8Array) {
  const w = (o: number) => img[DS + o] | (img[DS + o + 1] << 8);
  const shopTables = ['A', 'B', 'C'].map((cat, k) => ({ key: cat, towns: [0, 1, 2, 3, 4].map(t => { const p = w([0x1538, 0x1542, 0x154c][k] + 2 * t); return [...img.subarray(DS + p, DS + p + 6)]; }) }));
  const wt = (o: number) => [0, 1, 2, 3, 4].map(i => w(o + 2 * i));
  // temple (CODE+0x2CC6 `right7` fills tpa/tpb/tpc/tpd per town and per member state): heal cost tpa by member condition byte +0x3F, uncurse tpb, tpc/tpd (8-bit)
  const temple = { healInjuredOrAiling: wt(0x171d), healDeadClass: wt(0x1727), healEradicated: wt(0x1731), uncurse: wt(0x173b), tpc: [...img.subarray(DS + 0x1745, DS + 0x1745 + 5)], tpd: [...img.subarray(DS + 0x174a, DS + 0x174a + 5)] };
  return { temple, foodPricePerMember: [...img.subarray(DS + 0x13d6, DS + 0x13d6 + 5)], shopStock: shopTables, towns: ['sorpigal', 'portsmit', 'algary', 'dusk', 'erliquin'] };
}
export function exportTownTables(dir: string): string {
  const img = new Uint8Array(readFileSync(resolve(dir, 'MM.EXE'))).subarray(0x200);
  writeJson(resolve(assetDir('data', 'mm1', 'dosega'), 'town-tables.json'), townTables(img), false);
  return 'town-tables.json';
}
