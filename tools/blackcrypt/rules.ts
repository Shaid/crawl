/**
 * Black Crypt (Amiga) game rules: original TypeScript reimplementation of
 * routines traced in decompressed bcdft S_1 (see docs/blackcrypt/amiga/game-rules.md).
 * Every function here is diffed against the game's own 68k code run in a
 * musashi core (tools/blackcrypt/rules_oracle, vectors.json).
 */

/** The game's byte generator (S_1 +0x26854): 6-byte state, add-with-carry lag generator. */
export class BcRng {
  private s: number[];
  constructor(seed: number[] | string) {
    this.s = typeof seed === 'string'
      ? Array.from({ length: 6 }, (_, i) => parseInt(seed.slice(i * 2, i * 2 + 2), 16))
      : seed.slice(0, 6);
  }
  /** one byte (S_1 +0x26854) */
  byte(): number {
    const s = this.s;
    const t = s[1] + s[4] + 1;
    const d = (((t >> 8) + (t & 0xff) + s[5]) & 0xff);
    this.s = [d, d, s[1], s[2], s[3], s[4]];
    return d;
  }
  /** rand8(n) (S_1 +0x268BA, called as $A6912): byte % n, 0 when n == 0 */
  rand8(n: number): number { return n === 0 ? 0 : this.byte() % (n & 0xffff); }
  /** rand16(n) (S_1 +0x268CC, called as $A6924): (hi<<8|lo) % n, lo drawn first */
  rand16(n: number): number {
    if ((n & 0xffff) === 0) return 0;
    const lo = this.byte(); const hi = this.byte();
    return ((hi << 8) | lo) % (n & 0xffff);
  }
}

export interface RuleTables { statBonusT1: number[]; defenseT2: number[]; speedT3: number[] }

/** Level-up check (S_1 +0x17D2A). Needs level > 0 +  XP strictly above 2^(level+7); thresholds double per level gained. */
export function levelUp(
  c: { level: number; xp: number; con: number; hp: number; maxHp: number },
  t: RuleTables, rng: BcRng,
): { gained: number } {
  let thr = 2 ** (c.level + 7);
  let gained = 0;
  while (c.xp > thr) {
    gained++;
    thr *= 2;
    const g = rng.rand16(9) + t.statBonusT1[c.con] + 7;
    c.hp = (c.hp + g) << 16 >> 16;
    c.maxHp = (c.maxHp + g) << 16 >> 16;
  }
  c.level += gained;
  return { gained };
}

/** Weapon base table: gfxNumber -> [base, sides] (S_1 +0x0BDE8 first switch). */
export type WeaponBase = Record<string, [number, number]>;
/** Monster-specific weapon rules from the second switch of +0x0BDE8 (keyed by monster type byte = record byte 1). */
export interface WeaponInfo { base: number; sides: number; bonus: number }

/**
 * Weapon/target lookup (S_1 +0x0BDE8). `gfx` is the held item's gfxNumber (0 for bare hand),
 * `extra` its word +0xC. `base === -1` means the target cannot be hurt by this attack.
 * Returns null when the gfx has no weapon entry (caller never attacks with it).
 */
export function weaponInfo(
  w: { cls: number; level: number; gfx: number; extra: number; monType: number; activeItem36Gfx: number },
  table: WeaponBase,
): WeaponInfo | null {
  let base: number, sides: number;
  let bonus = w.gfx === 0 ? 0 : w.extra;
  if (w.gfx === 0) { base = w.cls === 0 ? 4 : 1; sides = w.level; }
  else {
    const e = table[String(w.gfx)];
    if (!e) return null;
    [base, sides] = e;
  }
  const m = w.monType;
  const imm = () => { base = -1; sides = -1; };
  if (m === 0x4b || m === 0x4c) { if (w.gfx === 0x89) { base *= 2; sides *= 2; } }
  else if (m === 0xb1) { if (w.activeItem36Gfx !== 0xc0) bonus -= 10; }
  else if (m === 0xb2) { if (w.gfx !== 0x8c) imm(); else { base *= 3; sides *= 3; } }
  else if (m === 0xbe) { if (w.gfx !== 0x70) imm(); if (w.gfx !== 0x8c) imm(); else { base *= 3; sides *= 3; } }
  else if (m === 0xc5) { if (w.gfx !== 0xbb && w.gfx !== 0x21 && w.gfx !== 0x47) imm(); }
  return { base, sides, bonus };
}

/** Player melee (S_1 +0x1451E). Returns monster HP after the swing. */
export function meleeAttack(
  a: { level: number; str: number; b6c: number; monHit: number; monHp: number; info: WeaponInfo; item: number },
  t: RuleTables, rng: BcRng,
): { hit: boolean; damage: number; monHp: number } {
  const { info } = a;
  let strB = t.statBonusT1[a.str];
  if (a.item === 0) strB >>= 1;
  let thr = 7 - ((a.level - 1) >> 1) - strB - 2 * a.b6c + a.monHit;
  thr = Math.max(2, Math.min(20, thr));
  const roll = rng.rand8(20) + info.bonus + 1;
  if (roll < thr || info.base === -1) return { hit: false, damage: 0, monHp: a.monHp };
  let dmg = rng.rand16(info.sides) + info.base + strB + info.bonus;
  if (dmg < 1) dmg = 1;
  return { hit: true, damage: dmg, monHp: ((a.monHp - dmg) << 16) >> 16 };
}

/**
 * Real-time length of one game tick, in vblanks (input library, S_1 +0x1FF7A / +0x1FF90; harness on the arithmetic).
 * The game calls SetIdlePeriod(10) once at start-up (S_1 +0x1A836, `moveq #10,d0`); the unit is 1/60 s and the stored
 * reload is `max(1, d0 * VBlankFrequency / 60)` (mulu.w, divu.w #60). The vblank server decrements the countdown once per
 * vblank (+0x9F16A path, code) and the tick handler reloads it at its end (+0x1FF90 via +0x2036, code), so one tick is
 * 8 vblanks = 160 ms on PAL (50 Hz) and 10 vblanks = 166.7 ms on NTSC (60 Hz), plus the handler's own run time.
 */
export function idlePeriodVblanks(d0: number, vblankHz: number): number {
  const q = Math.floor(((d0 & 0xffff) * (vblankHz & 0xffff)) / 60) & 0xffff;
  return q === 0 ? 1 : q & 0xff;
}
