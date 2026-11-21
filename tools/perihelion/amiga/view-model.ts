/**
 * Perihelion (Amiga) first-person dungeon view: pure renderer + movement rules, shared by the
 * walker view (tools/walker/games-perihelion.ts), the exporter, the frame renderer and the tests.
 * Written from the main program's own code (runtime addresses, image loaded at $80000; spec
 * docs/perihelion/amiga/data-structure.md "First-person dungeons"):
 *
 *   $C26B2  copies the 7x7 cells around the party into the window $C28D2, rotated so that window
 *           +7 is one cell forward and +1 is one cell to the LEFT; returns A0 = $C28EA (the party's
 *           cell). Facing ($F2C0E) 0 = +y, 1 = -x, 2 = -y, 3 = +x; `$C2640` step deltas, `$C21DA`
 *           turn left = facing-1, `$C2202` turn right = facing+1.
 *   $C2A2E  view entry: clears the 432x120 view buffer ($1BAE8, 54 B x 5 planes per row; the
 *           176-px view starts 16 bytes in, at $1BAF8), sets the checkerboard parity
 *           $C3426 = (x ^ y ^ facing) & 1, then runs one of two composers:
 *   $C2A94  "far" composer (dungeons 2-5): background, then cells up to 3 ahead and 2 aside,
 *           through 15 slot bytes $C2F90..$C2F9E with its own occlusion rules; masked pieces.
 *   $C2FA0  "near" composer (dungeon 1, the inner city): left / centre / right panels from the
 *           cells 1-2 ahead, opaque pieces from a 416-px atlas.
 * The leaf routines (one per slot/cell-type) are decoded from the program by the exporter
 * (`decodeLeaf` in exe.ts) and handed in as `leaves`, keyed by address.
 */

export const VIEW_W = 176;
export const VIEW_H = 120;
/** view buffer is 432 px wide; the visible 176 px start at x = 128 (16 bytes in) */
export const BUF_W = 432;
export const BUF_X0 = 128;

/** cell values (map bytes): 0 floor, 1 wall, 2 closed door, 3 open door, 4/5 ladder walls, 6 exit */
export const CELL = { FLOOR: 0, WALL: 1, DOOR_CLOSED: 2, DOOR_OPEN: 3, LADDER_A: 4, LADDER_B: 5, EXIT: 6 } as const;

export type GameFacing = 0 | 1 | 2 | 3;
/** forward vector per game facing ($C2640 / $C2678 step routines) */
export const FWD: ReadonlyArray<readonly [number, number]> = [[0, 1], [-1, 0], [0, -1], [1, 0]];
/** window +1 (left) per game facing, from the $C26F4 / $C271C / $C2758 / $C2786 copy loops */
export const LEFT: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export interface PeriMap { width: number; height: number; cells: number[] }
export interface Piece { sx: number; sy: number; w: number; h: number }
export interface Dest { dx: number; dy: number }
export type Blit = [piece: number, dest: number, mirror: number, masked: number];
export interface Leaf { p0: Blit[]; p1: Blit[] }
export interface Atlas { w: number; h: number; px: Uint8Array }
export interface Composer { pieces: Piece[]; dests: Dest[] }
export interface ViewData {
  kind: 'far' | 'near';
  atlas: Atlas;
  composer: Composer;
  leaves: Record<string, Leaf>;
}

/** Cells outside the grid read as wall (the game reads whatever bytes lie beside the grid). */
export function cellAt(m: PeriMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return CELL.WALL;
  return m.cells[y * m.width + x]!;
}

/** Window accessor: `w(o)` = the byte at window offset `o` from the party's cell, o = 7*fwd + left. */
export function windowOf(m: PeriMap, x: number, y: number, facing: GameFacing): (o: number) => number {
  const [fx, fy] = FWD[facing]!, [lx, ly] = LEFT[facing]!;
  return (o: number) => {
    const f = Math.round(o / 7), l = o - 7 * f;
    return cellAt(m, x + f * fx + l * lx, y + f * fy + l * ly);
  };
}

const s8 = (v: number) => (v & 0x80 ? (v & 0xff) - 0x100 : v & 0xff);

/** Leaf addresses the far composer calls, in the order of the $C2A94 code (for the exporter). */
export const FAR_LEAVES = [
  0xc3d72, 0xc4014, 0xc3e8a, 0xc408c, 0xc42c6, 0xc430c, 0xc3b88, 0xc3ab6,
  0xc3db8, 0xc4032, 0xc424e, 0xc450e, 0xc3dfe, 0xc4050, 0xc426c, 0xc452c, 0xc40aa, 0xc40f0,
  0xc3e44, 0xc406e, 0xc454a, 0xc3b42, 0xc3a70, 0xc3ca0, 0xc3fba, 0xc41d6, 0xc4496,
  0xc3ce6, 0xc3fd8, 0xc41f4, 0xc44b4, 0xc3d2c, 0xc3ff6, 0xc4212, 0xc44d2, 0xc3afc, 0xc3a2a,
  0xc3bce, 0xc3ed0, 0xc4136, 0xc4352, 0xc43f4, 0xc3c14, 0xc4586, 0xc3f3c, 0xc4154, 0xc43be, 0xc4460,
  0xc3c5a, 0xc3f06, 0xc41b8, 0xc4388, 0xc442a,
];
/** Leaf addresses of the near composer ($C2FA0). */
export const NEAR_LEAVES = [
  0xc3960, 0xc3528, 0xc3546, 0xc38a2, 0xc35f0, 0xc38e8, 0xc3906, 0xc3924, 0xc3942, 0xc3564, 0xc35aa,
  0xc3636, 0xc3672, 0xc36fe, 0xc3654, 0xc36b8, 0xc3744, 0xc3816, 0xc378a, 0xc385c, 0xc37d0,
];
export const leafKey = (a: number) => a.toString(16);

/** Front-face leaf per cell type 1..5 for one far slot (the `CMPI.B #2..#5` ladders). */
type FrontRow = readonly [one: number, two: number, three: number, four: number, five: number];

/**
 * $C2A94: far composer as a list of leaf calls (plus the background blit). `w` is the window.
 * Returns leaf addresses in draw order; -1 stands for the background (piece 0 at dest 0, opaque,
 * mirrored when parity is 0 — `$C2AB4` copies $C3426 and flips it).
 */
export function farCalls(w: (o: number) => number): number[] {
  const calls: number[] = [-1];
  const pos = (o: number) => s8(w(o)) > 0;
  // $C2AE2 / $C2B0C: two-left and two-right of the third row (1 wall, 2 closed door, else nothing)
  if (pos(0x17)) { if (w(0x17) === 2) calls.push(0xc4014); else if (w(0x17) < 3) calls.push(0xc3d72); }
  if (pos(0x13)) { if (w(0x13) === 2) calls.push(0xc408c); else if (w(0x13) < 3) calls.push(0xc3e8a); }
  // $C2B36 / $C2B40: two-left / two-right of the second row (any solid-ish value)
  if (pos(0x10)) calls.push(0xc42c6);
  if (pos(0x0c)) calls.push(0xc430c);
  // $C2B4A..$C2C66: fill the slot bytes
  const S = new Uint8Array(15); // S[k] = $C2F90 + k
  const take = (o: number, k: number) => { if (pos(o)) S[k] = w(o); };
  take(-1, 9); take(1, 12);
  let skipFar = false;
  if (pos(7)) { S[7] = w(7); if (w(7) === 1) skipFar = true; }
  if (!skipFar) {
    take(6, 10); take(8, 13);
    if (pos(0x0e)) { S[4] = w(0x0e); if (w(0x0e) === 1) skipFar = true; }
    if (!skipFar) { take(0x0d, 11); take(0x0f, 14); take(0x15, 1); }
  }
  // right-hand fronts ($C2BD8): only the nearest visible of row 1 / 2 / 3 is taken
  {
    let at: 'c2bf0' | 'c2c00' | 'c2c18' | 'done' = 'c2bf0';
    if (w(-1) !== 1) { if (pos(6)) { S[8] = w(6); at = 'c2c18'; } }
    else at = w(6) !== 1 ? 'c2bf0' : 'c2c18';
    if (at === 'c2c18') at = w(0x0d) !== 1 ? 'c2c00' : 'done';
    if (at === 'c2bf0') { if (pos(0x0d)) { S[5] = w(0x0d); at = 'done'; } else at = 'c2c00'; }
    if (at === 'c2c00') { if (pos(0x14)) S[2] = w(0x14); }
  }
  // left-hand fronts ($C2C20), mirror image of the above
  {
    let at: 'c2c38' | 'c2c48' | 'c2c60' | 'done' = 'c2c38';
    if (w(1) !== 1) { if (pos(8)) { S[6] = w(8); at = 'c2c60'; } }
    else at = w(8) !== 1 ? 'c2c38' : 'c2c60';
    if (at === 'c2c60') at = w(0x0f) !== 1 ? 'c2c48' : 'done';
    if (at === 'c2c38') { if (pos(0x0f)) { S[3] = w(0x0f); at = 'done'; } else at = 'c2c48'; }
    if (at === 'c2c48') { if (pos(0x16)) S[0] = w(0x16); }
  }
  const front = (v: number, row: FrontRow) => {
    if (v === 0 || v > 5) return; // tst.b / beq, then bgt past #5
    calls.push(row[v - 1]!);
  };
  if (S[11] === 1) calls.push(0xc3b88);
  if (S[14] === 1) calls.push(0xc3ab6);
  front(S[0]!, [0xc3db8, 0xc4032, 0xc424e, 0xc450e, 0xc450e]);
  if (S[1]! >= 1 && S[1]! <= 5) front(S[1]!, [0xc3dfe, 0xc4050, 0xc426c, 0xc452c, 0xc452c]);
  else {
    // $C2D1E (also the `BGT` target for values above 5): the third-row cell's side faces where
    // its neighbours are non-zero (TST, not >0)
    if (w(0x16) & 0xff) calls.push(0xc40aa);
    if (w(0x14) & 0xff) calls.push(0xc40f0);
  }
  front(S[2]!, [0xc3e44, 0xc406e, 0xc408c, 0xc454a, 0xc454a]);
  if (S[10] === 1) calls.push(0xc3b42);
  if (S[13] === 1) calls.push(0xc3a70);
  front(S[3]!, [0xc3ca0, 0xc3fba, 0xc41d6, 0xc4496, 0xc4496]);
  front(S[4]!, [0xc3ce6, 0xc3fd8, 0xc41f4, 0xc44b4, 0xc44b4]);
  front(S[5]!, [0xc3d2c, 0xc3ff6, 0xc4212, 0xc44d2, 0xc44d2]);
  if (S[9] === 1) calls.push(0xc3afc);
  if (S[12] === 1) calls.push(0xc3a2a);
  front(S[6]!, [0xc3bce, 0xc3ed0, 0xc4136, 0xc4352, 0xc43f4]);
  if (S[7] === 1) { calls.push(0xc3c14); if (w(0) === 3) calls.push(0xc4586); }
  else front(S[7]!, [0, 0xc3f3c, 0xc4154, 0xc43be, 0xc4460]);
  front(S[8]!, [0xc3c5a, 0xc3f06, 0xc41b8, 0xc4388, 0xc442a]);
  return calls;
}

/** $C2FA0: near composer (dungeon 1). `facingOdd` = bit 0 of $F2C0F. */
export function nearCalls(w: (o: number) => number, facingOdd: boolean): number[] {
  const calls: number[] = [];
  if (w(0) === 3) return [0xc3960]; // standing in a doorway: the full-view interior picture
  const sides = () => {
    // $C303A / $C3062: left then right panel, row 1
    if (w(1) === 2 || w(1) === 3) calls.push(0xc3636); else calls.push(w(1) === 1 ? 0xc3672 : 0xc36fe);
    if (w(-1) === 2 || w(-1) === 3) calls.push(0xc3654); else calls.push(w(-1) === 1 ? 0xc36b8 : 0xc3744);
  };
  const doorSides = () => {
    // $C309A: the panels beside a door ahead
    if (w(1) === 2 || w(1) === 3) calls.push(0xc3636); else calls.push(w(1) === 1 ? 0xc3816 : 0xc378a);
    if (w(-1) === 2 || w(-1) === 3) calls.push(0xc3654); else calls.push(w(-1) === 1 ? 0xc385c : 0xc37d0);
  };
  const f = w(7);
  if (f === 2) { calls.push(0xc3528, 0xc3546); doorSides(); return calls; }
  if (f === 3) { calls.push(0xc3528); doorSides(); return calls; }
  if (f === 6) calls.push(0xc38a2);
  else if (f === 1) calls.push(0xc35f0);
  else if (w(0x0e) === 1) {
    calls.push(w(8) === 1 ? 0xc38e8 : 0xc3906);
    calls.push(w(6) === 1 ? 0xc3924 : 0xc3942);
  } else calls.push(facingOdd ? 0xc3564 : 0xc35aa);
  sides();
  return calls;
}

export const parityOf = (x: number, y: number, facing: number) => (x ^ y ^ facing) & 1;

/** Blit one piece into the 432x120 buffer (the $C30F4 / $C3244 / $C3332 loops). */
export function blit(buf: Uint8Array, atlas: Atlas, piece: Piece, dest: Dest, mirror: boolean, masked: boolean): void {
  const ox = BUF_X0 + dest.dx;
  for (let r = 0; r < piece.h; r++) {
    const ty = dest.dy + r;
    if (ty < 0 || ty >= VIEW_H) continue;
    const srow = (piece.sy + r) * atlas.w + piece.sx;
    for (let c = 0; c < piece.w; c++) {
      const v = atlas.px[srow + c]!;
      if (masked && v === 0) continue;
      const tx = ox + (mirror ? piece.w - 1 - c : c);
      if (tx < 0 || tx >= BUF_W) continue;
      buf[ty * BUF_W + tx] = v;
    }
  }
}

/** Render the 176x120 view (palette indices) for a party at (x, y) with game facing `facing`. */
export function renderView(m: PeriMap, v: ViewData, x: number, y: number, facing: GameFacing): Uint8Array {
  const buf = new Uint8Array(BUF_W * VIEW_H); // $C2A2E blitter-clears the buffer first
  const w = windowOf(m, x, y, facing);
  const parity = parityOf(x, y, facing);
  const calls = v.kind === 'far' ? farCalls(w) : nearCalls(w, (facing & 1) === 1);
  for (const a of calls) {
    if (a === -1) {
      blit(buf, v.atlas, v.composer.pieces[0]!, v.composer.dests[0]!, parity === 0, false);
      continue;
    }
    const leaf = v.leaves[leafKey(a)];
    if (!leaf) throw new Error(`leaf $${leafKey(a)} missing from the exported composer`);
    for (const [p, d, mir, masked] of parity ? leaf.p1 : leaf.p0) {
      blit(buf, v.atlas, v.composer.pieces[p]!, v.composer.dests[d]!, mir === 1, masked === 1);
    }
  }
  const out = new Uint8Array(VIEW_W * VIEW_H);
  for (let r = 0; r < VIEW_H; r++) out.set(buf.subarray(r * BUF_W + BUF_X0, r * BUF_W + BUF_X0 + VIEW_W), r * VIEW_W);
  return out;
}

// ── movement ($BCF26 'w', $BCFDC 's', $BD0A2 'a', $BD150 'd', $BD204 'q', $BD24E 'e') ──

export type Op = 'fwd' | 'back' | 'left' | 'right' | 'turnL' | 'turnR';
export interface GamePose { x: number; y: number; facing: GameFacing }
export interface StepResult { pose: GamePose | null; message?: string }

/** relative direction passed to $C2640 per key: w 0, d 1, s 2, a 3 (direction = facing + rel) */
const REL: Record<'fwd' | 'right' | 'back' | 'left', number> = { fwd: 0, right: 1, back: 2, left: 3 };

/** cells the move handlers refuse ($BCF94..$BCFC2): 1 and 2 always, 4 and 5 in dungeon 4 only */
export function blocks(dungeon: number, v: number): boolean {
  return v === 1 || v === 2 || (dungeon === 4 && (v === 4 || v === 5));
}

/**
 * One key press. `prev` is the position before the last step ($F2C08/$F2C0C), used by dungeon 1's
 * doorway rule: standing on a 3 there, w/a/d do nothing and s steps back to `prev`.
 * A 6 (exit) opens the game's "leave?" prompt ($BDF52); the walker refuses the step instead.
 */
export function step(m: PeriMap, dungeon: number, pose: GamePose, op: Op, prev: { x: number; y: number } | null, noclip = false): StepResult {
  const { x, y, facing } = pose;
  if (op === 'turnL') return { pose: { x, y, facing: ((facing + 3) & 3) as GameFacing } };
  if (op === 'turnR') return { pose: { x, y, facing: ((facing + 1) & 3) as GameFacing } };
  if (!noclip && dungeon === 1 && cellAt(m, x, y) === CELL.DOOR_OPEN) {
    if (op === 'back' && prev) return { pose: { x: prev.x, y: prev.y, facing } };
    return { pose: null, message: 'inside a doorway: only back leaves it' };
  }
  const dir = (facing + REL[op]) & 3;
  const nx = x + FWD[dir]![0]!, ny = y + FWD[dir]![1]!;
  const inside = nx >= 0 && ny >= 0 && nx < m.width && ny < m.height;
  if (noclip) return { pose: inside ? { x: nx, y: ny, facing } : null };
  const v = cellAt(m, nx, ny);
  if (blocks(dungeon, v)) return { pose: null, message: v === 2 ? 'closed door (Space opens it)' : undefined };
  if (v === CELL.EXIT) return { pose: null, message: 'exit to the overworld (not followed)' };
  return { pose: { x: nx, y: ny, facing } };
}

/** The use-command ($BD30A, command 5) on the cell ahead: 2 -> 3 opens, 3 -> 2 closes.
 *  The game first checks the door-lock table ($C4C98 list, keys / codes); the walker does not. */
export function toggleDoor(m: PeriMap, pose: GamePose): boolean {
  const [fx, fy] = FWD[pose.facing]!;
  const nx = pose.x + fx, ny = pose.y + fy;
  if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) return false;
  const i = ny * m.width + nx;
  if (m.cells[i] === 2) { m.cells[i] = 3; return true; }
  if (m.cells[i] === 3) { m.cells[i] = 2; return true; }
  return false;
}

/** game facing (0 +y, 1 -x, 2 -y, 3 +x) <-> seer facing (0 N = -y, 1 E, 2 S, 3 W); self-inverse */
export const toSeerFacing = (g: number) => ((g + 2) & 3) as 0 | 1 | 2 | 3;
export const toGameFacing = (s: number) => ((s + 2) & 3) as GameFacing;

export function paletteRGB(words: number[]): Array<[number, number, number]> {
  return words.map((c) => [((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17]);
}
