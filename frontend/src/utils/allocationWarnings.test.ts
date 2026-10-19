import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { allocationWarningKey, allocationWarningText, amountFxMissingOf, type ReportWarning } from './allocationWarnings';

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

const amountWarning = {
  code: 'amount_fx_missing' as const,
  items: [{ currency: 'JPY', year: 2026, lines: 2 }],
  reportingCurrency: 'EUR',
};

describe('amount_fx_missing warning', () => {
  it('reads as the notice of the budget reports', () => {
    expect(allocationWarningText(i18n.getFixedT('en'), amountWarning)).toBe('Excluding 2 lines with no exchange rate: JPY 2026.');
    const several = { ...amountWarning, items: [...amountWarning.items, { currency: 'USD', year: 2026, lines: 1 }] };
    expect(allocationWarningText(i18n.getFixedT('en'), several)).toBe('Excluding lines with no exchange rate: JPY 2026 (2), USD 2026 (1).');
    for (const lng of ['fr', 'de', 'es']) {
      const text = allocationWarningText(i18n.getFixedT(lng), amountWarning);
      expect(text).not.toContain('shared.fxMissing');
      expect(text).toContain('JPY 2026');
    }
  });

  it('gives each code a key without throwing', () => {
    const turnover = { code: 'turnover_fx_missing' as const, currencies: ['USD'], year: 2026, reportingCurrency: 'EUR' };
    expect(allocationWarningKey(amountWarning)).toBe('amount_fx_missing:JPY-2026');
    expect(allocationWarningKey(turnover)).toBe('turnover_fx_missing:2026:USD');
    expect(allocationWarningKey('A sentence.')).toBe('A sentence.');
  });

  it('collects the left-out lines from the warnings', () => {
    const warnings: ReportWarning[] = ['A sentence.', { ...warning }, amountWarning];
    expect(amountFxMissingOf(warnings)).toEqual([{ currency: 'JPY', year: 2026, lines: 2 }]);
    expect(amountFxMissingOf(['A sentence.'])).toEqual([]);
  });
});
