import { describe, expect, it } from 'vitest';
import en from '../../../locales/en/admin.json';
import fr from '../../../locales/fr/admin.json';
import de from '../../../locales/de/admin.json';
import es from '../../../locales/es/admin.json';
import { SAMPLE_DATA_STEPS } from './useSampleData';
// The loader script itself, as text (the whole repository is checked out in CI).
import source from '../../../../../backend/fixtures/fromage-co/setup-tenant.mjs?raw';

// The steps the page names are the ones the loader announces (`step('…')` in server mode), in
// the same order, each with a label in every language.

describe('sample data loader steps', () => {
  it('match the steps of setup-tenant.mjs, in order', () => {
    const emitted = [...source.matchAll(/\bstep\('([a-z0-9-]+)'\)/g)].map((match) => match[1]);
    // The script declares main() after the steps it calls: order by the call order of main().
    const main = source.slice(source.indexOf('async function main()'));
    const order = [...main.matchAll(/\bstep\('([a-z0-9-]+)'\)|\b(runImports|runRelations)\(\)/g)];
    const sections: Record<string, string[]> = {};
    for (const name of ['runImports', 'runRelations']) {
      const body = source.slice(source.indexOf(`async function ${name}()`));
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
