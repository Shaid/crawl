/**
 * Browser-safe canonical game and platform identifiers.
 */

export const GAME_IDS = ['wizardry6'] as const;
export type GameId = (typeof GAME_IDS)[number];

export const PLATFORM_IDS = ['amiga', 'dosega', 'snes'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const DEFAULT_GAME: GameId = 'wizardry6';
export const DEFAULT_PLATFORM: PlatformId = 'amiga';

export function isGameId(v: string | null): v is GameId {
  return v !== null && (GAME_IDS as readonly string[]).includes(v);
}

export function isPlatformId(v: string | null): v is PlatformId {
  return v !== null && (PLATFORM_IDS as readonly string[]).includes(v);
}

export const GAME_DISPLAY_NAMES: Record<GameId, string> = {
  wizardry6: 'Wizardry 6',
};
