/**
 * Browser-safe canonical game and platform identifiers.
 */

export const GAME_IDS = [
  'blackcrypt',
  'wizardry6',
  'eotb',
  'eotb2',
  'eotb2amiga',
  'landsoflore',
  'mm1',
  'mm2',
  'mm3',
  'poolofradiance',
  'curseoftheazurebonds',
  'secretofthesilverblades',
  'poolsofdarkness',
  'championsofkrynn',
  'deathknightsofkrynn',
  'darkqueenofkrynn',
  'gatewaytothesavagefrontier',
  'treasureofthesavagefrontier',
  'ishar',
  'ishar2',
  'ishar3',
  'crystalsofarborea',
  'elvira',
  'elvira2',
  'waxworks',
  'dungeonmaster',
  'dungeonmaster2',
  'chaosstrikesback',
  'bardstale1',
  'bardstale2',
  'bardstale3',
] as const;
export type GameId = (typeof GAME_IDS)[number];

/** 'amigaaga' is the Ishar-trilogy Amiga AGA release specifically (see `docs/ishar-container-format.md`) — distinct from the plain OCS/ECS 'amiga' id used elsewhere in this corpus. */
export const PLATFORM_IDS = ['amiga', 'dosvga', 'dosega', 'snes', 'amigaaga'] as const;
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
  eotb2amiga: 'Eye of the Beholder II (Amiga)',
  landsoflore: 'Lands of Lore: The Throne of Chaos',
  mm1: 'Might & Magic: The Secret of the Inner Sanctum',
  mm2: 'Might & Magic II: Gates to Another World',
  mm3: 'Might & Magic III: Isles of Terra',
  poolofradiance: 'Pool of Radiance',
  curseoftheazurebonds: 'Curse of the Azure Bonds',
  secretofthesilverblades: 'Secret of the Silver Blades',
  poolsofdarkness: 'Pools of Darkness',
  championsofkrynn: 'Champions of Krynn',
  deathknightsofkrynn: 'Death Knights of Krynn',
  darkqueenofkrynn: 'The Dark Queen of Krynn',
  gatewaytothesavagefrontier: 'Gateway to the Savage Frontier',
  treasureofthesavagefrontier: 'Treasures of the Savage Frontier',
  ishar: 'Ishar: Legend of the Fortress',
  ishar2: 'Ishar 2: Messengers of Doom',
  ishar3: 'Ishar 3: The Seven Gates of Infinity',
  crystalsofarborea: 'Crystals of Arborea',
  elvira: 'Elvira: Mistress of the Dark',
  elvira2: 'Elvira II: The Jaws of Cerberus',
  waxworks: 'Waxworks',
  dungeonmaster: 'Dungeon Master',
  dungeonmaster2: 'Dungeon Master II: Skullkeep',
  chaosstrikesback: 'Chaos Strikes Back',
  bardstale1: "The Bard's Tale: Tales of the Unknown",
  bardstale2: "Bard's Tale II: The Destiny Knight",
  bardstale3: "Bard's Tale III: Thief of Fate",
};

export const PLATFORM_DISPLAY_NAMES: Record<PlatformId, string> = {
  amiga: 'Amiga',
  dosvga: 'DOS/VGA',
  dosega: 'DOS/EGA',
  snes: 'SNES',
  amigaaga: 'Amiga AGA',
};
