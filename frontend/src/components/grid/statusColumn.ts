import type { TFunction } from 'i18next';
import CheckboxSetFilter from '../CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../CheckboxSetFloatingFilter';
import { STATUS_VALUES } from '../../constants/status';

/**
 * Filter and cell text of an enabled / disabled status column: a checkbox set filter on the
 * two values and the translated label in the cell, which LinkCellRenderer prints from
 * `valueFormatted`. Spread it into the column definition next to field, header and renderer.
 */
export function statusColumnProps(t: TFunction) {
  const label = (value: unknown) => (value ? t(`common:statuses.${String(value)}`) : '');
  return {
    filter: CheckboxSetFilter,
    floatingFilterComponent: CheckboxSetFloatingFilter,
    filterParams: {
      values: STATUS_VALUES.map((value) => ({ value, label: label(value) })),
      searchable: false,
    },
    valueFormatter: (params: { value?: unknown }) => label(params.value),
  };
}
