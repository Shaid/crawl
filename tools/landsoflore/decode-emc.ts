/**
 * Lands of Lore `LEVELn.INI` EMC2 script bytecode disassembler --
 * `docs/landsoflore/TODO.md`'s `lol-text-script-data` row: the `TEXT`/
 * `ORDR` string-pool and function-order chunks are already decoded
 * (`decode-ini.ts`); this decodes the `DATA` chunk, the actual bytecode,
 * into readable mnemonics. Ported directly from ScummVM's real
 * interpreter source, not guessed:
 *
 * - Container + per-chunk byte order: `engines/kyra/script/script.cpp`
 *   `EMCInterpreter::callback` -- `DATA`/`ORDR` are big-endian `u16` arrays
 *   (`READ_BE_UINT16`), consistent with `decode-ini.ts`'s already-verified
 *   BE `TEXT` chunk size prefix. `DATA`'s own chunk starts with a BE `u32`
 *   size, same convention as `TEXT`.
 * - Per-instruction decode: `EMCInterpreter::run` (`script.cpp:187-219`).
 *   One BE `u16` `code` per instruction:
 *     `opcode = (code >> 8) & 0x1F`
 *     `code & 0x8000` -> opcode forced to 0 (`jmp`), `param = code & 0x7FFF`
 *     `code & 0x4000` -> `param = (int8)code` (sign-extended low byte)
 *     `code & 0x2000` -> `param` = the *next* BE `u16` word (wide immediate)
 *     else            -> `param = 0`
 *   19 opcodes (0-18), all generic/shared across every Kyra-engine game
 *   (jmp, setRetValue, pushRetOrPos, push, push, pushReg, pushBPNeg,
 *   pushBPAdd, popRetOrPos, popReg, popBPNeg, popBPAdd, addSP, subSP,
 *   sysCall, ifNotJmp, negate, eval, setRetAndJmp) -- `EMCInterpreter`'s
 *   constructor, `script.cpp:29-56`.
 * - `sysCall`'s `param` indexes a 190-entry, LOL-specific table of named
 *   engine callbacks -- `LoLEngine::setupOpcodeTable`, `engines/kyra/
 *   script/script_lol.cpp:2682-2875` (the exact `Opcode(olol_*)`/
 *   `OpcodeUnImpl()` push order = the syscall ID). Extracted verbatim
 *   below, including the real `OpcodeUnImpl()` gaps (ids 5, 23, 41, 42,
 *   64, 65, 75, 116, 117, 124, 142, 143, 147, 159, 160 -- reserved slots
 *   the game never wired up, not gaps in this port's own extraction).
 *
 * This disassembles control flow and named engine calls; it does not
 * *execute* scripts (no stack/register/branch simulation) -- turning this
 * into a real interpreter, if ever wanted, is separate follow-on work.
 */

const GENERIC_OPCODES = [
  'jmp', 'setRetValue', 'pushRetOrPos', 'push', 'push', 'pushReg',
  'pushBPNeg', 'pushBPAdd', 'popRetOrPos', 'popReg', 'popBPNeg', 'popBPAdd',
  'addSP', 'subSP', 'sysCall', 'ifNotJmp', 'negate', 'eval', 'setRetAndJmp',
] as const;

/** `LoLEngine::setupOpcodeTable` push order, `script_lol.cpp:2682-2875` -- index = syscall id. `null` = a real `OpcodeUnImpl()` slot (reserved, never implemented by the game). */
export const LOL_SYSCALLS: (string | null)[] = [
  'olol_setWallType', 'olol_getWallType', 'olol_drawScene', 'olol_rollDice',
  'olol_moveParty', null, 'olol_delay', 'olol_setGameFlag',
  'olol_testGameFlag', 'olol_loadLevelGraphics', 'olol_loadBlockProperties', 'olol_loadMonsterShapes',
  'olol_deleteHandItem', 'olol_allocItemPropertiesBuffer', 'olol_setItemProperty', 'olol_makeItem',
  'olol_placeMoveLevelItem', 'olol_createLevelItem', 'olol_getItemPara', 'olol_getCharacterStat',
  'olol_setCharacterStat', 'olol_loadLevelShapes', 'olol_closeLevelShapeFile', null,
  'olol_loadDoorShapes', 'olol_initAnimStruct', 'olol_playAnimationPart', 'olol_freeAnimStruct',
  'olol_getDirection', 'olol_characterSurpriseFeedback', 'olol_setMusicTrack', 'olol_setSequenceButtons',
  'olol_setDefaultButtonState', 'olol_checkRectForMousePointer', 'olol_clearDialogueField', 'olol_setupBackgroundAnimationPart',
  'olol_startBackgroundAnimation', 'olol_fadeToBlack', 'olol_fadePalette', 'olol_loadBitmap',
  'olol_stopBackgroundAnimation', null, null, 'olol_getGlobalScriptVar',
  'olol_setGlobalScriptVar', 'olol_getGlobalVar', 'olol_setGlobalVar', 'olol_triggerDoorSwitch',
  'olol_checkEquippedItemScriptFlags', 'olol_setDoorState', 'olol_updateBlockAnimations', 'olol_assignLevelDecorationShape',
  'olol_resetBlockShapeAssignment', 'olol_copyRegion', 'olol_initMonster', 'olol_fadeClearSceneWindow',
  'olol_fadeSequencePalette', 'olol_redrawPlayfield', 'olol_loadNewLevel', 'olol_getNearestMonsterFromCharacter',
  'olol_dummy0', 'olol_loadMonsterProperties', 'olol_battleHitSkillTest', 'olol_inflictDamage',
  null, null, 'olol_moveMonster', 'olol_setupDialogueButtons',
  'olol_giveTakeMoney', 'olol_checkMoney', 'olol_setScriptTimer', 'olol_createHandItem',
  'olol_playAttackSound', 'olol_addRemoveCharacter', 'olol_giveItem', null,
  'olol_loadTimScript', 'olol_runTimScript', 'olol_releaseTimScript', 'olol_initSceneWindowDialogue',
  'olol_restoreAfterSceneWindowDialogue', 'olol_getItemInHand', 'olol_checkMagic', 'olol_giveItemToMonster',
  'olol_loadLangFile', 'olol_playSoundEffect', 'olol_processDialogue', 'olol_stopTimScript',
  'olol_getWallFlags', 'olol_changeMonsterStat', 'olol_getMonsterStat', 'olol_releaseMonsterShapes',
  'olol_playCharacterScriptChat', 'olol_update', 'olol_playEnvironmentalSfx', 'olol_healCharacter',
  'olol_drawExitButton', 'olol_loadSoundFile', 'olol_playMusicTrack', 'olol_deleteMonstersFromBlock',
  'olol_countBlockItems', 'olol_characterSkillTest', 'olol_countAllMonsters', 'olol_playEndSequence',
  'olol_stopPortraitSpeechAnim', 'olol_setPaletteBrightness', 'olol_calcInflictableDamage', 'olol_getInflictedDamage',
  'olol_checkForCertainPartyMember', 'olol_printMessage', 'olol_deleteLevelItem', 'olol_calcInflictableDamagePerItem',
  'olol_distanceAttack', 'olol_removeCharacterEffects', 'olol_checkInventoryFull', 'olol_moveBlockObjects',
  null, null, 'olol_addSpellToScroll', 'olol_playDialogueText',
  'olol_playDialogueTalkText', 'olol_checkMonsterTypeHostility', 'olol_setNextFunc', 'olol_dummy1',
  null, 'olol_suspendMonster', 'olol_setScriptTextParameter', 'olol_triggerEventOnMouseButtonClick',
  'olol_printWindowText', 'olol_countSpecificMonsters', 'olol_updateBlockAnimations2', 'olol_checkPartyForItemType',
  'olol_blockDoor', 'olol_resetTimDialogueState', 'olol_getItemOnPos', 'olol_removeLevelItem',
  'olol_savePage5', 'olol_restorePage5', 'olol_initDialogueSequence', 'olol_restoreAfterDialogueSequence',
  'olol_setSpecialSceneButtons', 'olol_restoreButtonsAfterSpecialScene', null, null,
  'olol_prepareSpecialScene', 'olol_restoreAfterSpecialScene', 'olol_assignCustomSfx', null,
  'olol_findAssignedMonster', 'olol_checkBlockForMonster', 'olol_crossFadeRegion', 'olol_calcCoordinatesAddDirectionOffset',
  'olol_resetPortraitsAndDisableSysTimer', 'olol_enableSysTimer', 'olol_checkNeedSceneRestore', 'olol_getNextActiveCharacter',
  'olol_paralyzePoisonCharacter', 'olol_drawCharPortrait', 'olol_removeInventoryItem', null,
  null, 'olol_getAnimationLastPart', 'olol_assignSpecialGuiShape', 'olol_findInventoryItem',
  'olol_restoreFadePalette', 'olol_calcNewBlockPosition', 'olol_getSelectedCharacter', 'olol_setHandItem',
  'olol_drinkBezelCup', 'olol_changeItemTypeOrFlag', 'olol_placeInventoryItemInHand', 'olol_castSpell',
  'olol_pitDrop', 'olol_increaseSkill', 'olol_paletteFlash', 'olol_restoreMagicShroud',
  'olol_dummy1', 'olol_disableControls', 'olol_enableControls', 'olol_shakeScene',
  'olol_gasExplosion', 'olol_calcNewBlockPosition', 'olol_crossFadeScene', 'olol_updateDrawPage2',
  'olol_setMouseCursor', 'olol_characterSays', 'olol_queueSpeech', 'olol_getItemPrice',
  'olol_getLanguage', 'olol_dummy0',
];

export interface EmcInstruction {
  /** Byte offset within the DATA chunk's payload (word-address * 2), matching jmp target units. */
  offset: number;
  opcode: number;
  mnemonic: string;
  param: number;
  /** Resolved syscall name, only set when mnemonic === 'sysCall'. */
  syscall?: string;
}

function findChunk(data: Uint8Array, tag: string): Uint8Array {
  const [a, b, c, d] = [tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)];
  for (let i = 0; i + 8 <= data.length; i++) {
    if (data[i] === a && data[i + 1] === b && data[i + 2] === c && data[i + 3] === d) {
      const size = (data[i + 4]! << 24) | (data[i + 5]! << 16) | (data[i + 6]! << 8) | data[i + 7]!;
      return data.subarray(i + 8, i + 8 + size);
    }
  }
  throw new Error(`decodeEmc: no "${tag}" chunk found`);
}

/** Disassemble a `LEVELn.INI`'s `DATA` chunk into a flat instruction list (word-indexed offsets, matching real `jmp` targets). */
export function disassembleEmc(data: Uint8Array): EmcInstruction[] {
  const chunk = findChunk(data, 'DATA');
  if (chunk.length % 2 !== 0) throw new Error(`decodeEmc: DATA chunk size ${chunk.length} is not a whole number of words`);
  const words = new Uint16Array(chunk.length / 2);
  for (let i = 0; i < words.length; i++) words[i] = (chunk[i * 2]! << 8) | chunk[i * 2 + 1]!;

  const instructions: EmcInstruction[] = [];
  let i = 0;
  while (i < words.length) {
    const wordOffset = i;
    const code = words[i++]!;
    let opcode = (code >> 8) & 0x1f;
    let param: number;
    if (code & 0x8000) {
      opcode = 0;
      param = code & 0x7fff;
    } else if (code & 0x4000) {
      param = (code << 24) >> 24; // sign-extend low byte as int8
    } else if (code & 0x2000) {
      if (i >= words.length) throw new Error(`decodeEmc: wide-immediate opcode at word ${wordOffset} truncated`);
      param = words[i++]!;
    } else {
      param = 0;
    }
    if (opcode > 18) throw new Error(`decodeEmc: opcode ${opcode} out of range (0-18) at word ${wordOffset}, code=0x${code.toString(16)}`);
    const mnemonic = GENERIC_OPCODES[opcode]!;
    const inst: EmcInstruction = { offset: wordOffset, opcode, mnemonic, param };
    // op_sysCall reads its id as `const uint8 id = _parameter` (script.cpp) --
    // reinterpret a sign-extended negative param as an unsigned byte here too,
    // unlike every other opcode (push etc. keep signed param as-is, verified
    // against real script data: negative push values like -1 are legitimate
    // sentinel arguments, not a decode bug).
    if (mnemonic === 'sysCall') {
      const id = param & 0xff;
      inst.syscall = LOL_SYSCALLS[id] ?? `<unimplemented:${id}>`;
    }
    instructions.push(inst);
  }
  return instructions;
}

/** Render a disassembly listing, `jmp`/`ifNotJmp` targets shown as `-> word N`. */
export function formatDisassembly(instructions: EmcInstruction[]): string {
  return instructions
    .map((inst) => {
      const base = `${inst.offset.toString().padStart(5)}: ${inst.mnemonic}`;
      if (inst.mnemonic === 'sysCall') return `${base}(${inst.param}) ; ${inst.syscall}`;
      if (inst.mnemonic === 'jmp' || inst.mnemonic === 'ifNotJmp') return `${base} -> word ${inst.param}`;
      return `${base} ${inst.param}`;
    })
    .join('\n');
}
