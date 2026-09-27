import { FIXED_SLOTS, SUMMARY_COLUMNS } from '../../../spend/spend-summary.builder';
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
