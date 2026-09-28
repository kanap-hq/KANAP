import { FIXED_SLOTS, fteFieldKey, SUMMARY_COLUMNS } from '../../../spend/spend-summary.builder';
import { AiFilterFieldDef } from '../ai-filter.types';

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
        description: `FTE (full-time equivalents) of column ${index + 1} (named ${column.label} by default) for ${slot.offset === 0 ? 'Y, the current year' : slot.label}: `
          + 'the quantity of a line whose costing inputs count as FTE, summed over the months that hold a positive amount, divided by 12 (2 decimals). '
          + '0 when the costing inputs do not count as FTE; null (unknown) when the line has no costing inputs for that year and column.',
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
