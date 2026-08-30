/**
 * Ishar 2: Messengers of Doom (Amiga AGA) — resource container inventory.
 * Usage: npx tsx tools/ishar2/amigaaga/inventory.ts [dataDir]
 * Output: public/assets/ishar2/amigaaga/data/container-inventory.json
 */
import { runInventory } from '../../shared/ishar-inventory.js';

const dataDir = process.argv[2] ?? 'data/ishar2/amigaaga';
runInventory(dataDir, 'ishar2', 'amigaaga');
