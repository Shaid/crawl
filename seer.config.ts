/**
 * Seer pipeline configuration.
 *
 * The game and platform definitions live in `tools/shared/game-config.ts`,
 * which is what `tools/extract-game-data.ts` (and therefore `npm run
 * extract-data`) actually executes. This file re-exports them so there is
 * exactly one definition of the pipeline.
 *
 * It previously carried a full standalone copy of the config, including a
 * third implementation of the planar tile decoder that disagreed with the
 * live one. Bitmap decoding now lives in `tools/shared/amiga-planar.ts`.
 */
import { GAME_CONFIGS } from './tools/shared/game-config.ts';

export default GAME_CONFIGS;
