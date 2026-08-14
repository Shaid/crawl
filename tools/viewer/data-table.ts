/**
 * Generic data-table renderer for the asset viewer's `kind: 'data'` manifest
 * entries. Pure function (returns an HTML string, no DOM) so it is unit-
 * testable against real extracted JSON shapes.
 *
 * Handles the shapes the extractors actually emit:
 *  - array of objects            -> one row per record, columns = key union
 *  - array of primitives         -> index/value rows
 *  - object of named values      -> one section per key; nested arrays of
 *                                   objects become their own sub-tables,
 *                                   arrays of primitives become index/value
 *                                   rows, everything else a key/value row
 *  - plain string / number       -> pre-formatted
 * Nested objects/arrays inside cells are shown as compact JSON.
 */

function esc(v: unknown): string {
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function compactJson(v: unknown, max = 120): string {
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** All distinct keys across an array of records, in first-seen order. */
function columnKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

function cellHtml(v: unknown): string {
  if (v === null || v === undefined) return '<span class="dt-null">—</span>';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return `<span class="dt-scalar">${esc(v)}</span>`;
  }
  return `<code class="dt-json">${esc(compactJson(v))}</code>`;
}

function tableHtml(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '<p class="dt-empty">(empty table)</p>';
  const keys = columnKeys(rows);
  const head = keys.map((k) => `<th>${esc(k)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${keys.map((k) => `<td>${cellHtml(r[k])}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="dt-scroll"><table class="dt-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function primitiveTableHtml(values: unknown[]): string {
  if (values.length === 0) return '<p class="dt-empty">(empty)</p>';
  const body = values
    .map((v, i) => `<tr><td class="dt-idx">${i}</td><td>${cellHtml(v)}</td></tr>`)
    .join('');
  return `<div class="dt-scroll"><table class="dt-table"><thead><tr><th>#</th><th>value</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function isRecordArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isPlainObject(x));
}

export function renderDataTable(json: unknown): string {
  if (isRecordArray(json)) {
    return tableHtml(json);
  }
  if (Array.isArray(json)) {
    return primitiveTableHtml(json);
  }
  if (isPlainObject(json)) {
    const sections: string[] = [];
    for (const [key, value] of Object.entries(json)) {
      if (isRecordArray(value)) {
        sections.push(`<h4 class="dt-section">${esc(key)} <span class="dt-count">(${value.length})</span></h4>${tableHtml(value)}`);
      } else if (Array.isArray(value)) {
        sections.push(`<h4 class="dt-section">${esc(key)} <span class="dt-count">(${value.length})</span></h4>${primitiveTableHtml(value)}`);
      } else if (isPlainObject(value)) {
        sections.push(`<h4 class="dt-section">${esc(key)}</h4>${renderDataTable(value)}`);
      } else {
        sections.push(`<div class="dt-kv"><span class="dt-key">${esc(key)}</span><span class="dt-val">${cellHtml(value)}</span></div>`);
      }
    }
    return sections.join('');
  }
  if (typeof json === 'string' || typeof json === 'number' || typeof json === 'boolean') {
    return `<pre class="dt-plain">${esc(json)}</pre>`;
  }
  return `<pre class="dt-plain">${esc(compactJson(json, 2000))}</pre>`;
}
