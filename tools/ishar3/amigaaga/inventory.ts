/**
 * Ishar 3: The Seven Gates of Infinity (Amiga AGA) — resource container inventory.
 * Usage: npx tsx tools/ishar3/amigaaga/inventory.ts [dataDir]
 * Output: public/assets/ishar3/amigaaga/data/container-inventory.json
 */
import { runInventory } from '../../shared/ishar-inventory.js';

const dataDir = process.argv[2] ?? 'data/ishar3/amigaaga';
runInventory(dataDir, 'ishar3', 'amigaaga');
