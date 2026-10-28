import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The business process: its page, its own audit label, its application links and their allow-lists.
 *
 * `application_business_processes` is a child read by `record`: the link's writer names the
 * process in `record_id` and the application in the payload (`application_id`), so no parent rule
 * is needed. `portfolio_request_business_processes` is not a child and not an exclusion: the
 * request side writes it with the request in `record_id` and the whole set of process ids in the
 * payload, so no single process can be read from that row, and the inventory's `exclusions` list is
 * reserved for the data-access tables of a line. The request's own history reads it.
 */
export const businessProcessesRecord = {
  table: 'business_processes',
  module: 'business_processes',
  level: 'reader',
  auditLabels: ['business_processes'],
  family: 'business_process',
  children: {
    application_business_processes: 'application',
  },
  childReads: {
    application_business_processes: 'record',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A business process, as its page shows it; the category names are a payload snapshot. */
const BUSINESS_PROCESS_FIELDS: HistoryFields = {
  name: shown(),
  description: shown(),
  notes: shown(),
  status: shown(),
  disabled_at: shown(),
  is_default: shown(),
  owner_user_id: shown('user'),
  it_owner_user_id: shown('user'),
  categories: hidden('category links, never a column of the process; the category page reads them'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A link between an application and a process: the process is the record, the application the value. */
const APPLICATION_BUSINESS_PROCESS_FIELDS: HistoryFields = {
  application_id: shown('application'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the process and its application links. */
export const businessProcessesFields: Readonly<Record<string, HistoryFields>> = {
  business_processes: BUSINESS_PROCESS_FIELDS,
  application_business_processes: APPLICATION_BUSINESS_PROCESS_FIELDS,
};
