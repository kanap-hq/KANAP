import { describe, expect, it } from 'vitest';
import '../i18n';
import { SHIPPED_CATALOG_LABELS, SHIPPED_TASK_TYPE_LABELS } from '../../../backend/src/it-ops-settings/catalog-shipped-labels.data';
import { CATALOG_LISTS, catalogDefaults } from '../hooks/useLocalizedItOpsSettings';
import { localizeCatalogItem } from './catalogLocalization';
import { keepsShippedName, localizeTaskType } from './taskTypeLocalization';

// The backend accepts in imports the labels the app shows for shipped catalog values
// (backend/src/it-ops-settings/catalog-shipped-labels.data.ts). This keeps that table equal to what
// the frontend displays: same shipped values, same English source, same label in each language.
const LOCALES = ['en', 'fr', 'de', 'es'] as const;

describe('shipped catalog labels shared with the backend import', () => {
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
