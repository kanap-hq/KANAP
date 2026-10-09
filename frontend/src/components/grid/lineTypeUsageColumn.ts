import type { TFunction } from 'i18next';
import CheckboxSetFilter from '../CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../CheckboxSetFloatingFilter';
import { LINE_TYPES, lineTypeUsageLabel } from '../../constants/lineTypeUsage';

/**
 * Filter and cell text of a "Used for" column (an account's `nature`, an analytics value's
 * `applies_to`): a checkbox set filter on the three choices (the blank value is "OPEX and CAPEX")
 * and the label in the cell, which LinkCellRenderer prints from `valueFormatted`. Spread it into
 * the column definition next to field and header.
 */
export function lineTypeUsageColumnProps(t: TFunction) {
  return {
    filter: CheckboxSetFilter,
    floatingFilterComponent: CheckboxSetFloatingFilter,
    filterParams: {
      values: [null, ...LINE_TYPES].map((value) => ({ value, label: lineTypeUsageLabel(t, value) })),
      searchable: false,
    },
    valueFormatter: (params: { value?: unknown }) => lineTypeUsageLabel(t, params.value),
  };
}
