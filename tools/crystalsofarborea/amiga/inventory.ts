/**
 * Crystals of Arborea (Amiga) — resource container inventory. Same engine
 * ancestor as Ishar (`.CO` instead of `.DO`, see
 * `docs/crystalsofarborea/amiga/data-structure.md`).
 * Usage: npx tsx tools/crystalsofarborea/amiga/inventory.ts [dataDir]
 * Output: public/assets/crystalsofarborea/amiga/data/container-inventory.json
 */
import { runInventory } from '../../shared/ishar-inventory.js';

const dataDir = process.argv[2] ?? 'data/crystalsofarborea/amiga';
runInventory(dataDir, 'crystalsofarborea', 'amiga');
