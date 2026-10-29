import { FIXED_SLOTS, fteFieldKey, LineTotalVariant, SUMMARY_COLUMNS } from '../../../spend/spend-summary.builder';
import type { MetricKey, ReportMeasure } from '../../../spend/reports/shared/reportAggregates';
import { AiFilterFieldDef, AiMetricFamilyDescription } from '../ai-filter.types';

/**
 * The amount fields of both budget item registries (OPEX and CAPEX): every
 * column of every fixed year, `<slot>_<column>` (`y_plus1_forecast`), read
 * from the summary field `<slot><Suffix>` (`yPlus1Forecast`). One list for
 * both types, so they expose the same keys.
 */
export function budgetAmountFields(): Record<string, AiFilterFieldDef> {
  const fields: Record<string, AiFilterFieldDef> = {};
  for (const slot of FIXED_SLOTS) {
    SUMMARY_COLUMNS.forEach((column, index) => {
      const ai = `${slot.ai}_${column.ai}`;
      // Tenants rename the columns: the description is positional; the tenant's names come with the context.
      fields[ai] = {
        ai,
        grid: `${slot.key}${column.suffix}`,
        type: 'number',
        description: `Total of column ${index + 1} (named ${column.label} by default) for ${slot.offset === 0 ? 'Y, the current year' : slot.label}, in the reporting currency.`,
        sortable: true,
        groupable: false,
        aggregable: true,
      };
    });
  }
  return fields;
}

/** Sort keys of the amount fields, `<slot>_<column>` to `<slot><Suffix>`. */
export function budgetAmountSortFields(): Record<string, string> {
  return Object.fromEntries(Object.values(budgetAmountFields()).map((field) => [field.ai, field.grid]));
}

/**
 * The FTE fields of both budget item registries: every column of every fixed
 * year, `<slot>_<column>_fte` (`y_budget_fte`), read from the summary field
 * `fte_<slot><Suffix>` (`fte_yBudget`). The year and the column are in the
 * key: fields take no parameters.
 */
export function budgetFteFields(): Record<string, AiFilterFieldDef> {
  const fields: Record<string, AiFilterFieldDef> = {};
  for (const slot of FIXED_SLOTS) {
    SUMMARY_COLUMNS.forEach((column, index) => {
      const ai = `${slot.ai}_${column.ai}_fte`;
      fields[ai] = {
        ai,
        grid: fteFieldKey(`${slot.key}${column.suffix}`),
        type: 'number',
        description: `FTE (full-time equivalents) of column ${index + 1} (named ${column.label} by default) for ${slot.offset === 0 ? 'Y, the current year' : slot.label}, `
          + 'from the quantity × price lines the column is computed from. Each month: people lines count their quantity (full time or priced per month), '
          + "or quantity × days per month ÷ the calendar's working days of that month; days lines (a bundle of days over a period) count the month's share "
          + "of the days ÷ the calendar's working days of that month; pieces lines count nothing. The twelve months summed and divided by 12 (2 decimals): "
          + 'the full-year average, not the average over the months the lines cover. '
          + '0 when the lines count neither people nor days (pieces only); null (unknown) when the column has no lines for that year.',
        sortable: true,
        groupable: false,
        aggregable: true,
      };
    });
  }
  return fields;
}

/** Sort keys of the FTE fields, `<slot>_<column>_fte` to `fte_<slot><Suffix>`. */
export function budgetFteSortFields(): Record<string, string> {
  return Object.fromEntries(Object.values(budgetFteFields()).map((field) => [field.ai, field.grid]));
}

/**
 * The line totals of a column, as the "Cost per FTE" report reads them (`staff_cost_<slot><Suffix>`…,
 * `spend-summary.builder.ts`): from the quantity × price lines the column is computed from.
 */
const LINE_TOTALS: ReadonlyArray<{ total: LineTotalVariant; description: string }> = [
  {
    total: 'staff_cost',
    description: 'Staff cost: the cost of the people and days quantity × price lines of the column (pieces lines left out), in the reporting currency, '
      + 'converted like the amounts (a line whose currency has no rate that year is left out). 0 when the column has no line detail.',
  },
  {
    total: 'staff_fte',
    description: 'Staff FTE: the full-year FTE of those people and days lines (the FTE the "Cost per FTE" report divides by). null when the column has no line detail.',
  },
  {
    total: 'day_cost',
    description: 'Day cost: the cost of the lines priced per day (people priced per day, bundles of days), in the reporting currency. 0 without line detail.',
  },
  {
    total: 'days',
    description: 'Days bought: the days those per-day lines buy (a bundle\'s quantity, the days a person works × the quantity). null without line detail or without a per-day line.',
  },
];

/** A family of generated budget keys, `<year>_<column>_<suffix>`: one entry of describe_entity_filters for its 25 keys. */
export const budgetFamilyName = (suffix: string) => `<year>_<column>_${suffix}`;

/** `y_minus2`, `y_minus1`, `y`, `y_plus1`, `y_plus2` with their offset, and the column names: how a family key is built. */
const KEY_GRAMMAR = 'Keys `<year>_<column>_…`: <year> is y (the current year), y_minus1, y_minus2, y_plus1 or y_plus2; '
  + '<column> is budget, review, forecast, actual or landing (the five budget columns, in order).';

/**
 * The line totals of every column of every fixed year, `<slot>_<column>_<total>`
 * (`y_budget_staff_cost`, `y_plus1_review_days`), read from the engine's
 * `<total>_<slot><Suffix>`. Numbers: filtered, sorted and summed like the amounts.
 */
export function budgetLineTotalFields(): Record<string, AiFilterFieldDef> {
  const fields: Record<string, AiFilterFieldDef> = {};
  for (const { total, description } of LINE_TOTALS) {
    for (const slot of FIXED_SLOTS) {
      for (const column of SUMMARY_COLUMNS) {
        const ai = `${slot.ai}_${column.ai}_${total}`;
        fields[ai] = {
          ai,
          grid: `${total}_${slot.key}${column.suffix}`,
          type: 'number',
          description: `${description} ${KEY_GRAMMAR}`,
          family: budgetFamilyName(total),
          sortable: true,
          groupable: false,
          aggregable: true,
        };
      }
    }
  }
  return fields;
}

/** The year and column a budget key names (`y_plus1_review` for `y_plus1_review_staff_fte`, `y_plus1_review_fte`, `y_plus1_review`); null for any other key. */
export function budgetPairOfKey(key: string): string | null {
  for (const slot of FIXED_SLOTS) {
    for (const column of SUMMARY_COLUMNS) {
      const pair = `${slot.ai}_${column.ai}`;
      if (key === pair || key === `${pair}_fte` || LINE_TOTALS.some(({ total }) => key === `${pair}_${total}`)) return pair;
    }
  }
  return null;
}

/** The line total fields of these years and columns (`y_budget`...), in the registry's order. */
export function budgetLineTotalFieldsOf(pairs: ReadonlySet<string>): AiFilterFieldDef[] {
  return Object.values(budgetLineTotalFields()).filter((field) => pairs.has(budgetPairOfKey(field.ai)!));
}

/** Sort keys of the line total fields. */
export function budgetLineTotalSortFields(): Record<string, string> {
  return Object.fromEntries(Object.values(budgetLineTotalFields()).map((field) => [field.ai, field.grid]));
}

/** Every key of a budget line in the reporting currency: the amounts, the staff and day costs, the two ratios. */
const MONEY_KEYS: ReadonlySet<string> = new Set(FIXED_SLOTS.flatMap((slot) => SUMMARY_COLUMNS.flatMap((column) => {
  const pair = `${slot.ai}_${column.ai}`;
  return [pair, `${pair}_staff_cost`, `${pair}_day_cost`, `${pair}_cost_per_fte`, `${pair}_day_rate`];
})));

/** Whether a budget line metric is money (named with its currency): an amount, a staff or day cost, a cost per FTE, a day rate or a change between two amounts. */
export function isBudgetMoneyKey(key: string): boolean {
  return MONEY_KEYS.has(key) || resolveBudgetDeltaMetric(key)?.measure === 'amount';
}

export type BudgetRatioKind = 'cost_per_fte' | 'day_rate';

/** The engine fields a ratio metric of one year and column reads. */
export type BudgetRatioMetric = {
  key: string;
  kind: BudgetRatioKind;
  staffCost: string;
  staffFte: string;
  dayCost: string;
  days: string;
  /** The FTE declared without line detail (`fte_nodetail_…`): left out of the figures, as the report says. */
  noDetail: string;
  /** The FTE of a column whose amount no longer follows its lines (`fte_detached_…`): the report's notice. */
  detached: string;
};

export const BUDGET_RATIO_DESCRIPTIONS: Record<BudgetRatioKind, string> = {
  cost_per_fte: 'Cost per FTE, computed by the server as the "Cost per FTE" report does: staff cost ÷ staff FTE of each group '
    + '(and of all groups together for the overall row), from the people and days quantity × price lines (pieces left out), in the reporting currency. '
    + 'Keeps every group with line detail, with its day rate: the metric for FTE and day rate per group.',
  day_rate: 'Average day rate (TJM), computed by the server as the daily rate view of the "Cost per FTE" report: day cost ÷ days bought of each group '
    + '(and of all groups together), from the lines priced per day, in the reporting currency. Keeps only the groups with days bought.',
};

/** `<slot>_<column>_cost_per_fte` or `<slot>_<column>_day_rate` (`y_budget_day_rate`); null for any other key. */
export function resolveBudgetRatioMetric(key: string | undefined | null): BudgetRatioMetric | null {
  const match = /^(.+)_(cost_per_fte|day_rate)$/.exec(String(key ?? ''));
  if (!match) return null;
  for (const slot of FIXED_SLOTS) {
    for (const column of SUMMARY_COLUMNS) {
      if (`${slot.ai}_${column.ai}` !== match[1]) continue;
      const suffix = `${slot.key}${column.suffix}`;
      return {
        key: match[0],
        kind: match[2] as BudgetRatioKind,
        staffCost: `staff_cost_${suffix}`,
        staffFte: `staff_fte_${suffix}`,
        dayCost: `day_cost_${suffix}`,
        days: `days_${suffix}`,
        noDetail: `fte_nodetail_${suffix}`,
        detached: `fte_detached_${suffix}`,
      };
    }
  }
  return null;
}

/** The ratio metrics of aggregate_entities on budget lines, as describe_entity_filters lists them (one entry per family). */
export function budgetRatioMetricFamilies(): AiMetricFamilyDescription[] {
  return (Object.keys(BUDGET_RATIO_DESCRIPTIONS) as BudgetRatioKind[]).map((kind) => ({
    family: budgetFamilyName(kind),
    description: `${BUDGET_RATIO_DESCRIPTIONS[kind]} aggregate_entities only (metric, no function needed): each group also returns staff_fte, staff_cost, cost_per_fte, days, day_cost and day_rate. ${KEY_GRAMMAR}`,
    metrics: FIXED_SLOTS.flatMap((slot) => SUMMARY_COLUMNS.map((column) => `${slot.ai}_${column.ai}_${kind}`)),
  }));
}

/** A year and column of the window as the reports name them: the calendar year and the report's column (`revision` for `review`). */
export type BudgetColumnYear = { year: number; metric: MetricKey };

/** `y_plus1_review` to its year and column (the current year from the server's clock, as the list engine reads `y`); null for any other key. */
function budgetColumnYearOf(pair: string, currentYear: number): BudgetColumnYear | null {
  for (const slot of FIXED_SLOTS) {
    for (const column of SUMMARY_COLUMNS) {
      if (`${slot.ai}_${column.ai}` === pair) return { year: currentYear + slot.offset, metric: column.key };
    }
  }
  return null;
}

/** A change between two columns: destination minus source, in amounts or in FTE. */
export type BudgetDeltaMetric = { key: string; measure: ReportMeasure; source: BudgetColumnYear; destination: BudgetColumnYear };

/**
 * `<year>_<column>_minus_<year>_<column>` (destination minus source, `y_review_minus_y_budget`), or
 * the same with `_fte` on both sides (`y_review_fte_minus_y_budget_fte`); null for any other key,
 * a column minus itself included.
 */
export function resolveBudgetDeltaMetric(key: string | undefined | null, currentYear = new Date().getFullYear()): BudgetDeltaMetric | null {
  const match = /^(.+?)_minus_(.+)$/.exec(String(key ?? ''));
  if (!match) return null;
  const fte = match[1].endsWith('_fte') && match[2].endsWith('_fte');
  const side = (text: string) => budgetColumnYearOf(fte ? text.slice(0, -'_fte'.length) : text, currentYear);
  const destination = side(match[1]);
  const source = side(match[2]);
  if (!destination || !source || (destination.year === source.year && destination.metric === source.metric)) return null;
  return { key: match[0], measure: fte ? 'fte' : 'amount', source, destination };
}

/** The FTE of each month of one year and column. */
export type BudgetMonthlyFteMetric = { key: string } & BudgetColumnYear;

/** `<year>_<column>_fte_by_month` (`y_budget_fte_by_month`); null for any other key. */
export function resolveBudgetMonthlyFteMetric(key: string | undefined | null, currentYear = new Date().getFullYear()): BudgetMonthlyFteMetric | null {
  const match = /^(.+)_fte_by_month$/.exec(String(key ?? ''));
  const column = match ? budgetColumnYearOf(match[1], currentYear) : null;
  return column ? { key: match![0], ...column } : null;
}

export const BUDGET_DELTA_FAMILY = '<year>_<column>_minus_<year>_<column>';
export const BUDGET_MONTHLY_FTE_FAMILY = budgetFamilyName('fte_by_month');

/** The change and monthly FTE metrics of aggregate_entities on budget lines, as describe_entity_filters lists them. */
export function budgetReportMetricFamilies(): AiMetricFamilyDescription[] {
  return [
    {
      family: BUDGET_DELTA_FAMILY,
      description: 'Change between two columns, computed by the server as the "Top increase / decrease" report: the destination minus the source, line by line '
        + '(`y_review_minus_y_budget` is the revision of Y minus its budget, `y_plus1_budget_minus_y_budget` next year\'s budget minus this year\'s), any two years and columns; '
        + 'with `_fte` on both sides (`y_review_fte_minus_y_budget_fte`), the same change in FTE. aggregate_entities only (metric, no function needed): '
        + '`direction` increase (the default) keeps the groups that rise, largest first, decrease the groups that fall; `limit` keeps 10 groups by default (at most 100); '
        + 'group_by line gives the lines themselves, by reference and title, as the report does: use it unless the person names another axis (by supplier). Each group returns previous, current, delta and pct_increase (null when the source is 0 or less); '
        + `overall gives previous, current, net, gross_increase and gross_decrease over every line the filters keep. ${KEY_GRAMMAR}`,
      examples: ['y_review_minus_y_budget', 'y_budget_minus_y_minus1_budget', 'y_plus1_budget_minus_y_budget', 'y_landing_minus_y_budget', 'y_review_fte_minus_y_budget_fte'],
    },
    {
      family: BUDGET_MONTHLY_FTE_FAMILY,
      description: 'FTE month by month, computed by the server as the "Staffing by month" report: each group returns months (January to December, null for a month '
        + 'no line of the group details), average (the sum of the months ÷ 12, the full-year average) and peak (the highest month); the groups without any month are left out, '
        + 'largest average first. Lines priced per piece count no FTE. aggregate_entities only (metric, no function needed); overall gives the same over every line, '
        + `with the FTE the months leave out (see monthly_fte_note). ${KEY_GRAMMAR}`,
      metrics: FIXED_SLOTS.flatMap((slot) => SUMMARY_COLUMNS.map((column) => `${slot.ai}_${column.ai}_fte_by_month`)),
    },
  ];
}
