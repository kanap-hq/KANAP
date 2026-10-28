import type { HistoryFields } from './field-rules';
import { accountsFields } from './records/accounts';
import { costCentersFields } from './records/cost_centers';
import { spendItemsFields } from './records/spend_items';

/**
 * The allow-list of every audit label the history presents: one line per record file, sorted by
 * table name, so two record families never edit the same line. A record file owns its own label
 * and its children's labels; a label absent here shows no field, however old or new the payload.
 */
const FIELD_SETS = [
  accountsFields,
  costCentersFields,
  spendItemsFields,
] as const;

export const HISTORY_FIELDS: Readonly<Record<string, HistoryFields>> = Object.freeze(
  Object.assign({}, ...FIELD_SETS) as Record<string, HistoryFields>,
);

/** A label's allow-list, or an empty one: an undeclared label shows no field. */
export function historyFields(label: string): HistoryFields {
  return Object.prototype.hasOwnProperty.call(HISTORY_FIELDS, label) ? HISTORY_FIELDS[label] : {};
}
