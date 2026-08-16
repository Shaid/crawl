/**
 * Eye of the Beholder II pose -> screen-position dispatch. The `.MAZ`
 * format and the 25-slot render geometry (`WALL_RENDER_SLOTS`/
 * `CELL_OFFSETS`) are both confirmed byte-identical/engine-shared with
 * EOB1 (see `decode-maze.ts`/`decode-vmp.ts`'s module docs), so this
 * reuses `tools/eotb/view-model.ts`'s dispatch logic directly rather than
 * duplicating it -- including its documented caveats (facings 1-3 are a
 * self-consistent but unverified rotation; the `.MAZ` wall-type byte is
 * clamped, not the real per-level `wallMappingIndex` translation).
 */
export {
  rotateOffset,
  roleSide,
  resolveWallTypes,
  canStepForward,
  type Facing,
  type ResolvedSlot,
} from '../eotb/view-model.ts';
