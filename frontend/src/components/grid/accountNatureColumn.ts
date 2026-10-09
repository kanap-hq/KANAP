import type { TFunction } from 'i18next';
import CheckboxSetFilter from '../CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../CheckboxSetFloatingFilter';
import { ACCOUNT_NATURES, accountNatureLabel } from '../../constants/accountNature';

/**
 * Filter and cell text of an account's "Used for" column: a checkbox set filter on the three
 * choices (the blank value is "OPEX and CAPEX") and the label in the cell, which LinkCellRenderer
 * prints from `valueFormatted`. Spread it into the column definition next to field and header.
 */
export function accountNatureColumnProps(t: TFunction) {
  return {
    filter: CheckboxSetFilter,
    floatingFilterComponent: CheckboxSetFloatingFilter,
    filterParams: {
      values: [null, ...ACCOUNT_NATURES].map((value) => ({ value, label: accountNatureLabel(t, value) })),
      searchable: false,
    },
    valueFormatter: (params: { value?: unknown }) => accountNatureLabel(t, params.value),
  };
}
