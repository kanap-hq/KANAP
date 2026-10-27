import { FIXED_SLOTS, fteFieldKey, LineTotalVariant, SUMMARY_COLUMNS } from '../../../spend/spend-summary.builder';
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

/** Whether a budget line metric is money (named with its currency): an amount, a staff or day cost, a cost per FTE or a day rate. */
export function isBudgetMoneyKey(key: string): boolean {
  return MONEY_KEYS.has(key);
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
