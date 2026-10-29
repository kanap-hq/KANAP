import type { HistoryFields } from './field-rules';
import { accountsFields } from './records/accounts';
import { analyticsAxesFields } from './records/analytics_axes';
import { analyticsCategoriesFields } from './records/analytics_categories';
import { applicationsFields } from './records/applications';
import { assetsFields } from './records/assets';
import { businessProcessesFields } from './records/business_processes';
import { companiesFields } from './records/companies';
import { connectionsFields } from './records/connections';
import { contactsFields } from './records/contacts';
import { contractsFields } from './records/contracts';
import { costCentersFields } from './records/cost_centers';
import { departmentsFields } from './records/departments';
import { documentsFields } from './records/documents';
import { incidentsFields } from './records/incidents';
import { interfacesFields } from './records/interfaces';
import { locationsFields } from './records/locations';
import { portfolioProjectsFields } from './records/portfolio_projects';
import { spendItemsFields } from './records/spend_items';
import { suppliersFields } from './records/suppliers';
import { tasksFields } from './records/tasks';
import { technologiesFields } from './records/technologies';
import { workingDayProfilesFields } from './records/working_day_profiles';

/**
 * The allow-list of every audit label the history presents: one line per record file, sorted by
 * table name, so two record families never edit the same line. A record file owns its own label
 * and its children's labels; a label absent here shows no field, however old or new the payload.
 */
const FIELD_SETS = [
  accountsFields,
  analyticsAxesFields,
  analyticsCategoriesFields,
  applicationsFields,
  assetsFields,
  businessProcessesFields,
  companiesFields,
  connectionsFields,
  contactsFields,
  contractsFields,
  costCentersFields,
  departmentsFields,
  documentsFields,
  incidentsFields,
  interfacesFields,
  locationsFields,
  portfolioProjectsFields,
  spendItemsFields,
  suppliersFields,
  tasksFields,
  technologiesFields,
  workingDayProfilesFields,
] as const;

export const HISTORY_FIELDS: Readonly<Record<string, HistoryFields>> = Object.freeze(
  Object.assign({}, ...FIELD_SETS) as Record<string, HistoryFields>,
);

/** A label's allow-list, or an empty one: an undeclared label shows no field. */
export function historyFields(label: string): HistoryFields {
  return Object.prototype.hasOwnProperty.call(HISTORY_FIELDS, label) ? HISTORY_FIELDS[label] : {};
}
