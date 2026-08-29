import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSavegame, detectAmigaSaveFile } from '../decode-savegame.ts';

const SAVE_PATH = resolve('data/eotb/amiga/EOBDATA.SAV');

describe('detectAmigaSaveFile', () => {
  it('identifies the real corpus EOBDATA.SAV as Amiga-sourced', () => {
    if (!existsSync(SAVE_PATH)) return; // corpus file not present in this checkout
    const data = new Uint8Array(readFileSync(SAVE_PATH));
    expect(detectAmigaSaveFile(data)).toBe(true);
  });

  it('rejects an all-zero buffer (padding byte matches, but exp high byte is 0)', () => {
    expect(detectAmigaSaveFile(new Uint8Array(64))).toBe(false);
  });
});

describe('decodeSavegame', () => {
  it('decodes the real EOBDATA.SAV with the cursor landing exactly on EOF', () => {
    if (!existsSync(SAVE_PATH)) return;
    const data = new Uint8Array(readFileSync(SAVE_PATH));
    const save = decodeSavegame(data);

    // Byte-exact structural oracle: decodeSavegame() itself throws unless
    // the cursor lands exactly on EOF -- reaching this point at all is
    // already the strongest available verification. The checks below spot-
    // check specific field values as a second, semantic layer.
    expect(save.characters).toHaveLength(6);

    const active = save.characters.filter((c) => c.active);
    expect(active).toHaveLength(4);
    expect(active.map((c) => c.name)).toEqual(['ALLABAR', 'ARIEL', 'VALANAU', 'TENMIYANA']);
    for (const c of active) {
      expect(c.hitPointsCur).toBeGreaterThan(0);
      expect(c.hitPointsCur).toBeLessThanOrEqual(c.hitPointsMax);
    }

    expect(save.party.currentLevel).toBe(1);
    expect(save.items).toHaveLength(500);
    expect(save.levelTempData).toHaveLength(12);

    // hasTempDataFlags=0x0001 in the real file -- exactly one active slot.
    const activeParts = save.levelTempData.filter((p) => p.active);
    expect(activeParts).toHaveLength(1);
    expect(activeParts[0]!.monsters).toHaveLength(30);
    // At least one real monster-in-play record (type != 0) with sane HP.
    const realMonsters = activeParts[0]!.monsters!.filter((m) => m.type !== 0);
    expect(realMonsters.length).toBeGreaterThan(0);
    for (const m of realMonsters) {
      expect(m.hitPointsCur).toBeGreaterThan(0);
      expect(m.hitPointsCur).toBeLessThanOrEqual(m.hitPointsMax);
    }

    expect(save.itemTypeOverrides).toHaveLength(6);
    expect(save.itemTypeOverrides.map((t) => t.index)).toEqual([51, 52, 53, 54, 55, 56]);
  });

  it('rejects a buffer that fails the Amiga platform-detection precondition', () => {
    expect(() => decodeSavegame(new Uint8Array(64))).toThrow(/platform-detection heuristic/);
  });
});
