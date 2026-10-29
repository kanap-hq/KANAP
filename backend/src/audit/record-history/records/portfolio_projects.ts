import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The portfolio project (lot 2, linked records): its page, the audit labels of its own row and of
 * its children, their allow-lists and the parent rules of the children a rule can find.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. The phases, milestones, attachments and time entries
 * name the project in their payload (`project_id`); the migration
 * `1855930000000-audit-log-parent-projects.ts` backfills their parent, with the project's tasks
 * (`tasks`, type `project`, shared rule in `audit-parent-rules.ts`).
 *
 * The link sets are written from the project with the project in `record_id`, and read by it:
 * its team by role, its budget lines of both natures, applications, assets, technologies,
 * dependencies, contacts, web links, effort allocations and the edits of its integrated documents
 * (`portfolio_project_documents`, `{ slot }`). The same labels written from the other side (a
 * budget line, an application, an asset) carry that object in `record_id` and stay in its history.
 *
 * The scoring (`criteria_values`, `priority_score`, the `override_*` fields) rides on the
 * project's own row: the presenter names each criterion and option by its label.
 */
export const portfolioProjectsRecord = {
  table: 'portfolio_projects',
  module: 'portfolio_projects',
  level: 'reader',
  auditLabels: ['portfolio_projects'],
  family: 'project',
  children: {
    // The payload names the project (`project_id`).
    portfolio_project_phases: 'phase',
    portfolio_project_milestones: 'milestone',
    portfolio_project_attachments: 'attachment',
    portfolio_project_time_entries: 'time_entry',
    // The project's tasks: the saved task names it (`related_object_type` = 'project').
    tasks: 'task',
    // `record_id` is the project: the sets written from its tabs.
    technology_projects: 'technology',
    portfolio_project_team: 'team',
    portfolio_project_effort_allocations: 'team',
    portfolio_project_opex: 'budget_line',
    portfolio_project_capex: 'budget_line',
    application_projects: 'application',
    asset_projects: 'asset',
    portfolio_project_dependencies: 'dependency',
    portfolio_project_contacts: 'contact',
    portfolio_project_urls: 'link',
    portfolio_project_documents: 'document',
  },
  childReads: {
    technology_projects: 'record',
    portfolio_project_team: 'record',
    portfolio_project_effort_allocations: 'record',
    portfolio_project_opex: 'record',
    portfolio_project_capex: 'record',
    application_projects: 'record',
    asset_projects: 'record',
    portfolio_project_dependencies: 'record',
    portfolio_project_contacts: 'record',
    portfolio_project_urls: 'record',
    portfolio_project_documents: 'record',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A project, as its own audit rows record it (39 columns, plus the conversion's source request). */
const PROJECT_FIELDS: HistoryFields = {
  name: shown(),
  status: shown(),
  origin: shown(),
  scheduling_mode: shown(),
  company_id: shown('company'),
  department_id: shown('department'),
  source_id: shown('portfolio_source'),
  category_id: shown('portfolio_category'),
  stream_id: shown('portfolio_stream'),
  business_sponsor_id: shown('user'),
  business_lead_id: shown('user'),
  it_sponsor_id: shown('user'),
  it_lead_id: shown('user'),
  planned_start: shown(),
  planned_end: shown(),
  actual_start: shown(),
  actual_end: shown(),
  baseline_start_date: shown(),
  baseline_end_date: shown(),
  estimated_effort_it: shown(),
  estimated_effort_business: shown(),
  baseline_effort_it: shown(),
  baseline_effort_business: shown(),
  actual_effort_it: shown(),
  actual_effort_business: shown(),
  execution_progress: shown(),
  it_effort_allocation_mode: shown(),
  business_effort_allocation_mode: shown(),
  // The scoring: the criteria are read by the presenter, with their labels.
  criteria_values: hidden('criterion and option ids, presented as the criteria labels'),
  priority_score: shown(),
  priority_override: shown(),
  override_value: shown(),
  override_justification: shown(),
  // The conversion of a request writes the request it came from beside the saved row.
  source_request_id: shown('request'),
  // Long rich text: the entry says that the purpose changed, never its content.
  purpose: hiddenChanged('project purpose: rich text', 'purposeChanged'),
  item_number: hidden('business reference, named by the page'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The numeric columns of a project: stored as numeric strings, read as numbers. */
export const PROJECT_NUMERIC_FIELDS = [
  'priority_score', 'override_value', 'execution_progress',
  'estimated_effort_it', 'estimated_effort_business', 'baseline_effort_it', 'baseline_effort_business',
  'actual_effort_it', 'actual_effort_business',
] as const;

/** A phase of the project's timeline: the presenter reads its status as the phase status. */
const PHASE_FIELDS: HistoryFields = {
  name: shown(),
  planned_start: shown(),
  planned_end: shown(),
  status: shown(),
  sequence: hidden('order on the timeline'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  project_id: hidden('the project, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A milestone: the presenter reads its status as the milestone status. */
const MILESTONE_FIELDS: HistoryFields = {
  name: shown(),
  target_date: shown(),
  status: shown(),
  phase_id: hidden('a phase of the same project, without a reference family'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  project_id: hidden('the project, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An attachment of a project: what it is, never where it is stored. */
const ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  source_field: hidden('the screen area the file was dropped on'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  project_id: hidden('the project, the record itself'),
  created_at: hidden('timestamp'),
};

/** A time entry: the person, the effort type and the hours. */
const TIME_ENTRY_FIELDS: HistoryFields = {
  user_id: shown('user'),
  category: shown(),
  hours: shown(),
  logged_at: shown(),
  notes: shown(),
  logged_by_id: hidden('write author, already the entry actor'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  project_id: hidden('the project, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/**
 * The allow-lists of the project's audit labels: the project, then the children whose fields the
 * history reads. The link sets (`portfolio_project_team`, `application_projects`...) are presented
 * by their kind, from no field list.
 */
export const portfolioProjectsFields: Readonly<Record<string, HistoryFields>> = {
  portfolio_projects: PROJECT_FIELDS,
  portfolio_project_phases: PHASE_FIELDS,
  portfolio_project_milestones: MILESTONE_FIELDS,
  portfolio_project_attachments: ATTACHMENT_FIELDS,
  portfolio_project_time_entries: TIME_ENTRY_FIELDS,
};

/**
 * The project children an audit rule finds: their payload names the project (`project_id`). The
 * project's tasks use the shared task rule of `audit-parent-rules.ts`.
 *
 * `1855930000000-audit-log-parent-projects.ts` copies these rules in SQL on purpose.
 */
export const portfolioProjectsParentRules: Readonly<Record<string, AuditParentRule>> = {
  portfolio_project_phases: { parentTable: 'portfolio_projects', from: 'payload', keys: ['project_id'] },
  portfolio_project_milestones: { parentTable: 'portfolio_projects', from: 'payload', keys: ['project_id'] },
  portfolio_project_attachments: { parentTable: 'portfolio_projects', from: 'payload', keys: ['project_id'] },
  portfolio_project_time_entries: { parentTable: 'portfolio_projects', from: 'payload', keys: ['project_id'] },
};
