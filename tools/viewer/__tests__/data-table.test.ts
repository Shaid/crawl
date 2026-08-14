import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDataTable } from '../data-table.ts';

describe('renderDataTable', () => {
  it('renders an array of objects as a table with a header row', () => {
    const html = renderDataTable([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<th>b</th>');
    expect(html).toContain('<tr><td><span class="dt-scalar">1</span></td><td><span class="dt-scalar">x</span></td></tr>');
    expect(html).toContain('dt-table');
  });

  it('escapes HTML in values', () => {
    const html = renderDataTable([{ name: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders an array of primitives with index rows', () => {
    const html = renderDataTable([10, 20]);
    expect(html).toContain('<th>#</th>');
    expect(html).toContain('<td class="dt-idx">0</td>');
    expect(html).toContain('<td class="dt-idx">1</td>');
  });

  it('renders a plain string as preformatted text', () => {
    const html = renderDataTable('hello');
    expect(html).toContain('<pre class="dt-plain">hello</pre>');
  });

  it('renders an object with nested record arrays as sections', () => {
    const html = renderDataTable({ note: 'x', records: [{ id: 1 }] });
    expect(html).toContain('dt-section');
    expect(html).toContain('records');
    expect(html).toContain('<th>id</th>');
    expect(html).toContain('dt-kv');
  });

  it('handles empty inputs', () => {
    expect(renderDataTable([])).toContain('dt-empty');
    expect(renderDataTable({})).toBe('');
  });
});

// Real extracted shapes — these documents change shape rarely; the assertions
// are loose (structure, not content) so the tests stay meaningful across runs.
import { existsSync } from 'node:fs';
const hasMm2Data = existsSync(resolve('public/assets/mm2/amiga/data/items.json'));
const hasW6Data = existsSync(resolve('public/assets/wizardry6/amiga/data/item-catalog.json'));

describe.skipIf(!hasMm2Data)('real extracted data (mm2)', () => {
  it('renders mm2 items.json (256 records) as a table', () => {
    const json = JSON.parse(readFileSync(resolve('public/assets/mm2/amiga/data/items.json'), 'utf8'));
    const html = renderDataTable(json);
    expect(html.match(/<tr>/g)!.length).toBe(257); // 256 rows + header row
    expect(html).toContain('<th>name</th>');
  });

  it('renders mm2 monsters.json with name columns', () => {
    const json = JSON.parse(readFileSync(resolve('public/assets/mm2/amiga/data/monsters.json'), 'utf8'));
    const html = renderDataTable(json);
    expect(html).toContain('<th>name</th>');
    expect(html.match(/<tr>/g)!.length).toBe(257);
  });

  it('renders w6 item-catalog.json sections', () => {
    if (!hasW6Data) return;
    const json = JSON.parse(readFileSync(resolve('public/assets/wizardry6/amiga/data/item-catalog.json'), 'utf8'));
    const html = renderDataTable(json);
    expect(html).toContain('dt-kv'); // note/tableStart/tableEnd key-value rows
  });
});
