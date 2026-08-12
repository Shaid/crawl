/**
 * Browser-safe canonical game and platform identifiers.
 */

export const GAME_IDS = ['blackcrypt', 'wizardry6', 'eotb', 'eotb2', 'landsoflore', 'mm2'] as const;
export type GameId = (typeof GAME_IDS)[number];

export const PLATFORM_IDS = ['amiga', 'dosvga', 'dosega', 'snes'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const DEFAULT_GAME: GameId = 'blackcrypt';
export const DEFAULT_PLATFORM: PlatformId = 'amiga';

export function isGameId(v: string | null): v is GameId {
  return v !== null && (GAME_IDS as readonly string[]).includes(v);
}

export function isPlatformId(v: string | null): v is PlatformId {
  return v !== null && (PLATFORM_IDS as readonly string[]).includes(v);
}

export const GAME_DISPLAY_NAMES: Record<GameId, string> = {
  blackcrypt: 'Black Crypt',
  wizardry6: 'Wizardry 6',
  eotb: 'Eye of the Beholder',
  eotb2: 'Eye of the Beholder II',
  landsoflore: 'Lands of Lore: The Throne of Chaos',
  mm2: 'Might & Magic II: Gates to Another World',
};

export const PLATFORM_DISPLAY_NAMES: Record<PlatformId, string> = {
  amiga: 'Amiga',
  dosvga: 'DOS/VGA',
  dosega: 'DOS/EGA',
  snes: 'SNES',
};
