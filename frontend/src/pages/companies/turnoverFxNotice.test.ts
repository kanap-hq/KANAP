import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { companyTurnoverFxMissing, companyTurnoverFxNotice } from './turnoverFxNotice';

describe('companyTurnoverFxNotice', () => {
  it('says the turnover is left out of the total, with a plural for several companies', () => {
    const one = companyTurnoverFxNotice(i18n.getFixedT('fr'), [{ currency: 'ZAR', year: 2026, companies: 1 }]);
    expect(one).toBe("Chiffre d'affaires sans taux de change exclu du total : ZAR 2026 (1 société).");
    const several = companyTurnoverFxNotice(i18n.getFixedT('fr'), [
      { currency: 'ZAR', year: 2026, companies: 2 },
      { currency: 'USD', year: 2027, companies: 1 },
    ]);
    expect(several).toBe(
      "Chiffre d'affaires sans taux de change exclu du total : ZAR 2026 (2 sociétés), USD 2027 (1 société).",
    );
  });

  it('is worded in every language', () => {
    const items = [{ currency: 'ZAR', year: 2026, companies: 1 }];
    for (const lng of ['en', 'de', 'es']) {
      const text = companyTurnoverFxNotice(i18n.getFixedT(lng), items);
      expect(text).toContain('ZAR 2026');
      expect(text).not.toContain('turnoverFxExcluded');
    }
  });

  it('keeps only pairs that name a currency, a year and a company count', () => {
    expect(companyTurnoverFxMissing([
      { currency: 'ZAR', year: 2026, companies: 1 },
      { currency: 'USD', year: '2027', companies: 2 },
      'ZAR',
      { currency: '', year: 2026, companies: 1 },
      { currency: 'JPY', year: 2026, companies: 0 },
    ])).toEqual([
      { currency: 'ZAR', year: 2026, companies: 1 },
      { currency: 'USD', year: 2027, companies: 2 },
    ]);
    expect(companyTurnoverFxMissing(undefined)).toEqual([]);
  });
});
