/**
 * Ishar: Legend of the Fortress (Amiga AGA) — resource container inventory.
 * Usage: npx tsx tools/ishar/amigaaga/inventory.ts [dataDir]
 * Output: public/assets/ishar/amigaaga/data/container-inventory.json
 */
import { runInventory } from '../../shared/ishar-inventory.js';

const dataDir = process.argv[2] ?? 'data/ishar/amigaaga';
runInventory(dataDir, 'ishar', 'amigaaga');
