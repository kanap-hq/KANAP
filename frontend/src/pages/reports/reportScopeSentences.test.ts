import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en/ops.json';
import fr from '../../locales/fr/ops.json';
import de from '../../locales/de/ops.json';
import es from '../../locales/es/ops.json';

type Strings = Record<string, Record<string, unknown>>;
const locales = { en, fr, de, es } as Record<string, { reports: Strings }>;

/** The report sentences naming the line type: "Largest {{type}} lines…". */
const typedKeys = Object.entries((en as { reports: Strings }).reports).flatMap(([section, strings]) =>
  Object.entries(strings)
    .filter(([key, text]) => typeof text === 'string' && text.includes('{{type}}') && !/_all(_one|_other)?$/.test(key))
    .map(([key]) => `${section}.${key}`));

describe('report sentences on All', () => {
  it('finds the sentences naming the type', () => {
    expect(typedKeys).toContain('topOpex.subtitle');
    expect(typedKeys).toContain('costPerFte.subtitle');
  });

  it.each(Object.keys(locales))('%s has a sentence for both types, without the type label', (lang) => {
    for (const path of typedKeys) {
      const [section, key] = path.split('.');
      // A counted sentence takes the context before the plural suffix (`x_all_one`), as i18next reads it.
      const plural = /_(one|other)$/.exec(key);
      const allKey = plural ? `${key.slice(0, plural.index)}_all${plural[0]}` : `${key}_all`;
      const text = locales[lang].reports[section]?.[allKey];
      expect(typeof text, `${lang} reports.${section}.${allKey}`).toBe('string');
      expect(text as string, `${lang} reports.${section}.${allKey}`).not.toContain('{{type}}');
    }
  });

  it('resolves the All sentence through the context, the type sentence otherwise', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { ops: en } }, defaultNS: 'ops', interpolation: { escapeValue: false } });
    const t = i18n.t.bind(i18n);
    expect(t('reports.topOpex.subtitle', { type: 'All', context: 'all', metric: 'Budget' })).toBe('Largest budget lines by selected year (Budget)');
    expect(t('reports.costPerFte.subtitle', { type: 'All', context: 'all', group: 'cost center' })).toBe('Yearly cost of one FTE or average daily rate, by cost center');
    expect(t('reports.topOpex.chartTitle', { type: 'All', context: 'all', count: 10, metric: 'Budget', year: 2025 })).toBe('Top 10 lines · Budget 2025');
    expect(t('reports.topOpex.pieShareSubtitle', { count: 10, metric: 'Budget' })).toBe('Share of the top 10 (Budget)');
    expect(t('reports.topOpex.shareSubtitle', { metric: 'Budget' })).toBe('Share of annual total (Budget)');
    expect(t('reports.topOpex.subtitle', { type: 'OPEX', context: 'opex', metric: 'Budget' })).toBe('Largest OPEX lines by selected year (Budget)');
    expect(t('reports.budgetColumnsCompare.selectionsSubtitle', { type: 'OPEX', context: 'opex', count: 1 })).toBe('OPEX: 1 selection');
    expect(t('reports.budgetColumnsCompare.selectionsSubtitle', { type: 'All', context: 'all', count: 2 })).toBe('OPEX and CAPEX: 2 selections');
  });

  it('names a pie share as a share of the top lines, in the four languages', () => {
    const pie = {
      en: 'Share of the top {{count}} ({{metric}})',
      fr: 'Part du top {{count}} ({{metric}})',
      de: 'Anteil am Top {{count}} ({{metric}})',
      es: 'Participación en el top {{count}} ({{metric}})',
    };
    const bars = {
      en: 'Share of annual total ({{metric}})',
      fr: 'Part du total annuel ({{metric}})',
      de: 'Anteil an der Jahressumme ({{metric}})',
      es: 'Participación en el total anual ({{metric}})',
    };
    for (const lang of Object.keys(locales)) {
      const top = locales[lang].reports.topOpex as Record<string, string>;
      expect(top.pieShareSubtitle, lang).toBe(pie[lang as keyof typeof pie]);
      expect(top.shareSubtitle, lang).toBe(bars[lang as keyof typeof bars]);
    }
  });
});
