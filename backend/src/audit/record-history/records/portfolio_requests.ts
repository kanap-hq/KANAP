import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The portfolio request (lot 2, linked records): its page, the audit labels of its own row and of
 * its children, their allow-lists and the parent rule of the child a rule can find.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rule by `audit-parent-rules.ts`. The attachments name the request in their payload
 * (`request_id`); the migration `1855940000000-audit-log-parent-requests.ts` backfills their parent.
 *
 * The link sets are written from the request with the request in `record_id`, and read by it: its
 * business processes (`setOwnedLink`), its team by role, its budget lines of both natures,
 * applications, assets, dependencies, contacts, web links and the edits of its integrated
 * documents (`portfolio_request_documents`, `{ slot }`). The same budget-line labels written from
 * the line carry the line in `record_id` and stay in its history.
 *
 * The scoring (`criteria_values`, `priority_score`, the `override_*` fields) rides on the
 * request's own row: the presenter names each criterion and option by its label, as for the
 * project. The task the request was created from is `origin_task_id`; the deletion of that task
 * writes its id under `__origin_task_id` (`spend/item-delete-cleanup.ts`), which the presenter
 * reads as `origin_task_id` (`requestAuditPayload`).
 */
export const portfolioRequestsRecord = {
  table: 'portfolio_requests',
  module: 'portfolio_requests',
  level: 'reader',
  auditLabels: ['portfolio_requests'],
  family: 'request',
  children: {
    // The payload names the request (`request_id`).
    portfolio_request_attachments: 'attachment',
    // `record_id` is the request: the sets written from its tabs.
    portfolio_request_business_processes: 'business_process',
    portfolio_request_team: 'team',
    portfolio_request_opex: 'budget_line',
    portfolio_request_capex: 'budget_line',
    portfolio_request_applications: 'application',
    portfolio_request_assets: 'asset',
    portfolio_request_dependencies: 'dependency',
    portfolio_request_contacts: 'contact',
    portfolio_request_urls: 'link',
    portfolio_request_documents: 'document',
  },
  childReads: {
    portfolio_request_business_processes: 'record',
    portfolio_request_team: 'record',
    portfolio_request_opex: 'record',
    portfolio_request_capex: 'record',
    portfolio_request_applications: 'record',
    portfolio_request_assets: 'record',
    portfolio_request_dependencies: 'record',
    portfolio_request_contacts: 'record',
    portfolio_request_urls: 'record',
    portfolio_request_documents: 'record',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A request, as its own audit rows record it (31 columns, plus the task-origin cleanup's keys). */
const REQUEST_FIELDS: HistoryFields = {
  name: shown(),
  status: shown(),
  requestor_id: shown('user'),
  company_id: shown('company'),
  department_id: shown('department'),
  source_id: shown('portfolio_source'),
  category_id: shown('portfolio_category'),
  stream_id: shown('portfolio_stream'),
  target_delivery_date: shown(),
  business_sponsor_id: shown('user'),
  business_lead_id: shown('user'),
  it_sponsor_id: shown('user'),
  it_lead_id: shown('user'),
  converted_date: shown(),
  // The task the request was created from, named under the reader's rights on tasks.
  origin_task_id: shown('task'),
  // The scoring: the criteria are read by the presenter, with their labels.
  criteria_values: hidden('criterion and option ids, presented as the criteria labels'),
  priority_score: shown(),
  priority_override: shown(),
  override_value: shown(),
  override_justification: shown(),
  // Long rich text: the entry says that it changed, never its content.
  purpose: hiddenChanged('request purpose: rich text', 'purposeChanged'),
  risks: hiddenChanged('request risks and mitigations: rich text', 'risksChanged'),
  current_situation: hiddenChanged('current situation: rich text', 'currentSituationChanged'),
  expected_benefits: hiddenChanged('expected benefits: rich text', 'expectedBenefitsChanged'),
  feasibility_review: hiddenChanged('feasibility review: a status and a free comment per area', 'feasibilityReviewChanged'),
  // Written by the deletion of the origin task: its label holds the task title, which a reader
  // without the tasks module may not read; its id is read as `origin_task_id`.
  origin_task: hidden('label of the deleted origin task, with its title; the id beside it names the task'),
  __origin_task_id: hidden('the deleted origin task id, read as origin_task_id'),
  created_by_id: hidden('write author, already the entry actor'),
  item_number: hidden('business reference, named by the page'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The numeric columns of a request: stored as numeric strings, read as numbers. */
export const REQUEST_NUMERIC_FIELDS = ['priority_score', 'override_value'] as const;

/**
 * A request payload as the history reads it: the task-origin cleanup names the deleted task under
 * `__origin_task_id`, which reads as the request's own `origin_task_id`.
 */
export function requestAuditPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const row = payload as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(row, '__origin_task_id') || Object.prototype.hasOwnProperty.call(row, 'origin_task_id')) {
    return payload;
  }
  const { __origin_task_id: originTaskId, ...rest } = row;
  return { ...rest, origin_task_id: originTaskId };
}

/** An attachment of a request: what it is, never where it is stored. */
const ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  source_field: hidden('the screen area the file was dropped on'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  request_id: hidden('the request, the record itself'),
  created_at: hidden('timestamp'),
};

/**
 * The allow-lists of the request's audit labels: the request, then the attachments. The link sets
 * (`portfolio_request_team`, `portfolio_request_applications`...) are presented by their kind,
 * from no field list.
 */
export const portfolioRequestsFields: Readonly<Record<string, HistoryFields>> = {
  portfolio_requests: REQUEST_FIELDS,
  portfolio_request_attachments: ATTACHMENT_FIELDS,
};

/**
 * The request child an audit rule finds: its payload names the request (`request_id`).
 *
 * `1855940000000-audit-log-parent-requests.ts` copies this rule in SQL on purpose.
 */
export const portfolioRequestsParentRules: Readonly<Record<string, AuditParentRule>> = {
  portfolio_request_attachments: { parentTable: 'portfolio_requests', from: 'payload', keys: ['request_id'] },
};
