/**
 * Build-order guard: `scripts/export_dungeon_slots.py` once overwrote the `prop:*` slots that `scripts/export_dungeon_props.py`
 * merges into the Black Crypt `slots.json` (82 -> 34 slots), so the walker lost alcoves / plaques / stairs / door locks depending
 * on script order. The generated file is gitignored; when it exists it must hold the wall slots AND the prop slots.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const PATH = 'public/assets/blackcrypt/amiga/dungeon/slots.json';
describe.skipIf(!existsSync(PATH))('blackcrypt slots.json carries the prop slots', () => {
  const doc = JSON.parse(readFileSync(PATH, 'utf8')) as { slots: Record<string, unknown>; floorItem?: unknown; floorPlate?: unknown };
  const keys = Object.keys(doc.slots);
  it('34 wall slots + 48 prop slots', () => {
    expect(keys.filter(k => !k.startsWith('prop:')).length).toBe(34);
    expect(keys.filter(k => k.startsWith('prop:')).length).toBe(48);
    expect(keys.length).toBe(82);
  });
  it('floor item / floor plate placements survive', () => {
    expect(doc.floorItem).toBeDefined(); expect(doc.floorPlate).toBeDefined();
  });
});
