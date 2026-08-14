/**
 * MM2 `monsters.dat` codec — 256 records × 26 bytes = 6656 bytes.
 *
 * Format documentation ported from Vairn/MM2 (`EXTRACTED/docs/16-monster-ability-format.md`
 * and `07-dat-files-and-formats.md`). The per-record stat unpacker is at asm
 * 0x4C8E; the accessor at 0x99C4 (`mulu.w #$1a`). The HP/XP byte formulas were
 * ASM-confirmed against the FAQ table (13/13 rows reproduce exactly).
 * Round-trip verified synthetically (no retail monsters.dat in this repo).
 *
 *   +0x00  14B  name      each char masked & 0x7F (stored as char + 128)
 *   +0x0E   1B   hp code  HP = ((c & 0x3F)+1) * hpmul[(c>>6)&3]
 *   +0x0F   1B   xp code  XP = ((c & 0x1F)+1) * xpmul[(c&0x60)>>5]; ×1000 if bit7
 *   +0x10   1B   treasure reward pack (gold/gems/item/XP-bonus)
 *   +0x11   1B   pabil    group attack: low5 = verb index, bits 5-7 = chance tier
 *   +0x12   1B   sabil    single attack: low5 = effect, bit5 misc, bit6 archer, bit7 undead
 *   +0x13   1B   oabil    low nibble+1 (×10 if bit4) = reinforcement count;
 *                         bits 5-6 = flee tier; bit7 = multiplies
 *   +0x14   1B   speed    low nibble+1, high nibble+1 — NOT combat initiative (see below)
 *   +0x15   1B   picture  & 0x7F -> NN.anm; bit7 = placement/size flag
 *   +0x16   1B   ac       low5+1 (×10 if bit5), bit6/bit7 flags
 *   +0x17   1B   damage   low5+1 (×10 if bit5, capped 250)
 *   +0x18   1B   speed2   low5+1 (×10 if bit5, capped 250) — the combat initiative field
 *   +0x19   1B   mres     bits0-2 flags, bits3-4, bits5-7 -> table A4-$7464
 *
 * `hpmul`/`xpmul` = {1, 10, 100, 1000} (byte-verified for hpmul at data-hunk
 * offset 0xB92; xpmul uses the identical shape per the FAQ cross-check).
 *
 * **`0x14` vs `0x18` — which is combat initiative (ASM-confirmed, `17-combat-system.md`
 * §Battle data model + §Round loop):** the round loop's initiative scan
 * (`0x12A22`/`0x13282`, "scan monsters for the highest `-$50E[i]` among
 * not-acted") compares battle array `-$50E[i]`, which the per-slot
 * instantiation (`0x11C2C`) sets from unpacked field `-$11B1` — traced
 * (`mm2.capstone.annotated.asm` @ `0x4FA2..0x4FD4`) directly to **record
 * byte `0x18`** (this codec's `speed2`), the same byte the AC/damage-style
 * `low5+1 (×10 if bit5, capped 250)` decode already applied. So **`0x18`
 * (`speed2`) is THE combat initiative/turn-order stat**, not `0x14`.
 *
 * Record byte `0x14` is a *different* pair of fields, unpacked
 * (`0x4EA0..0x4EC0`) from the SAME source byte's two nibbles: low
 * nibble+1 feeds data-hunk field `-$5E2D` (`speedRaw`/`speed` here) — Vairn's
 * own docs never name or trace its consumer, so its role is genuinely
 * undocumented, not "action speed"; high nibble+1 feeds combat array
 * `-$503[i]`, which `17-combat-system.md` names only **"secondary stat"** —
 * confirmed to exist and confirmed NOT to be the initiative comparison
 * (that's `-$50E[i]` / byte `0x18`), but its exact game-mechanical meaning
 * (to-hit? extra attack?) is not characterized further in Vairn's docs
 * either, so this codec does not invent a name for it beyond "secondary
 * stat" (`speedHigh`/`speedHighRaw` below).
 */

export const MONSTER_RECORD_SIZE = 26;
export const MONSTERS_COUNT = 256;

const MUL_TABLE = [1, 10, 100, 1000];

export interface MonsterRecord {
  index: number;
  name: string;
  /** Raw 14-byte masked name field (preserved verbatim for byte-exact round-trip). */
  nameRaw: Uint8Array;
  hpCode: number;
  xpCode: number;
  hp: number;
  xp: number;
  treasure: number;
  pabil: number;
  sabil: number;
  oabil: number;
  /** Byte 0x14 low nibble + 1. NOT combat initiative — its combat-engine consumer (data-hunk `-$5E2D`) is untraced/unnamed in Vairn's docs. */
  speed: number;
  /** Byte 0x14 high nibble + 1. NOT combat initiative — ASM-confirmed as the combat array's "secondary stat" (`-$503[i]`, `17-combat-system.md`); exact game-mechanical role beyond that name is not documented. */
  speedHigh: number;
  picture: number;
  pictureFlag: boolean;
  ac: number;
  acRaw: number;
  damage: number;
  damageRaw: number;
  /** Byte 0x18, `low5+1 (x10 if bit5, capped 250)`. ASM-confirmed as THE combat initiative/turn-order stat (`-$50E[i]`, `17-combat-system.md` §Round loop) — see also {@link initiative}. */
  speed2: number;
  speed2Raw: number;
  /** Alias of {@link speed2} — the ASM-confirmed combat initiative stat, named for discoverability (byte 0x14 is NOT this, despite its "speed" mnemonic). */
  initiative: number;
  mres: number;
}

/** ASM-confirmed HP decode (`((c & 0x3F) + 1) * hpmul[(c >> 6) & 3]`). */
export function decodeMonsterHp(code: number): number {
  return ((code & 0x3f) + 1) * MUL_TABLE[(code >> 6) & 3];
}

/** ASM-confirmed XP decode (`((c & 0x1F) + 1) * xpmul[(c & 0x60) >> 5]`, ×1000 if bit7). */
export function decodeMonsterXp(code: number): number {
  const base = ((code & 0x1f) + 1) * MUL_TABLE[(code & 0x60) >> 5];
  return (code & 0x80) !== 0 ? base * 1000 : base;
}

/** low5 + 1, ×10 if bit5, capped at 250 — the AC/damage/speed2 encoding. */
export function decodeMonsterStat(code: number): number {
  const v = ((code & 0x1f) + 1) * ((code & 0x20) !== 0 ? 10 : 1);
  return Math.min(v, 250);
}

export function decodeMonsters(data: Uint8Array): MonsterRecord[] {
  if (data.length !== MONSTERS_COUNT * MONSTER_RECORD_SIZE) {
    throw new Error(`monsters.dat: expected ${MONSTERS_COUNT * MONSTER_RECORD_SIZE} bytes, got ${data.length}`);
  }
  const monsters: MonsterRecord[] = [];
  for (let i = 0; i < MONSTERS_COUNT; i++) {
    const off = i * MONSTER_RECORD_SIZE;
    const nameBytes = data.subarray(off, off + 14);
    let name = '';
    for (let c = 0; c < 14; c++) name += String.fromCharCode(nameBytes[c] & 0x7f);
    // eslint-disable-next-line no-control-regex
    name = name.replace(/[\u0000 ]+$/, '');
    const nameRaw = Uint8Array.from(nameBytes);
    const hpCode = data[off + 0x0e];
    const xpCode = data[off + 0x0f];
    const picture = data[off + 0x15];
    monsters.push({
      index: i,
      name,
      nameRaw,
      hpCode,
      xpCode,
      hp: decodeMonsterHp(hpCode),
      xp: decodeMonsterXp(xpCode),
      treasure: data[off + 0x10],
      pabil: data[off + 0x11],
      sabil: data[off + 0x12],
      oabil: data[off + 0x13],
      speed: (data[off + 0x14] & 0x0f) + 1,
      speedHigh: (data[off + 0x14] >> 4) + 1,
      picture: picture & 0x7f,
      pictureFlag: (picture & 0x80) !== 0,
      ac: decodeMonsterStat(data[off + 0x16]),
      acRaw: data[off + 0x16],
      damage: decodeMonsterStat(data[off + 0x17]),
      damageRaw: data[off + 0x17],
      speed2: decodeMonsterStat(data[off + 0x18]),
      speed2Raw: data[off + 0x18],
      initiative: decodeMonsterStat(data[off + 0x18]),
      mres: data[off + 0x19],
    });
  }
  return monsters;
}

export function encodeMonsters(records: MonsterRecord[]): Uint8Array {
  const out = new Uint8Array(records.length * MONSTER_RECORD_SIZE);
  for (const m of records) {
    const off = m.index * MONSTER_RECORD_SIZE;
    // Preserve the original 14-byte name field when unchanged; otherwise
    // re-encode as char+0x80 (space = 0xA0, NUL-padded tail = 0x80).
    // eslint-disable-next-line no-control-regex
    const rawName = new TextDecoder('latin1').decode(m.nameRaw).replace(/[\u0000 ]+$/, '');
    if (rawName === m.name) {
      out.set(m.nameRaw, off);
    } else {
      for (let c = 0; c < 14; c++) {
        const ch = c < m.name.length ? m.name.charCodeAt(c) : 0x00;
        out[off + c] = (ch & 0x7f) | 0x80;
      }
    }
    out[off + 0x0e] = m.hpCode;
    out[off + 0x0f] = m.xpCode;
    out[off + 0x10] = m.treasure;
    out[off + 0x11] = m.pabil;
    out[off + 0x12] = m.sabil;
    out[off + 0x13] = m.oabil;
    out[off + 0x14] = ((m.speedHigh - 1) << 4) | (m.speed - 1);
    out[off + 0x15] = (m.picture & 0x7f) | (m.pictureFlag ? 0x80 : 0x00);
    out[off + 0x16] = m.acRaw;
    out[off + 0x17] = m.damageRaw;
    out[off + 0x18] = m.speed2Raw;
    out[off + 0x19] = m.mres;
  }
  return out;
}

/** Victim-status strings (Sabil low5 − 1 indexes this table). Transcribed from `16-monster-ability-format.md`. */
export const SABIL_EFFECTS: string[] = [
  'lost gold', 'lost gems', 'is poisoned', 'is diseased', 'falls asleep', 'is cursed', 'is silenced',
  'is paralyzed', 'collapses', 'dies', 'turns to stone', 'is eradicated!!', 'lost item', 'lost backpack',
  'lost food', 'lost all food', 'lost all gold', 'lost all gems', 'lost valuables', 'is aged',
  'is aged', 'lost statistics', 'lost level', 'lost experience', 'items scrambled', 'lost spell points',
  'is assassinated',
];

/** Group-attack verbs (Pabil low5 indexes this table, 0-based). Transcribed from `16-monster-ability-format.md`. */
export const PABIL_VERBS: string[] = [
  'sprays poison', 'sprays acid', 'casts a curse', 'breathes fire', 'breathes lightning', 'breathes cold',
  'breathes energy', 'breathes gas', 'breathes acid', 'explodes', 'gazes', 'drains magic',
  'drains spell level', 'vaporizes valuables', 'juggles party', 'energy blast', 'sleep', 'lightning bolts',
  'fireballs', 'fingers of death', 'disintegrate', 'super shock', 'dancing sword', 'incinerate',
  'invokes power', 'implosion', 'inferno', 'pain', 'silence', 'frenzies', 'paralyze', 'swarms',
];
