/**
 * Save slots. A slot is a JSON envelope around the engine's own `save()` bytes (base64), tagged with the engine, variant and the install fingerprint (see
 * `evidenceKey`: names and sizes only). Storage is a small sync key-value interface (localStorage in the browser, a Map in tests); export / import move the same
 * envelope as a `.crawlsave` file. Restore never trusts a slot: the engine, variant and install must match the loaded world, and a throwing `restore` is reported, not crashed.
 *
 * Format (version 1):
 *   { format: 'crawl-slot', version: 1, engine, variant, fingerprint, name, savedAt (ms epoch), tick, seed, data: base64(engine.save()) }
 * The world is never in a slot: it is re-loaded from the user's files on restore (engine.restore(world, bytes)).
 */
export interface SlotRecord { format: 'crawl-slot'; version: 1; engine: string; variant: string; fingerprint: string; name: string; savedAt: number; tick: number; seed: number; data: string }

export class SlotError extends Error {}

export interface KV { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void; keys(): string[] }
export const memoryKV = (): KV => { const m = new Map<string, string>(); return { get: k => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: k => void m.delete(k), keys: () => [...m.keys()] }; };
export const localKV = (ls: Storage): KV => ({ get: k => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: k => ls.removeItem(k), keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)!).filter(Boolean) });

export const AUTOSAVE = 'autosave';
const PREFIX = 'crawl.slot.';
const key = (engine: string, name: string) => `${PREFIX}${engine}.${encodeURIComponent(name)}`;

export function b64encode(b: Uint8Array): string { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
export function b64decode(s: string): Uint8Array { const t = atob(s); const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; }

export function validateRecord(x: unknown): SlotRecord {
  const r = x as Partial<SlotRecord> | null;
  if (!r || typeof r !== 'object' || r.format !== 'crawl-slot') throw new SlotError('not a crawl save slot');
  if (r.version !== 1) throw new SlotError(`unsupported slot version ${String(r.version)}`);
  for (const k of ['engine', 'variant', 'fingerprint', 'name', 'data'] as const) if (typeof r[k] !== 'string') throw new SlotError(`slot field ${k} missing`);
  for (const k of ['savedAt', 'tick', 'seed'] as const) if (typeof r[k] !== 'number') throw new SlotError(`slot field ${k} missing`);
  return r as SlotRecord;
}

export class SlotStore {
  private readonly kv: KV;
  constructor(kv: KV) { this.kv = kv; }
  put(rec: SlotRecord) { this.kv.set(key(rec.engine, rec.name), JSON.stringify(rec)); }
  get(engine: string, name: string): SlotRecord | null {
    const s = this.kv.get(key(engine, name)); if (s === null) return null;
    try { return validateRecord(JSON.parse(s)); } catch { return null; }
  }
  list(engine: string): SlotRecord[] {
    const pre = `${PREFIX}${engine}.`;
    return this.kv.keys().filter(k => k.startsWith(pre)).map(k => { try { return validateRecord(JSON.parse(this.kv.get(k)!)); } catch { return null; } })
      .filter((r): r is SlotRecord => !!r).sort((a, b) => b.savedAt - a.savedAt);
  }
  remove(engine: string, name: string) { this.kv.remove(key(engine, name)); }
}

export const exportSlot = (r: SlotRecord): Uint8Array => new TextEncoder().encode(JSON.stringify(r));
export function importSlot(bytes: Uint8Array): SlotRecord {
  let j: unknown; try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new SlotError('not a crawl save slot (unreadable)'); }
  return validateRecord(j);
}
