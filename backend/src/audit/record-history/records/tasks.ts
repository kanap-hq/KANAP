import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { FamilyKey } from '../families';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The task (lot 2, linked records): its page (a History button in its header, it has no tab row),
 * the audit labels of its own row and of its children, their allow-lists and their parent rules.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. The family `task` applies the task screen's rule: the
 * Business Contributor participation and the confidential incident a task may belong to; data
 * access (a task of a line or a contract) goes through RLS. The task's own rows are written with the
 * task in `record_id`; the task names the record it belongs to (`related_object_type`,
 * `related_object_id`), and that record's history reads the same rows through the shared rule of
 * `audit-parent-rules.ts`.
 *
 * The attachments and time entries name the task in their payload (`task_id`); the migration
 * `1855920000000-audit-log-parent-tasks.ts` backfills their parent. The application and asset links
 * are written from the task with the task in `record_id` and a `{ ids }` set before and after
 * (`tasks-unified.service.ts`, `syncTaskLinks`), and read by it.
 */
export const tasksRecord = {
  table: 'tasks',
  module: 'tasks',
  level: 'reader',
  auditLabels: ['tasks'],
  family: 'task',
  children: {
    // The payload names the task (`task_id`).
    task_attachments: 'attachment',
    task_time_entries: 'time_entry',
    // `record_id` is the task: the link sets of its applications and assets.
    task_applications: 'application',
    task_assets: 'asset',
  },
  childReads: {
    task_applications: 'record',
    task_assets: 'record',
  },
  explicitParentLabels: [],
  exclusions: [
    {
      table: 'portfolio_activities',
      reason: 'the feed (comments and decisions), which is not audit',
    },
  ],
} as const satisfies RecordHistoryRecord;

/**
 * The family of the record a task belongs to, by its `related_object_type`: the history names it
 * ("Belongs to: PRJ-3") with the reader's rights, or says "a project" when they may not read it.
 * Both natures of a budget line are in `spend_items`.
 */
export const TASK_RELATED_FAMILIES: Readonly<Record<string, FamilyKey>> = {
  capex_item: 'budget_line',
  contract: 'contract',
  incident: 'incident',
  project: 'project',
  spend_item: 'budget_line',
};

/** The family of a task's record type, or null for a standalone task or an unknown type. */
export function taskRelatedFamily(type: unknown): FamilyKey | null {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(TASK_RELATED_FAMILIES, type)
    ? TASK_RELATED_FAMILIES[type]
    : null;
}

/** A task, as its own audit rows record it (the saved row, every column). */
const TASK_FIELDS: HistoryFields = {
  title: shown(),
  status: shown(),
  priority_level: shown(),
  due_date: shown(),
  start_date: shown(),
  labels: shown(),
  assignee_user_id: shown('user'),
  creator_id: shown('user'),
  company_id: shown('company'),
  // Rich text: the entry says that the description changed, never its content.
  description: hiddenChanged('task description: rich text, long content', 'descriptionChanged'),
  // The record the task belongs to: the presenter reads the type and the id together, as one line.
  related_object_type: hidden('presented with related_object_id as the record the task belongs to'),
  related_object_id: hidden('presented with related_object_type as the record the task belongs to'),
  // People lists: the presenter reads each person added or removed.
  owner_ids: hidden('presented as the owners added or removed'),
  viewer_ids: hidden('presented as the viewers added or removed'),
  // Settings of the task screen with no reference family: the entry says that they changed.
  task_type_id: hiddenChanged('task type setting: no reference family', 'taskTypeChanged'),
  phase_id: hiddenChanged('project phase: no reference family', 'phaseChanged'),
  source_id: hiddenChanged('portfolio source setting: no reference family', 'sourceChanged'),
  category_id: hiddenChanged('portfolio category setting: no reference family', 'categoryChanged'),
  stream_id: hiddenChanged('portfolio stream setting: no reference family', 'streamChanged'),
  // Written beside the saved row by the conversion into a request: the presenter names the request.
  converted_to_request_id: hidden('conversion marker, presented as its own sentence'),
  item_number: hidden('business reference, never a change'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An attachment of a task: what it is, never where it is stored. */
const TASK_ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  task_id: hidden('the task, the record itself'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  source_field: hidden('technical source of the upload'),
  uploaded_by_id: hidden('upload author, already the entry actor'),
  uploaded_at: hidden('timestamp, already the entry date'),
};

/** A time entry of a task: who, how long, which kind of time, when, and its note. */
const TASK_TIME_ENTRY_FIELDS: HistoryFields = {
  user_id: shown('user'),
  hours: shown(),
  category: shown(),
  logged_at: shown(),
  notes: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  task_id: hidden('the task, the record itself'),
  logged_by_id: hidden('write author, already the entry actor'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/**
 * The allow-lists of the task's audit labels: the task, its attachments and its time entries. The
 * link sets (`task_applications`, `task_assets`) are presented as references by their kind, from
 * no field list.
 */
export const tasksFields: Readonly<Record<string, HistoryFields>> = {
  tasks: TASK_FIELDS,
  task_attachments: TASK_ATTACHMENT_FIELDS,
  task_time_entries: TASK_TIME_ENTRY_FIELDS,
};

/**
 * The task children an audit rule finds: their payload names the task (`task_id`), a deleted
 * attachment's row included (its `record_id` may be NULL).
 *
 * `1855920000000-audit-log-parent-tasks.ts` copies these rules in SQL on purpose.
 */
export const tasksParentRules: Readonly<Record<string, AuditParentRule>> = {
  task_attachments: { parentTable: 'tasks', from: 'payload', keys: ['task_id'] },
  task_time_entries: { parentTable: 'tasks', from: 'payload', keys: ['task_id'] },
};
