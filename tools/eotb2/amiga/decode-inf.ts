/**
 * Eye of the Beholder II (Amiga) `.INF` level-configuration decoder.
 *
 * **Confirmed byte-identical record shape to EOB2 DOS/VGA's `.INF`
 * (container AND every field past it), not derived from EOB1 Amiga's own
 * `.INF`.** The only container-level difference from DOS is one already
 * shared with every other Amiga file in this corpus: `.INF` is
 * LCW-compressed behind the same 10-byte "Kyra bitmap" header
 * (`compType=4` in every real file) -- `../decode-inf.ts`'s own
 * `decompressInf`/`decodeInf`/`parseInf` already implement exactly this
 * generic container (they don't special-case DOS at all), so this module
 * re-exports them unmodified rather than porting a duplicate.
 *
 * **Verified this session (2026-09-02) against all 16 real Amiga
 * `LEVELn.INF` files** (`n`=1-16, `LEVEL5` on disk as lowercase
 * `level5.inf`): the fixed-offset header (tag byte `0xEC` @0x004,
 * `mazStem`@0x005 13B, `wallSetStem`@0x012 13B, `secondWallSetFlag`@0x01F,
 * optional `secondWallSetStem`@0x020) decodes cleanly for all 16, the
 * `secondWallSetStem` is present (`"azure"`) on exactly `LEVEL10`-`LEVEL14`
 * -- same 5 levels as DOS -- and the full record-stream walk (door-shapes,
 * monster-shapes, monster-properties, then the wall-mapping/
 * decoration-load stream) parses with **0 errors** across all 16 files,
 * resolving **308** total wall-decoration assignments (the exact same
 * total DOS resolves) with every `decIndex` in-range against a real,
 * byte-identical `.DEC` file (`../../eotb/decode-decorations.ts`, confirmed
 * md5-identical to DOS's own copies -- see `docs/eotb2/amiga/
 * data-structure.md` § ".DEC / .DCR").
 *
 * **One new maze-reuse pair found this session, not present in the DOS
 * corpus's documented list:** `LEVEL15.INF`'s `mazStem` is
 * `"level14.maz"`, not `"level15.maz"` -- a genuine Amiga-specific data
 * variant (DOS's own `LEVEL15.INF` references its own `level15.maz`; see
 * `docs/eotb2/amiga/data-structure.md` for the full per-level table). The
 * other three reuse pairs (`LEVEL16`->`level15.maz`, `LEVEL6`->
 * `level5.maz`, `LEVEL14`->`level12.maz`) match DOS exactly.
 */
export {
  decompressInf,
  decodeInf,
  parseInf,
  parseInfLevelData,
  buildWallTypeMap,
  resolveWallDecorationAssignments,
  type InfHeader,
  type InfLevelData,
  type InfRecord,
  type WallMappingOverride,
  type DecorationLoadRecord,
  type WallDecorationAssignment,
} from '../decode-inf.ts';
