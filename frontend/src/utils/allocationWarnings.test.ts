import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { allocationWarningKey, allocationWarningText, amountFxMissingOf, type ReportWarning } from './allocationWarnings';

const warning = {
  code: 'turnover_fx_missing' as const,
  items: [{ companyId: 'ny', companyName: 'New York', currency: 'USD', year: 2026 }],
  reportingCurrency: 'EUR',
};

describe('allocationWarningText', () => {
  it('words the missing turnover rate in each language', () => {
    for (const lng of ['en', 'fr', 'de', 'es']) {
      const t = i18n.getFixedT(lng);
      const text = allocationWarningText(t, warning);
      expect(text).not.toContain('shared.allocationWarnings');
      expect(text).toContain('New York');
      expect(text).toContain('USD');
      expect(text).toContain('EUR');
      expect(text).toContain('2026');
    }
    expect(allocationWarningText(i18n.getFixedT('fr'), warning)).toBe(
      'New York est exclue de la répartition : pas de taux de change USD vers EUR pour 2026.',
    );
  });

  it('names each company on its own line', () => {
    const text = allocationWarningText(i18n.getFixedT('fr'), {
      ...warning,
      items: [
        warning.items[0],
        { companyId: 'tokyo', companyName: 'Tokyo', currency: 'JPY', year: 2027 },
      ],
    });
    expect(text).toBe([
      'New York est exclue de la répartition : pas de taux de change USD vers EUR pour 2026.',
      'Tokyo est exclue de la répartition : pas de taux de change JPY vers EUR pour 2027.',
    ].join('\n'));
  });

  it('names a company with no name from the catalogue', () => {
    const text = allocationWarningText(i18n.getFixedT('fr'), {
      ...warning,
      items: [{ ...warning.items[0], companyName: '  ' }],
    });
    expect(text.startsWith('Société est exclue')).toBe(true);
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
    expect(allocationWarningKey(amountWarning)).toBe('amount_fx_missing:JPY-2026');
    expect(allocationWarningKey(warning)).toBe('turnover_fx_missing:ny:USD:2026');
    expect(allocationWarningKey('A sentence.')).toBe('A sentence.');
  });

  it('collects the left-out lines from the warnings', () => {
    const warnings: ReportWarning[] = ['A sentence.', { ...warning }, amountWarning];
    expect(amountFxMissingOf(warnings)).toEqual([{ currency: 'JPY', year: 2026, lines: 2 }]);
    expect(amountFxMissingOf(['A sentence.'])).toEqual([]);
  });
});
