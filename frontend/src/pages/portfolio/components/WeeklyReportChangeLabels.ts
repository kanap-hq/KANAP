import type { TFunction } from 'i18next';
import { formatShortDate } from '../../../lib/dateFormat';

/**
 * Human labels for the columns the weekly report reports as changed.
 *
 * The wording is the one the item history already uses, so a change reads the same
 * in the report and in the item's own history feed: request and project columns come
 * from `activity.history.fields.*` (the map in PortfolioHistory), task columns from
 * `workspace.task.history.fields.*` (the map in TaskHistory).
 */
const PORTFOLIO_FIELD_KEYS: Record<string, string> = {
  name: 'name',
  purpose: 'purpose',
  current_situation: 'currentSituation',
  expected_benefits: 'expectedBenefits',
  risks: 'risks',
  feasibility_review: 'feasibilityReview',
  source_id: 'source',
  category_id: 'category',
  stream_id: 'stream',
  requestor_id: 'requestor',
  target_delivery_date: 'targetDeliveryDate',
  origin_task_id: 'originTask',
  // The task a request came from, by its label once the task is deleted with its budget line.
  origin_task: 'originTask',
  company_id: 'company',
  department_id: 'department',
  business_sponsor_id: 'businessSponsor',
  business_lead_id: 'businessLead',
  it_sponsor_id: 'itSponsor',
  it_lead_id: 'itLead',
  planned_start: 'plannedStart',
  planned_end: 'plannedEnd',
  actual_start: 'actualStart',
  actual_end: 'actualEnd',
  converted_date: 'convertedDate',
  estimated_effort_it: 'estimatedEffortIt',
  estimated_effort_business: 'estimatedEffortBusiness',
  actual_effort_it: 'actualEffortIt',
  actual_effort_business: 'actualEffortBusiness',
  execution_progress: 'progress',
  priority_score: 'priorityScore',
  priority_override: 'priorityOverride',
  override_value: 'overrideValue',
  override_justification: 'overrideJustification',
  criteria_values: 'criteriaValues',
  scheduling_mode: 'schedulingMode',
  it_effort_allocation_mode: 'itEffortAllocationMode',
  business_effort_allocation_mode: 'businessEffortAllocationMode',
};

const TASK_FIELD_KEYS: Record<string, string> = {
  title: 'title',
  description: 'description',
  task_type_id: 'taskType',
  priority_level: 'priority',
  creator_id: 'requestor',
  assignee_user_id: 'assignee',
  due_date: 'dueDate',
  start_date: 'startDate',
  labels: 'labels',
  phase_id: 'phase',
  source_id: 'source',
  category_id: 'category',
  stream_id: 'stream',
  company_id: 'company',
  owner_ids: 'owners',
  viewer_ids: 'viewers',
  related_object_id: 'relatedTo',
  related_object_type: 'relatedTo',
};

const humanize = (field: string): string =>
  field
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

export type WeeklyReportEntity = 'request' | 'project' | 'task';

/** Translated label for one changed column, humanised as a last resort. */
export function getWeeklyFieldLabel(
  t: TFunction,
  entity: WeeklyReportEntity,
  field: string,
): string {
  if (entity === 'task') {
    const key = TASK_FIELD_KEYS[field];
    if (key) return t(`workspace.task.history.fields.${key}`);
    return humanize(field);
  }
  const key = PORTFOLIO_FIELD_KEYS[field];
  if (key) return t(`activity.history.fields.${key}`);
  return humanize(field);
}

/** How the server shaped a changed value (`WeeklyChangeKind` in the weekly report service). */
export type WeeklyChangeKind = 'text' | 'date' | 'number' | 'boolean' | 'list' | 'ref';

/**
 * One changed value as the report cell writes it. The server sends the values ready to format:
 * a day as `YYYY-MM-DD`, a boolean as `true` / `false`, a list as its item count, a reference
 * as a name (`''` when the record is gone) and `null` for an empty value. The export writes the
 * same rules in English on the server (`formatExportChangeValue`).
 */
export function formatChangeValue(
  kind: WeeklyChangeKind,
  value: string | null,
  t: TFunction,
  locale: string,
): string {
  if (value === null) return t('reports.weekly.changeValues.empty');
  if (kind === 'ref' && value === '') return t('reports.weekly.changeValues.unknown');
  if (kind === 'boolean') return value === 'true' ? t('activity.history.values.yes') : t('activity.history.values.no');
  if (kind === 'list') return t('reports.weekly.changeValues.items', { count: Number(value) || 0 });
  if (kind === 'date') return formatShortDate(value, locale) || value;
  return value;
}
