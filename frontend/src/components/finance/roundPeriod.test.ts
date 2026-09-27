import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import enOps from '../../locales/en/ops.json';
import frOps from '../../locales/fr/ops.json';
import {
  RoundInput,
  activeMonths,
  centsToDecimal,
  chipText,
  columnLabel,
  formatUplift,
  joinList,
  periodForEdit,
  periodProblem,
  periodText,
  suggestedPeriod,
  toCents,
  zeroedMonthsText,
} from './roundPeriod';

const i18n = i18next.createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en: { ops: enOps }, fr: { ops: frOps } },
    ns: ['ops'],
    defaultNS: 'ops',
    interpolation: { escapeValue: false },
  });
});
const en = () => i18n.getFixedT('en', 'ops');
const fr = () => i18n.getFixedT('fr', 'ops');

const record = (over: Partial<RoundInput>): RoundInput => ({
  measure: 'planned',
  period_start: '2026-04-01',
  period_end: '2026-12-31',
  method: 'spread',
  spread_profile_name: 'flat',
  last_calculation: null,
  updated_at: '2026-09-26T10:00:00Z',
  updated_by: null,
  ...over,
});

describe('activeMonths', () => {
  it('counts a month when the period covers its 15th', () => {
    expect(activeMonths(2026, '2026-04-10', '2026-12-31')).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(activeMonths(2026, '2026-04-15', '2026-12-31')).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(activeMonths(2026, '2026-04-20', '2026-12-31')).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(activeMonths(2026, '2026-01-01', '2026-06-10')).toEqual([1, 2, 3, 4, 5]);
    expect(activeMonths(2026, '2026-01-01', '2026-06-15')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(activeMonths(2026, '2026-01-01', '2026-06-20')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('handles a period inside one month', () => {
    expect(activeMonths(2026, '2026-03-10', '2026-03-20')).toEqual([3]);
    expect(activeMonths(2026, '2026-03-16', '2026-03-31')).toEqual([]);
    expect(activeMonths(2026, '2026-03-15', '2026-03-15')).toEqual([3]);
  });

  it('reads missing bounds as January 1 and December 31', () => {
    expect(activeMonths(2026, null, null)).toHaveLength(12);
    expect(activeMonths(2026, '2026-10-01', null)).toEqual([10, 11, 12]);
    expect(activeMonths(2026, null, '2026-02-28')).toEqual([1, 2]);
  });

  it('gives no month for a reversed, invalid or out-of-year period', () => {
    expect(activeMonths(2026, '2026-12-01', '2026-01-31')).toEqual([]);
    expect(activeMonths(2026, '2026-02-30', '2026-12-31')).toEqual([]);
    expect(activeMonths(2026, '2025-06-01', '2026-12-31')).toEqual([]);
  });
});

describe('periodProblem', () => {
  it('names what blocks Apply', () => {
    expect(periodProblem(2026, '', '2026-12-31')).toBe('missing');
    expect(periodProblem(2026, '2026-13-01', '2026-12-31')).toBe('invalid');
    expect(periodProblem(2026, '2027-01-01', '2027-12-31')).toBe('outsideYear');
    expect(periodProblem(2026, '2026-09-01', '2026-03-01')).toBe('startAfterEnd');
    expect(periodProblem(2026, '2026-03-16', '2026-03-31')).toBe('noMonth');
    expect(periodProblem(2026, '2026-04-01', '2026-12-31')).toBeNull();
  });
});

describe('suggestedPeriod', () => {
  it('intersects the item dates with the year', () => {
    expect(suggestedPeriod(2026, '2026-04-01', null)).toEqual({ start: '2026-04-01', end: '2026-12-31' });
    expect(suggestedPeriod(2026, '2024-01-01', '2026-06-30')).toEqual({ start: '2026-01-01', end: '2026-06-30' });
    expect(suggestedPeriod(2026, '', '')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(suggestedPeriod(2026, '2025-03-01', '2028-01-01')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('is null when the item is not valid during the year', () => {
    expect(suggestedPeriod(2026, '2027-02-01', null)).toBeNull();
    expect(suggestedPeriod(2026, null, '2025-12-31')).toBeNull();
  });
});

describe('periodForEdit', () => {
  const suggestion = { start: '2026-04-01', end: '2026-12-31' };
  it('prefers the stored period, then the whole year for existing amounts, then the suggestion', () => {
    expect(periodForEdit(2026, record({ period_start: '2026-07-01', period_end: '2026-12-31' }), true, suggestion))
      .toEqual({ start: '2026-07-01', end: '2026-12-31' });
    expect(periodForEdit(2026, undefined, true, suggestion)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodForEdit(2026, undefined, false, suggestion)).toEqual(suggestion);
    expect(periodForEdit(2026, undefined, false, null)).toBeNull();
  });
});

describe('texts', () => {
  it('writes the period', () => {
    expect(periodText(en(), 'en', [4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('9 months, April to December');
    expect(periodText(en(), 'en', [4])).toBe('1 month, April');
    expect(periodText(en(), 'en', activeMonths(2026, null, null))).toBe('12 months, January to December');
    expect(periodText(en(), 'en', [])).toBe('');
    expect(periodText(fr(), 'fr', [4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('9 mois, avril à décembre');
  });

  it('lists the months that will be set to zero', () => {
    expect(zeroedMonthsText(en(), 'en', [4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('January to March will be set to zero.');
    expect(zeroedMonthsText(en(), 'en', [2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('January and December will be set to zero.');
    expect(zeroedMonthsText(en(), 'en', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe('December will be set to zero.');
    expect(zeroedMonthsText(en(), 'en', activeMonths(2026, null, null))).toBe('');
    expect(zeroedMonthsText(fr(), 'fr', [4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('Janvier à mars seront mis à zéro.');
  });

  it('names how a column was produced', () => {
    expect(chipText(en(), 'en', undefined)).toBe('');
    expect(chipText(en(), 'en', record({}))).toBe('Spread flat');
    expect(chipText(en(), 'en', record({
      spread_profile_name: '4-4-5',
      last_calculation: { kind: 'annual', total: '12000.00', profile: '4-4-5', active_months: [4], weights: ['1'] },
    }))).toBe('Spread 4-4-5');
    expect(chipText(en(), 'en', record({
      spread_profile_name: 'equal',
      last_calculation: { kind: 'quarterly', quarters: { Q1: '0', Q2: '1', Q3: '1', Q4: '1' }, distribution: 'equal', active_months: [4] },
    }))).toBe('Spread by quarter');
    expect(chipText(en(), 'en', record({ method: 'manual' }))).toBe('Edited by hand');
    const copy = (uplift: string) => record({
      method: 'copied',
      last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: uplift, source_total: '12000.00', total: '12240.00', source_method: 'spread' },
    });
    expect(chipText(en(), 'en', copy('0'))).toBe('Copied from Budget 2025');
    expect(chipText(en(), 'en', copy('2'))).toBe('Copied from Budget 2025 +2%');
    expect(chipText(en(), 'en', copy('-2.5'))).toBe('Copied from Budget 2025 -2.5%');
    // The space before % depends on the runtime's ICU data.
    expect(chipText(fr(), 'fr', copy('2'))).toMatch(/^Copié depuis Budget 2025 \+2\s%$/);
    expect(chipText(en(), 'en', record({ method: 'copied' }))).toBe('Copied');
  });

  it('builds every column name in one place', () => {
    expect(columnLabel(en(), 'actual')).toBe('Actuals');
    expect(columnLabel(en(), 'forecast')).toBe('Forecast');
    expect(formatUplift('en', '0.00')).toBe('');
  });
});

describe('amount helpers', () => {
  it('sums in cents and writes two decimals', () => {
    const months = [1333.33, 1333.33, 1333.34, 0.1, 0.2];
    const cents = months.reduce((sum, v) => sum + toCents(v), 0);
    expect(cents).toBe(400030);
    expect(centsToDecimal(cents)).toBe('4000.30');
    expect(centsToDecimal(600000)).toBe('6000.00');
    expect(centsToDecimal(-5)).toBe('-0.05');
    expect(toCents('')).toBe(0);
  });

  it('joins names in the viewer language', () => {
    expect(joinList(en(), ['Revision'])).toBe('Revision');
    expect(joinList(en(), ['Revision', 'Forecast', 'Expected landing'])).toBe('Revision, Forecast and Expected landing');
    expect(joinList(fr(), ['Révision', 'Prévision'])).toBe('Révision et Prévision');
  });
});

