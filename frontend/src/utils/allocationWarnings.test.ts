import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { allocationWarningText } from './allocationWarnings';

const warning = { code: 'turnover_fx_missing' as const, currencies: ['USD'], year: 2026, reportingCurrency: 'EUR' };

describe('allocationWarningText', () => {
  it('words the missing turnover rate in each language', () => {
    for (const lng of ['en', 'fr', 'de', 'es']) {
      const t = i18n.getFixedT(lng);
      const text = allocationWarningText(t, warning);
      expect(text).not.toContain('shared.allocationWarnings');
      expect(text).toContain('USD');
      expect(text).toContain('EUR');
      expect(text).toContain('2026');
    }
    expect(allocationWarningText(i18n.getFixedT('fr'), warning)).toMatch(/^Pas encore de taux de change/);
  });

  it('names several currencies', () => {
    const text = allocationWarningText(i18n.getFixedT('en'), { ...warning, currencies: ['JPY', 'USD'] });
    expect(text).toContain('JPY, USD');
    expect(text).toContain('these currencies');
  });

  it('shows a sentence from the server as it is', () => {
    expect(allocationWarningText(i18n.getFixedT('fr'), 'Missing paying company for "X" (year 2026).')).toBe('Missing paying company for "X" (year 2026).');
  });
});
