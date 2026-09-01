/**
 * viewer-config.ts — Per-game viewer metadata.
 *
 * One place that knows each game's display name and which platform ports have
 * extracted assets, so the asset viewer can offer a game/platform switcher
 * instead of a hardcoded base URL. Mirror of the middilgard project's pattern
 * (`tools/shared/viewer-config.ts`).
 *
 * A game's `supportedPlatforms` list is the source of truth for what the
 * viewer will let you browse: an entry only appears once `public/assets/<game>/<platform>/`
 * has been populated by the extraction pipeline (TS `game-config.ts` or the
 * Python `scripts/`). Games with no entry yet can be registered here with an
 * empty list so the selector shows them with a clear "no assets yet" state.
 */
import {
  GAME_DISPLAY_NAMES,
  type GameId,
  type PlatformId,
} from '../../src/game-id.ts';

export interface ViewerConfig {
  gameId: GameId;
  name: string;
  /** Platform selected when the game is first picked (must be in `supportedPlatforms` when non-empty). */
  defaultPlatform: PlatformId;
  /** Platform ports that have extracted assets under `public/assets/<game>/<platform>/`. */
  supportedPlatforms: PlatformId[];
}

export const VIEWER_CONFIGS: Record<GameId, ViewerConfig> = {
  blackcrypt: {
    gameId: 'blackcrypt',
    name: GAME_DISPLAY_NAMES.blackcrypt,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga', 'dosvga'],
  },
  wizardry6: {
    gameId: 'wizardry6',
    name: GAME_DISPLAY_NAMES.wizardry6,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga', 'dosega', 'snes'],
  },
  eotb: {
    gameId: 'eotb',
    name: GAME_DISPLAY_NAMES.eotb,
    defaultPlatform: 'dosvga',
    supportedPlatforms: ['dosvga'],
  },
  eotb2: {
    gameId: 'eotb2',
    name: GAME_DISPLAY_NAMES.eotb2,
    defaultPlatform: 'dosvga',
    supportedPlatforms: ['dosvga'],
  },
  landsoflore: {
    gameId: 'landsoflore',
    name: GAME_DISPLAY_NAMES.landsoflore,
    defaultPlatform: 'dosvga',
    supportedPlatforms: ['dosvga'],
  },
  mm1: {
    gameId: 'mm1',
    name: GAME_DISPLAY_NAMES.mm1,
    defaultPlatform: 'dosega',
    supportedPlatforms: ['dosega'],
  },
  mm2: {
    gameId: 'mm2',
    name: GAME_DISPLAY_NAMES.mm2,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga', 'dosega'],
  },
  mm3: {
    gameId: 'mm3',
    name: GAME_DISPLAY_NAMES.mm3,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga', 'dosvga'],
  },
  poolofradiance: {
    gameId: 'poolofradiance',
    name: GAME_DISPLAY_NAMES.poolofradiance,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga'],
  },
  curseoftheazurebonds: {
    gameId: 'curseoftheazurebonds',
    name: GAME_DISPLAY_NAMES.curseoftheazurebonds,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga'],
  },
  secretofthesilverblades: {
    gameId: 'secretofthesilverblades',
    name: GAME_DISPLAY_NAMES.secretofthesilverblades,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga'],
  },
  poolsofdarkness: {
    gameId: 'poolsofdarkness',
    name: GAME_DISPLAY_NAMES.poolsofdarkness,
    defaultPlatform: 'amiga',
    supportedPlatforms: ['amiga'],
  },
  ishar: {
    gameId: 'ishar',
    name: GAME_DISPLAY_NAMES.ishar,
    defaultPlatform: 'amigaaga',
    supportedPlatforms: ['amigaaga'],
  },
  ishar2: {
    gameId: 'ishar2',
    name: GAME_DISPLAY_NAMES.ishar2,
    defaultPlatform: 'amigaaga',
    supportedPlatforms: ['amigaaga'],
  },
  ishar3: {
    gameId: 'ishar3',
    name: GAME_DISPLAY_NAMES.ishar3,
    defaultPlatform: 'amigaaga',
    supportedPlatforms: ['amigaaga'],
  },
};

export function getViewerConfig(gameId: GameId): ViewerConfig {
  return VIEWER_CONFIGS[gameId];
}

/** Base URL for one game+platform combo's assets, e.g. `/assets/blackcrypt/amiga`. */
export function getAssetBasePath(gameId: GameId, platform: PlatformId): string {
  return `/assets/${gameId}/${platform}`;
}
