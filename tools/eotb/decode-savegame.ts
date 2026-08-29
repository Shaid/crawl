/**
 * Eye of the Beholder 1 (Amiga) `EOBDATA.SAV` decoder --
 * `docs/eotb/amiga/data-structure.md` § "EOBDATA.SAV -- Save game".
 *
 * Port of ScummVM's `EoBCoreEngine::readOriginalSaveFile`
 * (`engines/kyra/gui/saveload_eob.cpp:701-895`), the function ScummVM
 * itself uses to import a real, original (non-ScummVM) EOB1/EOB2 save
 * file. `_flags.gameID == GI_EOB1` throughout below -- this module is
 * EOB1-only (EOB2's record widths differ in several places, cited inline
 * in the ScummVM source but not ported here).
 *
 * **Endianness.** The reader wraps the stream in
 * `SeekableReadStreamEndianWrapper(fs, sourcePlatform == kPlatformAmiga,
 * ...)` -- true (big-endian) for a save file the platform-detection
 * heuristic (already confirmed in the cited doc section, and re-verified
 * below) identifies as Amiga-sourced. Every multi-byte field in this
 * module is therefore read **big-endian**, unlike this project's other
 * Amiga formats (VCN/VMP/CPS palettes), which store 16-bit words BE but
 * for a different, hardware (not save-format) reason -- here it's because
 * ScummVM's own save-import code picks BE specifically for this platform.
 *
 * **One confirmed discrepancy from a literal reading of the ScummVM
 * source, resolved empirically against the real file.** The per-level
 * temp-data loop is written as `for (i = 0; i < numParts + 1; i++)`
 * with `numParts = 12` for EOB1 -- i.e. 13 fixed-stride (2040-byte)
 * blocks. Walking the real `data/eotb/amiga/EOBDATA.SAV` (33,107 bytes)
 * with 13 blocks overshoots the file by exactly one block (2040 bytes);
 * walking it with **12** blocks (`numParts`, not `numParts + 1`) lands
 * the cursor on the file's last byte exactly, with zero residue, and
 * every field decoded along the way is plausible (legible AD&D character
 * names, in-range stats, a monster-in-play record with sane HP values).
 * This module implements the empirically-correct 12-block reading; the
 * literal `numParts + 1` may be specific to a different platform/branch
 * this project has no sample file for, or a genuine off-by-one quirk in
 * ScummVM's own Amiga-original-save importer that happens not to matter
 * there (an extra `seek()` past EOF that's never actually read from).
 *
 * **Not modelled**: the per-level `wallsXorData` blob (1200 bytes,
 * LCW/"Format 80"-compressed to a 4096-byte buffer) is exposed as its raw
 * compressed bytes only. The live engine XORs the decompressed buffer
 * against 4-byte fields read from the level's own block-file data
 * (`getBlockFileData`) to reconstruct a live wall-state snapshot; that
 * merge step needs the block-file's own record stride (a `len` field read
 * from its own header) which hasn't been cross-verified against this
 * project's already-decoded `.MAZ` layout and is left as a follow-up (see
 * `docs/eotb/TODO.md`).
 */

const NUM_CHARACTERS = 6;
const NUM_ITEMS_EOB1 = 500;
const NUM_TEMP_PARTS_EOB1 = 12; // see module doc: NOT `numParts + 1` -- empirically corrected
const TEMP_PART_SIZE_EOB1 = 2040; // 1200-byte compressed wall-XOR blob + 30 * 28-byte monster records
const NUM_MONSTERS_PER_PART = 30; // each monster record is 28 bytes (EOB1) -- see readMonster()
const NUM_ITEM_TYPE_OVERRIDES = 6; // EoBItemType[51..56]
const ITEM_TYPE_OVERRIDE_BASE_INDEX = 51;

class BEReader {
  pos = 0;
  data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }

  u8(): number {
    return this.data[this.pos++]!;
  }
  s8(): number {
    const v = this.u8();
    return v >= 0x80 ? v - 0x100 : v;
  }
  u16(): number {
    const v = (this.data[this.pos]! << 8) | this.data[this.pos + 1]!;
    this.pos += 2;
    return v;
  }
  s16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    const v =
      (this.data[this.pos]! * 0x1000000) +
      ((this.data[this.pos + 1]! << 16) | (this.data[this.pos + 2]! << 8) | this.data[this.pos + 3]!);
    this.pos += 4;
    return v >>> 0;
  }
  bytes(n: number): Uint8Array {
    const v = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  skip(n: number): void {
    this.pos += n;
  }
  cstring(n: number): string {
    const raw = this.bytes(n);
    const nul = raw.indexOf(0);
    return Buffer.from(nul === -1 ? raw : raw.subarray(0, nul)).toString('latin1');
  }
}

export interface EobCharacterRecord {
  id: number;
  flags: number;
  active: boolean;
  name: string;
  strengthCur: number;
  strengthMax: number;
  strengthExtCur: number;
  strengthExtMax: number;
  intelligenceCur: number;
  intelligenceMax: number;
  wisdomCur: number;
  wisdomMax: number;
  dexterityCur: number;
  dexterityMax: number;
  constitutionCur: number;
  constitutionMax: number;
  charismaCur: number;
  charismaMax: number;
  hitPointsCur: number;
  hitPointsMax: number;
  armorClass: number;
  disabledSlots: number;
  raceSex: number;
  cClass: number;
  alignment: number;
  portrait: number;
  food: number;
  level: [number, number, number];
  experience: [number, number, number];
  /** 5 slots x 6 bytes each (level x school), interleaved with a 10-byte stride in the live struct -- flattened here to 30 bytes. */
  mageSpells: Uint8Array;
  clericSpells: Uint8Array;
  mageSpellsAvailableFlags: number;
  inventory: number[];
  /** Raw tick counts as stored -- NOT converted to wall-clock ms (that conversion needs a live `_tickLength`/`getMillis()`, meaningless offline). */
  timers: number[];
  events: Uint8Array;
  effectsRemainder: Uint8Array;
  effectFlags: number;
  damageTaken: number;
  slotStatus: Uint8Array;
}

export interface EobPartyState {
  currentLevel: number;
  currentBlock: number;
  currentDirection: number;
  itemInHand: number;
  hasTempDataFlags: number;
  partyEffectFlags: number;
}

export interface EobInfProcessorState {
  /** `EoBInfProcessor::_flagTable[0..11]`, read raw for `origFile` EOB1. */
  flagTable: number[];
  /** The extra `_flagTable[17] |= readUint32()` merge EOB1's `loadState(origFile=true)` does after the 12-entry loop. */
  flagTable17: number;
}

export interface EobSaveItem {
  nameUnid: number;
  nameId: number;
  flags: number;
  icon: number;
  type: number;
  pos: number;
  block: number;
  next: number;
  prev: number;
  level: number;
  value: number;
}

export interface EobMonsterInPlay {
  type: number;
  unit: number;
  block: number;
  pos: number;
  dir: number;
  animStep: number;
  shpIndex: number;
  mode: number;
  stray: number;
  curAttackFrame: number;
  spellStatusLeft: number;
  hitPointsMax: number;
  hitPointsCur: number;
  dest: number;
  randItem: number;
  fixedItem: number;
  flags: number;
  idleAnimState: number;
  stepsTillRemoteAttack: number;
  numRemoteAttacks: number;
  palette: number;
}

export interface EobLevelTempData {
  /** Whether `partyState.hasTempDataFlags` bit `index` is set -- i.e. whether the engine actually populated (rather than left stale) this slot. */
  active: boolean;
  /** Present only when `active` -- raw LCW/"Format 80"-compressed bytes, decompress with `decompressLCW(bytes, 4096)` from `../lcw.ts`. */
  wallsXorDataCompressed?: Uint8Array;
  monsters?: EobMonsterInPlay[];
}

export interface EobItemTypeOverride {
  /** Absolute `EoBItemType` table index (51-56 for EOB1). */
  index: number;
  invFlags: number;
  handFlags: number;
  armorClass: number;
  allowedClasses: number;
  requiredHands: number;
  dmgNumDiceS: number;
  dmgNumPipsS: number;
  dmgIncS: number;
  dmgNumDiceL: number;
  dmgNumPipsL: number;
  dmgIncL: number;
  unk1: number;
  extraProperties: number;
}

export interface EobSaveGame {
  characters: EobCharacterRecord[];
  party: EobPartyState;
  infState: EobInfProcessorState;
  items: EobSaveItem[];
  levelTempData: EobLevelTempData[];
  itemTypeOverrides: EobItemTypeOverride[];
}

/**
 * Platform-detection heuristic, ported byte-for-byte from
 * `EoBCoreEngine::readOriginalSaveFile` (`saveload_eob.cpp:701-716`),
 * EOB1 branch only. Already spot-verified against the real file in
 * `docs/eotb/amiga/data-structure.md`; re-exported here so the decoder
 * can assert its own precondition instead of assuming the caller checked.
 */
export function detectAmigaSaveFile(data: Uint8Array): boolean {
  // Note: this probe read is LE regardless of the file's real endianness --
  // it runs on the raw stream *before* ScummVM wraps it in the
  // platform-conditional endian wrapper (`saveload_eob.cpp:712-716`).
  const exp = (data[39]! | (data[40]! << 8) | (data[41]! << 16) | (data[42]! * 0x1000000)) >>> 0; // LE u32 at offset 39
  const padding = data[61] === 0;
  return padding && (exp & 0xff000000) !== 0;
}

function readCharacter(r: BEReader): EobCharacterRecord {
  const id = r.u8();
  const flags = r.u8();
  const name = r.cstring(11);
  const strengthCur = r.s8();
  const strengthMax = r.s8();
  const strengthExtCur = r.s8();
  const strengthExtMax = r.s8();
  const intelligenceCur = r.s8();
  const intelligenceMax = r.s8();
  const wisdomCur = r.s8();
  const wisdomMax = r.s8();
  const dexterityCur = r.s8();
  const dexterityMax = r.s8();
  const constitutionCur = r.s8();
  const constitutionMax = r.s8();
  const charismaCur = r.s8();
  const charismaMax = r.s8();
  // (GI_EOB2 && Amiga)-only 1-byte skip omitted -- this module is EOB1-only.
  let hitPointsCur = r.s8();
  let hitPointsMax = r.s8();
  if (hitPointsCur < -10) hitPointsCur &= 0xff;
  if (hitPointsMax < -10) hitPointsMax &= 0xff;
  const armorClass = r.s8();
  const disabledSlots = r.u8();
  const raceSex = r.u8();
  const cClass = r.u8();
  const alignment = r.u8();
  const portrait = r.s8();
  const food = r.u8();
  const level = r.bytes(3);
  r.skip(1); // GI_EOB1 && Amiga-only padding byte
  const experience: [number, number, number] = [r.u32(), r.u32(), r.u32()];
  r.skip(4); // faceShape pointer placeholder -- never persisted
  const mageSpells = new Uint8Array(30);
  for (let i = 0; i < 5; i++) mageSpells.set(r.bytes(6), i * 6);
  const clericSpells = new Uint8Array(30);
  for (let i = 0; i < 5; i++) clericSpells.set(r.bytes(6), i * 6);
  const mageSpellsAvailableFlags = r.u32();
  const inventory: number[] = [];
  for (let i = 0; i < 27; i++) inventory.push(r.s16());
  const timers: number[] = [];
  for (let i = 0; i < 10; i++) timers.push(r.u32());
  const events = r.bytes(10);
  const effectsRemainder = r.bytes(4);
  let effectFlags = r.u32();
  if (effectFlags) effectFlags = 0; // EOB1 effect flags are engine-internal and unused by ScummVM's import -- mirror that here
  const damageTaken = r.u8();
  const slotStatus = r.bytes(5);
  r.skip(6);

  return {
    id,
    flags,
    active: flags !== 0,
    name,
    strengthCur,
    strengthMax,
    strengthExtCur,
    strengthExtMax,
    intelligenceCur,
    intelligenceMax,
    wisdomCur,
    wisdomMax,
    dexterityCur,
    dexterityMax,
    constitutionCur,
    constitutionMax,
    charismaCur,
    charismaMax,
    hitPointsCur,
    hitPointsMax,
    armorClass,
    disabledSlots,
    raceSex,
    cClass,
    alignment,
    portrait,
    food,
    level: [level[0]!, level[1]!, level[2]!],
    experience,
    mageSpells,
    clericSpells,
    mageSpellsAvailableFlags,
    inventory,
    timers,
    events,
    effectsRemainder,
    effectFlags,
    damageTaken,
    slotStatus,
  };
}

function readMonster(r: BEReader): EobMonsterInPlay {
  const type = r.u8();
  const unit = r.u8();
  const block = r.u16();
  const pos = r.u8();
  const dir = r.s8();
  const animStep = r.u8();
  const shpIndex = r.u8();
  const mode = r.s8();
  const stray = r.s8();
  const curAttackFrame = r.s8();
  const spellStatusLeft = r.s8();
  const hitPointsMax = r.s16();
  const hitPointsCur = r.s16();
  const dest = r.u16();
  const randItem = r.u16();
  const fixedItem = r.u16();
  const flags = r.u8();
  const idleAnimState = r.u8();
  const stepsTillRemoteAttack = r.u8(); // EOB1 branch (EOB2 reads curRemoteWeapon here instead)
  const numRemoteAttacks = r.u8();
  const palette = r.s8();
  r.skip(1); // EOB1 branch: 1-byte pad (EOB2 instead reads directionChanged/stepsTillRemoteAttack/sub -- 3 more bytes)
  return {
    type,
    unit,
    block,
    pos,
    dir,
    animStep,
    shpIndex,
    mode,
    stray,
    curAttackFrame,
    spellStatusLeft,
    hitPointsMax,
    hitPointsCur,
    dest,
    randItem,
    fixedItem,
    flags,
    idleAnimState,
    stepsTillRemoteAttack,
    numRemoteAttacks,
    palette,
  };
}

/**
 * Decode an EOB1 `EOBDATA.SAV` file (Amiga byte layout -- see module doc).
 * Throws if the cursor doesn't land exactly on EOF after the full walk --
 * the strongest available oracle here (no sibling DOS EOB1 save exists in
 * this corpus to diff against; see `docs/eotb/TODO.md`).
 */
export function decodeSavegame(data: Uint8Array): EobSaveGame {
  if (!detectAmigaSaveFile(data)) {
    throw new Error('decodeSavegame: platform-detection heuristic says this is not an Amiga-sourced EOB1 save file');
  }

  const r = new BEReader(data);

  const characters: EobCharacterRecord[] = [];
  for (let i = 0; i < NUM_CHARACTERS; i++) characters.push(readCharacter(r));

  const party: EobPartyState = {
    currentLevel: r.u16(),
    currentBlock: r.u16(),
    currentDirection: r.u16(),
    itemInHand: r.s16(),
    hasTempDataFlags: r.u16(),
    partyEffectFlags: r.u16(),
  };

  const flagTable: number[] = [];
  for (let i = 0; i < 12; i++) flagTable.push(r.u32());
  const flagTable17 = r.u32();
  const infState: EobInfProcessorState = { flagTable, flagTable17 };

  const items: EobSaveItem[] = [];
  for (let i = 0; i < NUM_ITEMS_EOB1; i++) {
    items.push({
      nameUnid: r.u8(),
      nameId: r.u8(),
      flags: r.u8(),
      icon: r.s8(),
      type: r.s8(),
      pos: r.s8(),
      block: r.s16(),
      next: r.s16(),
      prev: r.s16(),
      level: r.u8(),
      value: r.s8(),
    });
  }

  const levelTempData: EobLevelTempData[] = [];
  for (let i = 0; i < NUM_TEMP_PARTS_EOB1; i++) {
    const blockStart = r.pos;
    const active = (party.hasTempDataFlags & (1 << i)) !== 0;
    if (active) {
      const wallsXorDataCompressed = r.bytes(1200);
      const monsters: EobMonsterInPlay[] = [];
      for (let m = 0; m < NUM_MONSTERS_PER_PART; m++) monsters.push(readMonster(r));
      levelTempData.push({ active, wallsXorDataCompressed, monsters });
    } else {
      levelTempData.push({ active });
    }
    r.pos = blockStart + TEMP_PART_SIZE_EOB1; // fixed stride regardless of active/inactive -- see module doc
  }

  r.skip(3);

  const itemTypeOverrides: EobItemTypeOverride[] = [];
  for (let i = 0; i < NUM_ITEM_TYPE_OVERRIDES; i++) {
    itemTypeOverrides.push({
      index: ITEM_TYPE_OVERRIDE_BASE_INDEX + i,
      invFlags: r.u16(),
      handFlags: r.u16(),
      armorClass: r.s8(),
      allowedClasses: r.s8(),
      requiredHands: r.s8(),
      dmgNumDiceS: r.s8(),
      dmgNumPipsS: r.s8(),
      dmgIncS: r.s8(),
      dmgNumDiceL: r.s8(),
      dmgNumPipsL: r.s8(),
      dmgIncL: r.s8(),
      unk1: r.u8(),
      extraProperties: r.u16(),
    });
  }

  if (r.pos !== data.length) {
    throw new Error(
      `decodeSavegame: oracle check failed -- expected to land exactly on EOF (${data.length}), stopped at ${r.pos}`,
    );
  }

  return { characters, party, infState, items, levelTempData, itemTypeOverrides };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const path = process.argv[2] ?? 'data/eotb/amiga/EOBDATA.SAV';
  const data = new Uint8Array(readFileSync(path));
  const save = decodeSavegame(data);
  console.log(`Decoded ${path}: ${data.length} bytes, cursor landed exactly on EOF.`);
  for (const c of save.characters) {
    if (!c.active) continue;
    console.log(`  ${c.name}: HP ${c.hitPointsCur}/${c.hitPointsMax}, AC ${c.armorClass}, levels ${c.level.join('/')}`);
  }
  console.log(`  party: level=${save.party.currentLevel} block=${save.party.currentBlock}`);
  const activeParts = save.levelTempData.filter((p) => p.active).length;
  console.log(`  ${activeParts}/${save.levelTempData.length} level temp-data slots active`);
}
