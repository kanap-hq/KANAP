import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import enOps from '../../locales/en/ops.json';
import frOps from '../../locales/fr/ops.json';
import {
  ComputePreview,
  RoundInput,
  activeMonths,
  centsToDecimal,
  chipText,
  columnLabel,
  columnPeriod,
  computeChangeLines,
  computeLineText,
  formatMoney,
  formatUplift,
  hasRecipe,
  recipeText,
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
  pricing_basis: null,
  quantity: null,
  unit_price: null,
  price_index_pct: null,
  working_day_profile_id: null,
  working_day_profile_code: null,
  working_day_profile_name: null,
  counts_as_fte: false,
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

describe('columnPeriod', () => {
  const suggestion = { start: '2026-04-01', end: '2026-12-31' };
  it('prefers the stored period, then the whole year for existing amounts, then the suggestion', () => {
    expect(columnPeriod(2026, record({ period_start: '2026-01-01', period_end: '2026-12-31' }), true, suggestion))
      .toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(columnPeriod(2026, undefined, true, suggestion)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(columnPeriod(2026, undefined, false, suggestion)).toEqual(suggestion);
    expect(columnPeriod(2026, undefined, false, null)).toBeNull();
  });
});

describe('periodForEdit', () => {
  const suggestion = { start: '2026-04-01', end: '2026-12-31' };
  it('keeps the column period within the item dates', () => {
    expect(periodForEdit(2026, record({ period_start: '2026-07-01', period_end: '2026-12-31' }), true, suggestion))
      .toEqual({ start: '2026-07-01', end: '2026-12-31' });
    expect(periodForEdit(2026, record({ period_start: '2026-01-01', period_end: '2026-12-31' }), true, suggestion))
      .toEqual(suggestion);
    expect(periodForEdit(2026, record({ period_start: '2026-02-01', period_end: '2026-09-30' }), true, { start: '2026-01-01', end: '2026-06-30' }))
      .toEqual({ start: '2026-02-01', end: '2026-06-30' });
  });
  it('cuts the whole year of a column with amounts but no stored period', () => {
    expect(periodForEdit(2026, undefined, true, suggestion)).toEqual(suggestion);
    expect(periodForEdit(2026, undefined, true, { start: '2026-01-01', end: '2026-12-31' })).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
  it('proposes the item dates when the column period shares no day with them', () => {
    expect(periodForEdit(2026, record({ period_start: '2026-01-01', period_end: '2026-03-31' }), true, suggestion)).toEqual(suggestion);
  });
  it('without item dates in the year, keeps the column period', () => {
    expect(periodForEdit(2026, record({ period_start: '2026-07-01', period_end: '2026-12-31' }), true, null))
      .toEqual({ start: '2026-07-01', end: '2026-12-31' });
    expect(periodForEdit(2026, undefined, true, null)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodForEdit(2026, undefined, false, null)).toBeNull();
  });
  it('proposes the item dates for an empty column', () => {
    expect(periodForEdit(2026, undefined, false, suggestion)).toEqual(suggestion);
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
    // The source column carries the tenant's name when the screen passes it.
    expect(chipText(en(), 'en', copy('2'), (measure) => (measure === 'planned' ? 'A0' : measure))).toBe('Copied from A0 2025 +2%');
  });

  it('gives the product name of a column', () => {
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


const SFR_DAYS = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
const SFR_MONTHS = ['0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00'];
const FEB_TO_OCT = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const perDay = (over: Partial<RoundInput> = {}) => record({
  method: 'computed',
  pricing_basis: 'per_day',
  quantity: '1',
  unit_price: '400',
  price_index_pct: '0',
  working_day_profile_id: 'cal-1',
  working_day_profile_code: 'FR218',
  working_day_profile_name: 'France 218',
  counts_as_fte: true,
  ...over,
});

const preview = (over: Partial<ComputePreview> = {}): ComputePreview => ({
  active_months: FEB_TO_OCT,
  day_counts: SFR_DAYS,
  total_days: '163',
  month_amounts: SFR_MONTHS,
  total: '65200.00',
  fte: '0.75',
  calendar: { id: 'cal-1', code: 'FR218', name: 'France 218', disabled: false },
  stored: { month_amounts: Array.from({ length: 12 }, () => '0.00'), method: null, last_calculation: null },
  changed_months: FEB_TO_OCT,
  calendar_changed_months: [],
  warnings: [],
  ...over,
});

describe('computed columns', () => {
  it('names the basis in the chip', () => {
    expect(chipText(en(), 'en', perDay())).toBe('Computed per day, France 218');
    expect(chipText(en(), 'en', perDay({ pricing_basis: 'per_month', working_day_profile_name: null }))).toBe('Computed per month');
    expect(chipText(en(), 'en', perDay({ pricing_basis: 'per_period', working_day_profile_name: null }))).toBe('Computed for the whole period');
    expect(chipText(fr(), 'fr', perDay())).toBe('Calculé par jour, France 218');
    // A hand edit keeps the recipe but says so.
    expect(chipText(en(), 'en', perDay({ method: 'manual' }))).toBe('Edited by hand');
  });

  it('writes the recipe for the tooltip, only when there is one', () => {
    expect(hasRecipe(record({}))).toBe(false);
    expect(recipeText(en(), 'en', record({}))).toBe('');
    expect(recipeText(en(), 'en', perDay())).toBe('Per day · Quantity 1 · Unit price 400 · Calendar France 218 · Counts as FTE');
    expect(recipeText(en(), 'en', perDay({
      method: 'spread', pricing_basis: 'per_month', quantity: '10', unit_price: '199.5', price_index_pct: '2',
      working_day_profile_id: null, working_day_profile_name: null, counts_as_fte: false,
    }))).toBe('Per month · Quantity 10 · Unit price 199.5 · Price index +2%');
  });

  it('writes the live line from the server figures', () => {
    expect(computeLineText(en(), 'en', preview())).toBe('9 months · 163 days · 65 200 · 0.75 FTE');
    expect(computeLineText(fr(), 'fr', preview())).toBe('9 mois · 163 jours · 65 200 · 0.75 ETP');
    // No days without a calendar, no FTE when the quantity is not people, cents when there are some.
    expect(computeLineText(en(), 'en', preview({
      active_months: [1], day_counts: null, total_days: null, total: '2000.5', fte: null,
    }))).toBe('1 month · 2 000.50');
    expect(computeLineText(en(), 'en', preview({ total_days: '171.75' }))).toBe('9 months · 171.75 days · 65 200 · 0.75 FTE');
  });

  it('lists the calendar days and the amounts a recompute changes', () => {
    const days = [...SFR_DAYS]; days[2] = '19';
    const months = [...SFR_MONTHS]; months[2] = '7600.00';
    const stored = {
      kind: 'computed' as const, pricing_basis: 'per_day' as const, quantity: '1', unit_price: '400', price_index_pct: '0',
      working_day_profile_code: 'FR218', working_day_profile_name: 'France 218', active_months: FEB_TO_OCT,
      day_counts: SFR_DAYS, total_days: '163', month_amounts: SFR_MONTHS, total: '65200.00', counts_as_fte: true,
    };
    const lines = computeChangeLines(en(), 'en', preview({
      day_counts: days, month_amounts: months,
      stored: { month_amounts: SFR_MONTHS, method: 'computed', last_calculation: stored },
      changed_months: [3], calendar_changed_months: [3],
    }));
    expect(lines).toEqual({ days: ['March: 20 days, now 19'], amounts: ['March: 8 000, now 7 600'] });
    // A round that was not computed has no day counts to compare.
    expect(computeChangeLines(en(), 'en', preview({ changed_months: [], calendar_changed_months: [3] }))).toEqual({ days: [], amounts: [] });
  });

  it('formats money strings without a float', () => {
    expect(formatMoney('65200.00')).toBe('65 200');
    expect(formatMoney('91599.96')).toBe('91 599.96');
    expect(formatMoney('-1234.5')).toBe('-1 234.50');
    expect(formatMoney('123456789012345678.01')).toBe('123 456 789 012 345 678.01');
    expect(formatMoney('0.00')).toBe('0');
    expect(formatMoney('-0.00')).toBe('0');
  });
});
