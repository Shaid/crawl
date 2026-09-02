/**
 * Eye of the Beholder II (Amiga) pose -> screen-position dispatch --
 * confirmed engine-shared, byte-identical `.MAZ`/25-slot render geometry
 * across the whole family. Reuses `../view-model.ts` (itself a re-export
 * of EOB1's `../../eotb/view-model.ts`) directly.
 */
export { rotateOffset, roleSide, resolveWallTypes, canStepForward, type Facing, type ResolvedSlot } from '../view-model.ts';
