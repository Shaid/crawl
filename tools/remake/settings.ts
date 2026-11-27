/** Shell settings: plain data + load/save over a KV; no DOM. Volume is a placeholder until the audio layer exists. */
import type { KV } from './slots';
import type { Region } from './registry';

export interface Settings { region: Region; /** 0..1, stored but unused until audio lands */ volume: number; /** seconds between autosaves, 0 = off */ autosaveSec: number }
export const DEFAULT_SETTINGS: Settings = { region: 'PAL', volume: 0.8, autosaveSec: 60 };
const KEY = 'crawl.shell.settings';

export function loadSettings(kv: KV): Settings {
  try {
    const j = JSON.parse(kv.get(KEY) ?? '{}') as Partial<Settings>;
    return {
      region: j.region === 'NTSC' ? 'NTSC' : 'PAL',
      volume: typeof j.volume === 'number' ? Math.min(1, Math.max(0, j.volume)) : DEFAULT_SETTINGS.volume,
      autosaveSec: typeof j.autosaveSec === 'number' && j.autosaveSec >= 0 ? j.autosaveSec : DEFAULT_SETTINGS.autosaveSec,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export const saveSettings = (kv: KV, s: Settings) => kv.set(KEY, JSON.stringify(s));
