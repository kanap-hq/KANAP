import { describe, expect, it } from 'vitest';
import '../i18n';
import { CATALOG_LISTS, catalogDefaults } from '../hooks/useLocalizedItOpsSettings';
import { localizeCatalogItem } from './catalogLocalization';
import { keepsShippedName, localizeTaskType } from './taskTypeLocalization';

// The backend accepts in imports the labels the app shows for shipped catalog values
// (backend/src/it-ops-settings/shipped-catalog-labels.json). This keeps that table equal to what
// the frontend displays: same shipped values, same English source, same label in each language.
// The file is read at run time: the frontend image holds no backend file, so nothing here may
// import one (its type check would fail). A checkout without the backend skips the test.
const LOCALES = ['en', 'fr', 'de', 'es'] as const;

type ShippedLabels = { source: string; en: string; fr: string; de: string; es: string; former?: ShippedLabels[] };
type ShippedFile = { catalog: Record<string, Record<string, ShippedLabels>>; taskTypes: Record<string, ShippedLabels> };
type NodeFs = { existsSync(path: URL): boolean; readFileSync(path: URL, encoding: 'utf8'): string };

const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
// Through a variable: Vite rewrites `new URL('…', import.meta.url)` into an asset URL.
const TEST_FILE = import.meta.url;
const SHIPPED_FILE = new URL('../../../backend/src/it-ops-settings/shipped-catalog-labels.json', TEST_FILE);
const shipped: ShippedFile | null = fs.existsSync(SHIPPED_FILE) ? JSON.parse(fs.readFileSync(SHIPPED_FILE, 'utf8')) : null;
if (!shipped) console.warn(`Skipping the shipped catalog labels check: ${SHIPPED_FILE.pathname} is missing.`);
const SHIPPED_CATALOG_LABELS = shipped?.catalog ?? {};
const SHIPPED_TASK_TYPE_LABELS = shipped?.taskTypes ?? {};

describe.skipIf(!shipped)('shipped catalog labels shared with the backend import', () => {
  it('lists every shipped value the frontend translates, with the same source label', () => {
    const frontend: Record<string, Record<string, string>> = {};
    for (const list of CATALOG_LISTS) {
      const defaults = catalogDefaults(list);
      if (!defaults) continue;
      frontend[list] = Object.fromEntries(Object.entries(defaults.source).map(([code, copy]) => [code, copy.label]));
    }
    const backend = Object.fromEntries(
      Object.entries(SHIPPED_CATALOG_LABELS).map(([list, codes]) => [list, Object.fromEntries(Object.entries(codes).map(([code, entry]) => [code, entry.source]))]),
    );
    expect(backend).toEqual(frontend);
  });

  it('gives each shipped value the label the frontend shows in each language', () => {
    for (const [list, codes] of Object.entries(SHIPPED_CATALOG_LABELS)) {
      const defaults = catalogDefaults(list as (typeof CATALOG_LISTS)[number]);
      for (const [code, entry] of Object.entries(codes)) {
        for (const locale of LOCALES) {
          expect(`${list}.${code}.${locale}: ${localizeCatalogItem({ code, label: entry.source }, locale, defaults).label}`)
            .toBe(`${list}.${code}.${locale}: ${entry[locale]}`);
        }
      }
    }
  });

  it('recognizes a former shipped label under the translation the frontend shows', () => {
    for (const [list, codes] of Object.entries(SHIPPED_CATALOG_LABELS)) {
      const defaults = catalogDefaults(list as (typeof CATALOG_LISTS)[number]);
      for (const [code, entry] of Object.entries(codes)) {
        for (const former of entry.former ?? []) {
          expect(defaults?.former?.[code]?.find((item) => item.source === former.source)).toEqual(former);
          for (const locale of LOCALES) {
            expect(`${list}.${code}.${locale}: ${localizeCatalogItem({ code, label: former.source }, locale, defaults).label}`)
              .toBe(`${list}.${code}.${locale}: ${former[locale]}`);
          }
        }
      }
    }
  });

  it('gives each shipped task type the name the frontend shows in each language', () => {
    expect(Object.keys(SHIPPED_TASK_TYPE_LABELS).sort()).toEqual(['bug', 'incident', 'problem', 'task']);
    for (const [code, entry] of Object.entries(SHIPPED_TASK_TYPE_LABELS)) {
      expect(keepsShippedName(entry.source, code)).toBe(true);
      for (const locale of LOCALES) {
        expect(`${code}.${locale}: ${localizeTaskType({ name: entry.source, code }, locale).name}`).toBe(`${code}.${locale}: ${entry[locale]}`);
      }
    }
  });
});
