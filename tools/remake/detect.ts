/**
 * Detection: build a FileSet per candidate directory from the data listing (names + sizes), let the engine's `detect()` look at it, and fetch bytes only when
 * `detect` (or `load`) actually reads a file. The shell never hashes or copies retail data; the listing and the bytes come from a `DataSource` (the dev server's
 * `/data/` middleware, a file picker, or a test's in-memory map).
 */
import type { Detection, FileSet } from './engine';
import type { EngineEntry } from './registry';

export interface DataSource {
  /** every file under the data root: path relative to it ('/'-separated) and size */
  list(): Promise<{ path: string; size: number }[]>;
  read(path: string): Promise<Uint8Array>;
}

/** a DataSource over an in-memory map (tests, file picker) */
export function memorySource(files: Record<string, Uint8Array>): DataSource {
  return { list: async () => Object.entries(files).map(([path, b]) => ({ path, size: b.length })), read: async p => { const b = files[p]; if (!b) throw new Error(`no such file ${p}`); return b; } };
}

class NeedBytes extends Error { readonly file: string; constructor(file: string) { super(`needs bytes of ${file}`); this.file = file; } }

/** names are relative to `dir`; reading an uncached file throws NeedBytes so the caller can fetch it and retry (detect / load are synchronous by contract) */
export class LazyFileSet implements FileSet {
  readonly cache = new Map<string, Uint8Array>();
  readonly dir: string;
  private readonly sizes = new Map<string, number>();
  constructor(dir: string, listing: { path: string; size: number }[]) {
    this.dir = dir;
    const pre = dir ? dir + '/' : '';
    for (const f of listing) if (f.path.startsWith(pre)) this.sizes.set(f.path.slice(pre.length), f.size);
  }
  has(n: string) { return this.sizes.has(n); }
  size(n: string) { return this.sizes.get(n); }
  read(n: string) { if (!this.sizes.has(n)) return undefined; const b = this.cache.get(n); if (!b) throw new NeedBytes(n); return b; }
  names() { return [...this.sizes.keys()]; }
}

/** run `fn` (synchronous, reads the FileSet), fetching any file it asks for and retrying; bounded so a bad engine cannot loop */
export async function withFiles<T>(src: DataSource, fs: LazyFileSet, fn: (f: LazyFileSet) => T | Promise<T>): Promise<T> {
  for (let i = 0; i < 64; i++) {
    try { return await fn(fs); } catch (e) {
      if (!(e instanceof NeedBytes)) throw e;
      fs.cache.set(e.file, await src.read((fs.dir ? fs.dir + '/' : '') + e.file));
    }
  }
  throw new Error('engine asked for more than 64 files while detecting/loading');
}

export interface Found { entry: EngineEntry; dir: string; detection: Detection; files: LazyFileSet; evidenceKey: string }
export interface Missing { entry: EngineEntry; error?: string }
export interface DetectionReport { found: Found[]; missing: Missing[] }

/** ask every registered engine, in every candidate directory; a throwing detect() counts as not detected (and is reported) */
export async function detectAll(src: DataSource, entries: EngineEntry[]): Promise<DetectionReport> {
  const listing = await src.list();
  const found: Found[] = []; const missing: Missing[] = [];
  for (const entry of entries) {
    let hit = false; let error: string | undefined;
    for (const dir of entry.dataDirs) {
      const files = new LazyFileSet(dir, listing);
      if (files.names().length === 0) continue;
      try {
        const detection = await withFiles(src, files, f => entry.engine.detect(f));
        if (detection) { found.push({ entry, dir, detection, files, evidenceKey: evidenceKey(detection) }); hit = true; }
      } catch (e) { error = `${dir}: ${(e as Error).message}`; }
    }
    if (!hit) missing.push({ entry, error });
  }
  return { found, missing };
}

/** identifies the install a save belongs to: engine, variant and the sizes the engine matched (no hashes, no data) */
export const evidenceKey = (d: Detection) => `${d.engine}/${d.variant}/${[...d.evidence].sort().join('|')}`;
