/**
 * Eye of the Beholder II (Amiga) `.DEC` decoration-placement decoder.
 *
 * **Confirmed md5-byte-identical to EOB2 DOS/VGA's own `.DEC` files**
 * (2026-09-02): all 6 real files in `data/eotb2/amiga/data/` (`AZURE.DEC`,
 * `BROWN.DEC`, `CRIMSON.DEC`, `FOREST.DEC`, `MEZZ.DEC`, `SILVER.DEC`) hash
 * identically to `data/eotb2/dosvga/`'s own same-named files -- expected,
 * since `EoBCoreEngine::getDecDefinitions` reads via
 * `createEndianAwareReadStream(decFile, Resource::kForceLE)`, forced
 * little-endian regardless of platform (already confirmed for EOB1 Amiga,
 * `docs/eotb/amiga/data-structure.md` § "DEC Files"). Re-exports EOB1's
 * decoder directly rather than duplicating it.
 */
export { decodeDecorations, decorationChain, type DecorationData, type DecorationProperty, type DecorationRect } from '../../eotb/decode-decorations.ts';
