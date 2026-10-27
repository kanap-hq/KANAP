import { describe, expect, it } from 'vitest';
import en from '../../../locales/en/admin.json';
import fr from '../../../locales/fr/admin.json';
import de from '../../../locales/de/admin.json';
import es from '../../../locales/es/admin.json';
import { SAMPLE_DATA_STEPS } from './useSampleData';

// The loader script itself, as text, read at run time: the frontend image holds no backend file,
// so nothing here may import one (its type check would fail). A checkout without the backend
// skips the order check.
type NodeFs = { existsSync(path: URL): boolean; readFileSync(path: URL, encoding: 'utf8'): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
// Through a variable: Vite rewrites `new URL('…', import.meta.url)` into an asset URL.
const TEST_FILE = import.meta.url;
const LOADER = new URL('../../../../../backend/fixtures/fromage-co/setup-tenant.mjs', TEST_FILE);
const source = fs.existsSync(LOADER) ? fs.readFileSync(LOADER, 'utf8') : null;
if (source === null) console.warn(`Skipping the sample data step order check: ${LOADER.pathname} is missing.`);

// The steps the page names are the ones the loader announces (`step('…')` in server mode), in
// the same order, each with a label in every language.

describe('sample data loader steps', () => {
  it.skipIf(source === null)('match the steps of setup-tenant.mjs, in order', () => {
    if (source === null) return;
    const emitted = [...source.matchAll(/\bstep\('([a-z0-9-]+)'\)/g)].map((match) => match[1]);
    // The script declares main() after the steps it calls: order by the call order of main().
    const main = source.slice(source.indexOf('async function main()'));
    const order = [...main.matchAll(/\bstep\('([a-z0-9-]+)'\)|\b(runImports|runRelations)\(/g)];
    const sections: Record<string, string[]> = {};
    for (const name of ['runImports', 'runRelations']) {
      const body = source.slice(source.indexOf(`async function ${name}(`));
      const end = body.indexOf('\n}\n');
      sections[name] = [...body.slice(0, end).matchAll(/\bstep\('([a-z0-9-]+)'\)/g)].map((match) => match[1]);
    }
    const called = order.flatMap((match) => (match[1] ? [match[1]] : sections[match[2]]));
    expect(new Set(emitted)).toEqual(new Set(called));
    expect(called).toEqual([...SAMPLE_DATA_STEPS]);
  });

  it('have a label in every language', () => {
    for (const locale of [en, fr, de, es]) {
      const labels = (locale as any).sampleData.steps as Record<string, string>;
      expect(Object.keys(labels).sort()).toEqual([...SAMPLE_DATA_STEPS].sort());
    }
  });
});
