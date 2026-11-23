/** Interpreter for the token language of tools/blackcrypt/rules_oracle/oracle_move.c (mode `gen`) against the TS port. */
import { BcRng } from './rules';
import { MoveWorld, enterTest, wallMask, pathfind, adjacent, pickDirection, moveMonster, ray, monsterAct, activationScan, pursue, approach, wander, type PathResult, type MoveCall } from './rules-move';

const rngHex = (r: BcRng) => (r as any).s.map((b: number) => b.toString(16).padStart(2, '0')).join('');

const callStr = (l: MoveCall) => {
  switch (l.fn) {
    case 'openDoor': return ` |openDoor ${l.x} ${l.y}`;
    case 'damage': return ` |damage ${l.ch} ${l.dmg} ${l.kind} ${l.flag}`;
    case 'sched': return ' |sched';
    case 'hold': return ` |hold ${l.n}`;
    case 'special': return ` |special ${l.bit}`;
    case 'ev': return ` |ev ${l.type} ${l.due} ${l.x} ${l.y} ${l.id}`;
  }
};

/** Interprets the same token language as `oracle_move gen`, against the TS port. `perturb` is the null control. */
export function interpret(line: string, perturb = false): string {
  const tk = line.split(' ');
  const w = new MoveWorld();
  const Ab = new Map<number, number>(); // A4-relative bytes (party / formation / counters)
  const rb = (o: number) => Ab.get(o) ?? 0;
  const rw = (o: number) => (rb(o) << 8) | rb(o + 1);
  const rws = (o: number) => (rw(o) << 16) >> 16;
  let rng = new BcRng('2d14ca6659af');
  const out: string[] = [];
  const n = (k: number) => Number(tk[k]);
  let i = 0;
  const pathStr = (name: string, r: PathResult) => {
    const l = [...r.list, 0, 0, 0, 0].slice(0, 4);
    return `${name}: ${r.result} ${r.dirMask} ${r.result === 3 && name === 'path' ? 0 : r.dist} n ${r.list.length} [${l.join(' ')}]`;
  };
  while (i < tk.length) {
    const c = tk[i];
    if (c === 'seed') { rng = new BcRng(tk[i + 1]); i += 2; }
    else if (c === 'c') { w.setCell(n(i + 1), n(i + 2), parseInt(tk[i + 3], 16)); i += 4; }
    else if (c === 'W') { w.setW(n(i + 1), n(i + 2), n(i + 3)); i += 4; }
    else if (c === 'B') { w.setB(n(i + 1), n(i + 2), n(i + 3)); i += 4; }
    else if (c === 'AW') { const o = n(i + 1), v = n(i + 2) & 0xffff; Ab.set(o, v >> 8); Ab.set(o + 1, v & 0xff); if (o === 0x1742) w.party.x = v + (perturb ? 1 : 0); if (o === 0x1740) w.party.y = v; i += 3; }
    else if (c === 'AB') { Ab.set(n(i + 1), n(i + 2) & 0xff); i += 3; }
    else if (c === 'enter') { out.push(`enter ${enterTest(w, n(i + 1), n(i + 2), n(i + 3), n(i + 4), n(i + 5))}`); i += 6; }
    else if (c === 'wmask') { out.push(`wmask ${wallMask(w, n(i + 1), n(i + 2), n(i + 3))}`); i += 4; }
    else if (c === 'path' || c === 'adj') {
      const f = c === 'path' ? pathfind : adjacent;
      const lim = perturb ? 0 : 0;
      void lim;
      out.push(pathStr(c, f(w, n(i + 1), n(i + 2), n(i + 3), n(i + 4) + (perturb ? 1 : 0), n(i + 5))));
      i += 6;
    }
    else if (c === 'pick') {
      const cnt = rb(0x1E8E); const list = [0, 1, 2, 3].slice(0, cnt).map((k) => rb(0x1E8A + k));
      pickDirection(w, n(i + 1), list, rng); i += 2;
    }
    else if (c === 'mover') {
      const pos = { x: n(i + 2), y: n(i + 3) };
      const r = moveMonster(w, n(i + 1), pos, rng);
      out.push(`mover ${r} x ${pos.x} y ${pos.y}`); i += 4;
    }
    else if (c === 'scan') { activationScan(w, ((rw(0x1750) << 16) | rw(0x1752)) >>> 0, rng); out.push('scan'); i++; }
    else if (c === 'ray') {
      const r = ray(w, n(i + 1), n(i + 2), n(i + 3), n(i + 4), n(i + 5), n(i + 6));
      out.push(`ray ${r.steps} x ${r.x} y ${r.y} hit ${r.hit} blk ${r.blocked}`); i += 7;
    }
    else if (c === 'pursue' || c === 'approach' || c === 'wander') {
      const pos = { x: n(i + 2), y: n(i + 3) };
      w.lastDist = rb(0x1E91);
      const chars = [0, 1, 2, 3].map((k) => { const b = 0x1758 + 0xA8 * k; return { hp: rws(b + 0x4E), ac: rb(b + 0x62), res: rb(b + 0x69), shield: rb(b + 0x83), ice: rb(b + 0x8D), fire: rb(b + 0x8E) }; });
      const env = { party: { x: w.party.x, y: w.party.y, facing: rw(0x1744) }, form: [0, 1, 2, 3].map((k) => rw(0x1E74 + 2 * k)), chars, lastDist: w.lastDist, stackJunk: 0 };
      const r = c === 'pursue' ? pursue(w, n(i + 1), pos, n(i + 4), env, rng) : c === 'approach' ? approach(w, n(i + 1), pos, n(i + 4), env, rng) : wander(w, n(i + 1), pos, rng);
      out.push(`${c} ${r} x ${pos.x} y ${pos.y}`); i += c === 'wander' ? 4 : 5;
    }
    else if (c === 'act') {
      const pos = { x: n(i + 2), y: n(i + 3) };
      const chars = [0, 1, 2, 3].map((k) => { const b = 0x1758 + 0xA8 * k; return { hp: rws(b + 0x4E), ac: rb(b + 0x62), res: rb(b + 0x69), shield: rb(b + 0x83), ice: rb(b + 0x8D), fire: rb(b + 0x8E) }; });
      const env = { party: { x: w.party.x, y: w.party.y, facing: rw(0x1744) }, form: [0, 1, 2, 3].map((k) => rw(0x1E74 + 2 * k)), chars, lastDist: rb(0x1E91), stackJunk: 0 };
      const r = monsterAct(w, n(i + 1), pos, n(i + 4), n(i + 5), env, rng);
      out.push(`act ${r.ret} out ${r.out} x ${pos.x} y ${pos.y}`); i += 6;
    }
    else if (c === 'dc') { out.push(`c${w.cell(n(i + 1), n(i + 2)).toString(16)}`); i += 3; }
    else if (c === 'dw') { out.push(`w${w.w(n(i + 1), n(i + 2))}`); i += 3; }
    else if (c === 'db') { out.push(`b${w.b(n(i + 1), n(i + 2))}`); i += 3; }
    else if (c === 'log') { out.push(`log ${w.log.length}` + w.log.map(callStr).join('')); i++; }
    else if (c === 'seedout') { out.push(`seed ${rngHex(rng)}`); i++; }
    else throw new Error('token ' + c);
  }
  return out.join(' ');
}

/** Normalises an oracle line to the port's comparable form (drops hook-log details). */
export function norm(o: string, scan = false): string {
  // map the oracle's hook log to the port's call list; the redraw hooks (+0x8388, +0x825C) are cosmetic and dropped
  return o.replace(/log (\d+)((?: \|[0-9a-f]+(?:,\d+)*)*)/, (_m, _cnt, rest) => {
    const calls: string[] = [];
    for (const e of (rest.match(/\|[0-9a-f]+(?:,\d+)*/g) ?? []) as string[]) {
      const [off, ...a] = e.slice(1).split(',');
      if (off === '9056') calls.push(`openDoor ${a[0]} ${a[1]}`);
      else if (off === '17686') calls.push(`damage ${a[0]} ${a[1]} ${a[2]} ${a[3]}`);
      else if (off === '5ea') calls.push(scan ? `ev ${Number(a[0]) >> 8} ${((Number(a[1]) << 16) | Number(a[2])) >>> 0} ${Number(a[3]) >> 8} ${Number(a[4]) >> 8} ${a[7]}` : 'sched');
      else if (off === '58fa') calls.push(`hold ${a[0]}`);
      else if (off === '98a8') calls.push(`special ${a[3]}`);
    }
    return `log ${calls.length}` + calls.map((c) => ' |' + c).join('');
  }).trim().replace(/\s+/g, ' ');
}
