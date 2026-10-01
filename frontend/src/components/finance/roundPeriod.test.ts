import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import enOps from '../../locales/en/ops.json';
import frOps from '../../locales/fr/ops.json';
import {
  RoundInput,
  RoundLine,
  activeMonths,
  basisForUnit,
  dateProblem,
  isDateLine,
  centsToDecimal,
  changedDays,
  chipLines,
  chipText,
  chipUnits,
  columnLabel,
  columnPeriod,
  dayChangeText,
  formatFteValue,
  formatMoney,
  formatUplift,
  hasLines,
  lineText,
  linePayloadOf,
  linesText,
  sameLine,
  trimDecimal,
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
  fte: null,
  lines: [],
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


const line = (over: Partial<RoundLine> = {}): RoundLine => ({
  id: 'l1',
  sort: 0,
  label: 'Project manager',
  quantity_unit: 'days',
  quantity: '20.000',
  unit_price: '900.0000',
  price_basis: 'per_day',
  frequency: 'once',
  days_per_month: null,
  period_start: '2026-01-01',
  period_end: '2026-06-30',
  working_day_profile_id: 'cal-1',
  working_day_profile_code: 'FR',
  working_day_profile_name: 'France',
  ...over,
});

const computed = (lines: RoundLine[], fte: string | null) => record({
  method: 'computed',
  spread_profile_name: null,
  fte,
  lines,
  last_calculation: {
    kind: 'computed', total: '18000.00', fte, fte_period: fte, month_amounts: [], fte_months: [], active_months: [1, 2, 3, 4, 5, 6], lines: [],
  },
});

describe('columns built from lines', () => {
  it('names the lines, their count and the FTE in the chip', () => {
    const three = computed([
      line(),
      line({ id: 'l2', quantity_unit: 'people', price_basis: 'per_month', frequency: 'per_month', working_day_profile_id: null }),
      line({ id: 'l3', quantity_unit: 'pieces', price_basis: 'per_piece', frequency: 'once', working_day_profile_id: null }),
    ], '0.12');
    // The FTE of the chip is the full-year average, as the lists show it.
    expect(chipText(en(), 'en', three)).toBe('Quantity and price · 3 lines · 0.12 FTE');
    // A narrow header wraps between the way and the figures, never inside either.
    expect(chipUnits(en(), 'en', three)).toEqual(['Quantity and price ·', '3 lines · 0.12 FTE']);
    expect(chipText(fr(), 'fr', three)).toBe('Quantité et prix · 3 lignes · 0.12 ETP');
    // Pieces only: no FTE to show.
    expect(chipText(en(), 'en', computed([line({ quantity_unit: 'pieces', price_basis: 'per_piece', frequency: 'per_month', working_day_profile_id: null })], '0.00'))).toBe('Quantity and price · 1 line');
    expect(chipUnits(en(), 'en', undefined)).toEqual([]);
    // One line of text: the lines are what the column is computed from.
    expect(chipLines(en(), 'en', three)).toEqual([['Quantity and price ·', '3 lines · 0.12 FTE']]);
    expect(chipLines(en(), 'en', record({}))).toEqual([['Spread flat']]);
    expect(hasLines(record({}))).toBe(false);
    expect(hasLines(record({ lines: [line()] }))).toBe(true);
  });

  it('a column that keeps its lines after a spread, a hand edit or a copy names them first, then what produced the amounts', () => {
    const kept = (over: Partial<RoundInput>) => record({ lines: [line(), line({ id: 'l2' })], fte: '1.00', ...over });
    const spread445 = kept({ spread_profile_name: '4-4-5', last_calculation: { kind: 'annual', total: '1.00', profile: '4-4-5', active_months: [1], weights: [] } });
    expect(chipText(en(), 'en', spread445)).toBe('Quantity and price · 2 lines · 1.00 FTE · Spread 4-4-5');
    // The way the amounts were produced starts a line of its own; the separators stay at the end of a unit.
    expect(chipLines(en(), 'en', spread445)).toEqual([['Quantity and price ·', '2 lines · 1.00 FTE ·'], ['Spread 4-4-5']]);
    expect(chipUnits(en(), 'en', spread445)).toEqual(['Quantity and price ·', '2 lines · 1.00 FTE ·', 'Spread 4-4-5']);
    expect(chipText(en(), 'en', kept({ method: 'manual' }))).toBe('Quantity and price · 2 lines · 1.00 FTE · Edited by hand');
    const copied = kept({
      method: 'copied',
      last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: '5', source_total: '1.00', total: '1.05', source_method: 'computed' },
    });
    expect(chipLines(en(), 'en', copied)).toEqual([['Quantity and price ·', '2 lines · 1.00 FTE ·'], ['Copied from Budget 2025 +5%']]);
    // Pieces only: no FTE, as for a computed column.
    const pieces = line({ quantity_unit: 'pieces', price_basis: 'per_piece', frequency: 'per_month', working_day_profile_id: null });
    expect(chipText(en(), 'en', record({ lines: [pieces], fte: '0.00' }))).toBe('Quantity and price · 1 line · Spread flat');
    // The tooltip lists the lines the chip names.
    expect(linesText(en(), 'en', kept({ method: 'manual' }))).toBe('Project manager: 20 days × 900 per day over the period, Jan to Jun\nProject manager: 20 days × 900 per day over the period, Jan to Jun');
  });

  it('lists the lines for the tooltip of a column computed from them', () => {
    const person = { quantity_unit: 'people', quantity: '1', price_basis: 'per_day', frequency: 'per_month' } as const;
    expect(lineText(en(), 'en', line({ ...person, unit_price: '1200', days_per_month: '5.000', period_start: '2026-02-01', period_end: '2026-07-31' })))
      .toBe('Project manager: 1 person × 1 200 per day, 5 days per month, Feb to Jul');
    expect(lineText(en(), 'en', line({ ...person, label: 'Consultant', unit_price: '400', days_per_month: null, period_start: '2026-02-01', period_end: '2026-10-31' })))
      .toBe('Consultant: 1 person × 400 per day, full time, Feb to Oct');
    expect(lineText(en(), 'en', line({ ...person, label: '', unit_price: '400', days_per_month: '1' })))
      .toBe('1 person × 400 per day, 1 day per month, Jan to Jun');
    expect(lineText(en(), 'en', line({ ...person, label: '  ', price_basis: 'per_month', unit_price: '8000', period_start: '2026-03-01', period_end: '2026-03-31' })))
      .toBe('1 person × 8 000 per month, Mar');
    // One date lands in its month, whatever its day.
    expect(lineText(en(), 'en', line({ label: 'Laptop', quantity_unit: 'pieces', quantity: '1', price_basis: 'per_piece', unit_price: '2000', period_start: '2026-03-01', period_end: '2026-03-01' })))
      .toBe('Laptop: 1 piece × 2 000 once, Mar');
    expect(lineText(en(), 'en', line({ label: 'Laptop', quantity_unit: 'pieces', quantity: '1', price_basis: 'per_piece', unit_price: '2000', period_start: '2026-03-20', period_end: '2026-03-20' })))
      .toBe('Laptop: 1 piece × 2 000 once, Mar');
    // Days on one date, as the API accepts them, land there too.
    expect(lineText(en(), 'en', line({ label: 'Audit', quantity: '3', unit_price: '1200', period_start: '2026-03-20', period_end: '2026-03-20' })))
      .toBe('Audit: 3 days × 1 200 per day over the period, Mar');
    expect(lineText(en(), 'en', line({ label: 'Licences', quantity_unit: 'pieces', quantity: '50', price_basis: 'per_piece', frequency: 'per_month', unit_price: '12', period_start: '2026-01-01', period_end: '2026-12-31' })))
      .toBe('Licences: 50 pieces × 12 per piece per month, Jan to Dec');
    expect(lineText(en(), 'en', line({ label: 'Bundle', quantity: '30', unit_price: '1200', period_start: '2026-02-01', period_end: '2026-07-31' })))
      .toBe('Bundle: 30 days × 1 200 per day over the period, Feb to Jul');
    expect(lineText(fr(), 'fr', line())).toMatch(/^Project manager : 20 jours × 900 par jour sur la période, janv\.? à juin$/);
    const two = computed([line(), line({ id: 'l2', label: 'Licences', quantity_unit: 'pieces', quantity: '3', price_basis: 'per_piece', frequency: 'per_month', unit_price: '10' })], '0.5');
    expect(linesText(en(), 'en', two)).toBe('Project manager: 20 days × 900 per day over the period, Jan to Jun\nLicences: 3 pieces × 10 per piece per month, Jan to Jun');
    // No lines, no tooltip.
    expect(linesText(en(), 'en', record({}))).toBe('');
  });

  it('compares lines by value and keeps the price allowed by the unit', () => {
    expect(trimDecimal('20.000')).toBe('20');
    expect(trimDecimal('900.5000')).toBe('900.5');
    expect(trimDecimal('0.000')).toBe('0');
    expect(trimDecimal('-1.250')).toBe('-1.25');
    const stored = line();
    expect(sameLine(linePayloadOf(stored), { ...linePayloadOf(stored), quantity: '20', unit_price: '900' })).toBe(true);
    expect(sameLine(linePayloadOf(stored), { ...linePayloadOf(stored), quantity: '21' })).toBe(false);
    expect(sameLine(linePayloadOf(stored), { ...linePayloadOf(stored), frequency: 'per_month' })).toBe(false);
    // The calendar only matters for a price per day.
    expect(linePayloadOf({ ...linePayloadOf(stored), price_basis: 'per_month' }).working_day_profile_id).toBeNull();
    // Days per month only for people priced per day, compared by value.
    const person = linePayloadOf({ ...linePayloadOf(stored), quantity_unit: 'people', frequency: 'per_month', days_per_month: '5.000' });
    expect(person.days_per_month).toBe('5');
    expect(linePayloadOf({ ...person, price_basis: 'per_month' }).days_per_month).toBeNull();
    expect(linePayloadOf({ ...linePayloadOf(stored), days_per_month: '5' }).days_per_month).toBeNull();
    expect(basisForUnit('people', 'per_month')).toBe('per_month');
    expect(basisForUnit('people', 'per_piece')).toBe('per_day');
    expect(basisForUnit('days', 'per_month')).toBe('per_day');
    expect(basisForUnit('pieces', 'per_day')).toBe('per_piece');
  });

  it('takes one date for pieces bought once, any real date of the year', () => {
    const laptop = { quantity_unit: 'pieces', frequency: 'once', period_start: '2026-03-15', period_end: '2026-03-15' } as const;
    expect(isDateLine(laptop)).toBe(true);
    // A range sent by another client stays a range; pieces each month take From and To.
    expect(isDateLine({ ...laptop, period_end: '2026-04-15' })).toBe(false);
    expect(isDateLine({ ...laptop, frequency: 'per_month' })).toBe(false);
    expect(isDateLine({ ...laptop, quantity_unit: 'days' })).toBe(false);
    expect(dateProblem(2026, '2026-03-01')).toBeNull();
    expect(dateProblem(2026, '')).toBe('dateMissing');
    expect(dateProblem(2026, '2026-02-30')).toBe('dateInvalid');
    expect(dateProblem(2026, '2027-01-01')).toBe('dateOutsideYear');
  });

  it('finds the working days that changed since the last computation', () => {
    const before = ['21', '20', '22', '21', '17', '22', '22', '21', '22', '22', '20', '22'];
    const after = [...before]; after[2] = '21'; after[10] = '19.5';
    expect(changedDays(before, after, [1, 2, 3, 4, 5, 6])).toEqual([{ month: 3, before: '22', after: '21' }]);
    expect(changedDays(before, after, [11])).toEqual([{ month: 11, before: '20', after: '19.5' }]);
    // Same values written differently are the same days.
    expect(changedDays(['20.0', ...before.slice(1)], ['20', ...before.slice(1)], [1])).toEqual([]);
    expect(changedDays(before, null, [1])).toEqual([]);
    expect(dayChangeText(en(), 'en', { month: 3, before: '22', after: '21' })).toBe('March: 22 days, now 21');
    expect(dayChangeText(en(), 'en', { month: 3, before: '1', after: '0.5' })).toBe('March: 1 day, now 0.5');
  });

  it('formats money and FTE strings without a float', () => {
    expect(formatMoney('65200.00')).toBe('65 200');
    expect(formatMoney('91599.96')).toBe('91 599.96');
    expect(formatMoney('-1234.5')).toBe('-1 234.50');
    expect(formatMoney('123456789012345678.01')).toBe('123 456 789 012 345 678.01');
    expect(formatMoney('0.00')).toBe('0');
    expect(formatMoney('-0.00')).toBe('0');
    expect(formatFteValue('1')).toBe('1.00');
    expect(formatFteValue('0.75')).toBe('0.75');
    expect(formatFteValue('1234.5')).toBe('1 234.50');
  });
});
