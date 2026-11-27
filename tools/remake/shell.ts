/**
 * The host shell page: a thin DOM layer over the testable modules (registry, detect, session, slots, settings). Dev server only for now: the listing comes from
 * `/data-index.json` and the retail bytes from `/data/*` (vite.config.ts); a file picker for users without the dev server is a TODO (docs/remake-architecture.md).
 * `?launch=<engine id>` starts a detected game directly. Knows nothing about any game.
 */
import { registry } from './engines';
import { detectAll, type DataSource, type DetectionReport, type Found } from './detect';
import { GameSession } from './session';
import { SlotStore, SlotError, localKV, memoryKV, type KV } from './slots';
import { loadSettings, saveSettings, type Settings } from './settings';
import type { CoverageRow } from './engine';
import type { AssetAccess, EngineEntry } from './registry';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { class?: string; style?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); const { class: c, style, ...rest } = props as { class?: string; style?: string };
  if (c) e.className = c; if (style) e.setAttribute('style', style); Object.assign(e, rest); e.append(...kids); return e;
};
const root = document.getElementById('root')!;
const kv: KV = (() => { try { localStorage.setItem('crawl.probe', '1'); localStorage.removeItem('crawl.probe'); return localKV(localStorage); } catch { return memoryKV(); } })();
const slots = new SlotStore(kv);
let settings: Settings = loadSettings(kv);

const source: DataSource = {
  async list() { const r = await fetch('/data-index.json'); if (!r.ok) throw new Error(`data listing: ${r.status} (is the dev server running?)`); return ((await r.json()) as { files: { path: string; size: number }[] }).files; },
  async read(p) { const r = await fetch(`/data/${p.split('/').map(encodeURIComponent).join('/')}`); if (!r.ok) throw new Error(`${p}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); },
};
const assetsFor = (e: EngineEntry): AssetAccess => ({ async json<T>(p: string) { if (!e.assetBase) return null; try { const r = await fetch(`${e.assetBase}/${p}`); return r.ok ? (await r.json()) as T : null; } catch { return null; } } });

// ---- settings bar ----
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$<HTMLSelectElement>('region').value = settings.region; $<HTMLInputElement>('volume').value = String(settings.volume); $<HTMLSelectElement>('autosave').value = String(settings.autosaveSec);
let session: GameSession | null = null;
const persist = () => { saveSettings(kv, settings); session?.setRegion(settings.region); session?.setAutosave(settings.autosaveSec); };
$('region').onchange = e => { settings = { ...settings, region: (e.target as HTMLSelectElement).value as Settings['region'] }; persist(); };
$('volume').oninput = e => { settings = { ...settings, volume: Number((e.target as HTMLInputElement).value) }; persist(); };
$('autosave').onchange = e => { settings = { ...settings, autosaveSec: Number((e.target as HTMLSelectElement).value) }; persist(); };

// ---- coverage ----
const GRADES: CoverageRow['grade'][] = ['harness', 'code', 'hyp', 'open', 'stub'];
function coverageBar(rows: CoverageRow[]) {
  const bar = el('div', { class: 'bar', title: GRADES.map(g => `${g} ${rows.filter(r => r.grade === g).length}`).join(', ') });
  for (const g of GRADES) { const n = rows.filter(r => r.grade === g).length; if (n) { const s = el('span', { class: `g-${g}` }); s.style.width = `${(100 * n) / rows.length}%`; bar.append(s); } }
  return bar;
}
const coverageSummary = (rows: CoverageRow[]) => GRADES.map(g => [g, rows.filter(r => r.grade === g).length] as const).filter(([, n]) => n).map(([g, n]) => `${n} ${g}`).join(' / ');
function coverageTable(rows: CoverageRow[]) {
  const t = el('table', { class: 'cov' });
  for (const r of rows) t.append(el('tr', {}, el('td', { class: 'grade', textContent: r.grade, style: 'color:var(--dim)' }), el('td', { textContent: r.area }), el('td', { textContent: r.note ?? '', style: 'color:var(--dim)' })));
  return t;
}

// ---- launcher ----
function launcher(rep: DetectionReport | null, err?: string) {
  root.replaceChildren();
  if (err) root.append(el('p', { class: 'err', textContent: err }));
  if (!rep) return;
  const grid = el('div', { class: 'grid' });
  for (const f of rep.found) {
    const rows = f.entry.engine.coverage();
    const play = el('button', { class: 'primary', textContent: 'Play' }); play.onclick = () => void start(f);
    grid.append(el('div', { class: 'card' },
      el('h2', { textContent: f.detection.title }),
      el('div', { class: 'tag' }, el('span', { class: 'found', textContent: 'found ' }), `${f.detection.variant} - data/${f.dir} - ${f.detection.evidence.join(', ')}`),
      coverageBar(rows), el('div', { class: 'tag', textContent: `rules coverage: ${coverageSummary(rows)}` }),
      el('details', {}, el('summary', { textContent: 'coverage panel' }), coverageTable(rows)),
      el('div', { class: 'row' }, play)));
  }
  for (const m of rep.missing) {
    grid.append(el('div', { class: 'card missing' }, el('h2', { textContent: m.entry.title }),
      el('div', { class: 'tag', textContent: `no data found; looked in data/${m.entry.dataDirs.join(', data/')}${m.error ? ` (${m.error})` : ''}` }), coverageBar(m.entry.engine.coverage())));
  }
  root.append(grid);
}

// ---- play ----
async function start(f: Found, restore?: string) {
  root.replaceChildren(el('p', { textContent: `Loading ${f.detection.title}...` }));
  try {
    const s = await GameSession.open(f, source, assetsFor(f.entry), slots, { region: settings.region, autosaveSec: settings.autosaveSec });
    session = s; s.newGame();
    if (restore) await s.loadSlot(restore).catch(() => undefined);
    playView(s, f);
  } catch (e) { launcher(await detect(), `${f.detection.title}: ${(e as Error).message}`); }
}

function playView(s: GameSession, f: Found) {
  const hints = f.entry.hints;
  const hud = el('pre', { class: 'hud' }), log = el('pre', { class: 'log' }), msg = el('div', { class: 'err' });
  const slotBox = el('div', {}), name = el('input', { value: 'slot 1', size: 14 });
  const back = el('button', { textContent: 'Back to games' }); back.onclick = () => { session = null; void detect().then(r => launcher(r)); };
  const fail = (e: unknown) => { msg.textContent = e instanceof SlotError ? e.message : String((e as Error).message ?? e); };
  const renderSlots = () => {
    slotBox.replaceChildren();
    for (const r of slots.list(f.detection.engine)) {
      const load = el('button', { textContent: 'Load' }); load.onclick = () => { msg.textContent = ''; s.loadSlot(r.name).catch(fail); };
      const exp = el('button', { textContent: 'Export' }); exp.onclick = () => { const b = el('a', { href: URL.createObjectURL(new Blob([exportBytes(r)], { type: 'application/json' })), download: `${f.detection.engine}-${r.name}.crawlsave` }); b.click(); };
      const del = el('button', { textContent: 'x' }); del.onclick = () => { slots.remove(r.engine, r.name); renderSlots(); };
      slotBox.append(el('div', { class: 'slot' }, el('span', { class: 'grow', textContent: `${r.name} - tick ${r.tick} - ${new Date(r.savedAt).toLocaleString()}` }), load, exp, del));
    }
    if (!slotBox.children.length) slotBox.append(el('div', { class: 'tag', textContent: 'no saves yet' }));
  };
  const exportBytes = (r: ReturnType<typeof slots.list>[number]) => new TextEncoder().encode(JSON.stringify(r));
  const save = el('button', { textContent: 'Save' }); save.onclick = () => { msg.textContent = ''; s.saveSlot(name.value.trim() || 'slot'); renderSlots(); };
  const fresh = el('button', { textContent: 'New game' }); fresh.onclick = () => s.newGame();
  const imp = el('input', { type: 'file', accept: '.crawlsave,application/json' });
  imp.onchange = async () => { const file = imp.files?.[0]; if (!file) return; msg.textContent = ''; await s.importFile(new Uint8Array(await file.arrayBuffer())).catch(fail); imp.value = ''; };
  const pause = el('button', { textContent: 'Pause' }); pause.onclick = () => { s.loop.paused = !s.loop.paused; pause.textContent = s.loop.paused ? 'Resume' : 'Pause'; };
  const rows = f.entry.engine.coverage();
  const view = f.entry.hints.viewUrl ? el('a', { href: f.entry.hints.viewUrl, textContent: 'open the 3D view (walker page, separate session)', style: 'color:var(--accent)' }) : '';
  root.replaceChildren(el('div', { class: 'row' }, back, el('strong', { textContent: f.detection.title }), pause, fresh, view),
    el('div', { class: 'play' },
      el('div', {}, hud, el('h3', { textContent: 'Event log' }), log, el('p', { class: 'tag', textContent: hints.help ?? '' }), msg),
      el('div', {}, el('h3', { textContent: 'Save slots' }), el('div', { class: 'row' }, name, save), slotBox, el('div', { class: 'row' }, el('span', { class: 'tag', textContent: 'Import:' }), imp),
        el('h3', { textContent: 'Coverage' }), coverageBar(rows), coverageTable(rows))));
  renderSlots();

  const down = (ev: KeyboardEvent) => { if (!(ev.target instanceof HTMLInputElement) && s.loop.has(ev.code)) { s.loop.keyDown(ev.code); ev.preventDefault(); } };
  const up = (ev: KeyboardEvent) => { if (s.loop.has(ev.code)) s.loop.keyUp(ev.code); };
  const blur = () => s.loop.releaseAll();
  window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
  let last = performance.now();
  const frame = (now: number) => {
    if (session !== s) { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); return; }
    const n = s.update(now - last); last = now;
    if (n) { hud.textContent = s.hudLines().join('\n'); log.textContent = s.logLines.slice(-60).join('\n'); log.scrollTop = log.scrollHeight; renderSlots(); }
    else if (!hud.textContent) hud.textContent = s.hudLines().join('\n');
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function detect(): Promise<DetectionReport | null> {
  try { return await detectAll(source, registry.all()); } catch (e) { launcher(null, (e as Error).message); return null; }
}

void (async () => {
  root.append(el('p', { textContent: 'Looking for your game files...' }));
  const rep = await detect(); if (!rep) return;
  const want = new URLSearchParams(location.search).get('launch');
  const f = want ? rep.found.find(x => x.entry.id === want) : undefined;
  if (f) void start(f); else launcher(rep);
})();
