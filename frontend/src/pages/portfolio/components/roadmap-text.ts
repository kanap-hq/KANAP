import type { TFunction } from 'i18next';
import { formatShortDate } from '../../../lib/dateFormat';
import { formatNumber } from '../../../i18n/formatters';

const P = 'portfolio:planning.roadmap.';

export type RoadmapConstraint =
  | { type: 'pin_start'; startWeek: string }
  | { type: 'pin_window'; startWeek: string; endWeek: string }
  | { type: 'not_before'; startWeek: string };

/** Every sentence code the server sends (backend `RoadmapTextCode`). */
export const ROADMAP_TEXT_CODES = [
  'missing_contributor_capacity_for',
  'blocker_on_hold',
  'blocker_fixed_plan_expired',
  'blocker_cannot_be_scheduled',
  'missing_blocker_date_for',
  'no_free_slot_for',
  'no_allocable_capacity_for',
  'collaborative_burn_below_threshold',
  'collaborative_burn_stalled_for',
  'independent_burn_below_threshold',
  'no_capacity_remained_for',
  'capacity_prevented_scheduling',
  'waiting_on_blockers',
  'earliest_start_beyond_horizon',
  'never_ready_within_horizon',
  'remaining_after_horizon',
  'no_allocable_week',
  'reason',
  'contributor_capacity',
  'contributor_remaining_load',
  'waiting_for',
  'waiting_for_until',
  'blocker_is_on_hold',
  'blocker_has_expired_fixed_plan',
  'blocker_is_unschedulable',
  'conflict_pin_start_unsatisfied',
  'conflict_pin_start_normalized',
  'conflict_pin_start_slipped',
  'conflict_pin_window_unsatisfied',
  'conflict_pin_window_missed',
  'conflict_not_before_violated',
  'final_capacity',
  'final_blockers',
  'final_started',
  'summary_unschedulable',
  'summary_historical',
  'summary_constraint',
  'summary_constraint_conflict',
  'summary_capacity',
  'summary_blockers',
  'summary_schedulable',
  'warning_constraint_conflict',
] as const;

export type RoadmapTextCode = (typeof ROADMAP_TEXT_CODES)[number];

export type RoadmapTextParam =
  | string
  | number
  | null
  | string[]
  | RoadmapConstraint
  | RoadmapText
  | RoadmapText[];

/** A sentence of the roadmap as the server sends it: a code and its parameters. */
export type RoadmapText = {
  code: RoadmapTextCode;
  params: { [name: string]: RoadmapTextParam };
};

type ReasonEntry = {
  label: string;
  labelText: RoadmapText;
};

export type RoadmapExplanationInput = {
  summaryText: RoadmapText;
  finalReasonText: RoadmapText | null;
};

/** A roadmap date ("YYYY-MM-DD") in the reader's format, or N/A. */
export const formatRoadmapDate = (t: TFunction, locale: string, value: string | null | undefined): string =>
  formatShortDate(value, locale, { empty: t(`${P}values.na`) });

/** Days with a fixed number of decimals and the reader's decimal separator. */
export const formatRoadmapDays = (locale: string, value: number, digits = 2): string =>
  formatNumber(value, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatRoadmapConstraint = (
  t: TFunction,
  locale: string,
  constraint: RoadmapConstraint | null | undefined,
): string => {
  const date = (value: string) => formatRoadmapDate(t, locale, value);
  switch (constraint?.type) {
    case 'pin_start':
      return t(`${P}values.pinStart`, { week: date(constraint.startWeek) });
    case 'pin_window':
      return t(`${P}constraints.pinWindow`, { start: date(constraint.startWeek), end: date(constraint.endWeek) });
    case 'not_before':
      return t(`${P}constraints.notBefore`, { week: date(constraint.startWeek) });
    default:
      return t(`${P}constraints.none`);
  }
};

const DATE_PARAMS = new Set(['week', 'normalized', 'actual', 'start', 'end', 'actualStart', 'actualEnd', 'eligible']);
const NUMBER_PARAMS = new Set(['weeklyCapacity', 'remainingDays', 'burn', 'threshold']);

const isText = (value: unknown): value is RoadmapText =>
  !!value && typeof value === 'object' && !Array.isArray(value) && 'code' in value;

/** The translation key of a code: summaries, final reasons and conflicts reuse the explanation texts. */
const keyFor = (code: RoadmapTextCode): string => {
  const camel = (value: string) => value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  if (code === 'warning_constraint_conflict') return `${P}explainText.warningConflict`;
  if (code.startsWith('conflict_')) return `${P}explainText.conflict.${camel(code.slice('conflict_'.length))}`;
  if (code.startsWith('summary_') || code.startsWith('final_')) return `${P}explainText.${camel(code)}`;
  return `${P}text.${camel(code)}`;
};

/** A roadmap sentence in the reader's language, with dates, days and lists in their format. */
export const formatRoadmapText = (t: TFunction, locale: string, text: RoadmapText): string => {
  const { code, params } = text;
  if (code === 'reason') {
    const reason = String(params.reason ?? 'insufficient_capacity');
    return t(`${P}reasons.${reason}`, { defaultValue: t(`${P}reasons.insufficient_capacity`) });
  }
  if ((code === 'summary_historical' || code === 'summary_schedulable') && !params.week) {
    return t(`${P}explainText.summaryNoStart`, { project: params.project });
  }
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (name === 'constraint') {
      values[name] = formatRoadmapConstraint(t, locale, value as RoadmapConstraint);
    } else if (name === 'reason' && typeof value === 'string') {
      values[name] = t(`${P}reasons.${value}`, { defaultValue: t(`${P}reasons.insufficient_capacity`) });
    } else if (isText(value)) {
      values[name] = formatRoadmapText(t, locale, value);
    } else if (Array.isArray(value)) {
      values[name] = value.length > 0
        ? value.map((item) => (isText(item) ? formatRoadmapText(t, locale, item) : String(item))).join(', ')
        : t(`${P}values.na`);
    } else if (DATE_PARAMS.has(name)) {
      values[name] = formatRoadmapDate(t, locale, value as string | null);
    } else if (NUMBER_PARAMS.has(name) && typeof value === 'number') {
      values[name] = formatNumber(value, locale, { maximumFractionDigits: 2 });
    } else if (name === 'horizonWeeks' && typeof value === 'number') {
      values.count = value;
    } else {
      values[name] = value == null ? t(`${P}values.na`) : String(value);
    }
  }
  return t(keyFor(code), values);
};

/** The text of a "why not earlier" entry, in the reader's language. */
export const formatReasonLabel = (t: TFunction, locale: string, reason: ReasonEntry): string =>
  formatRoadmapText(t, locale, reason.labelText);

/** The summary and the final reason of an explanation, in the reader's language. */
export const buildExplanationTexts = (
  t: TFunction,
  locale: string,
  explanation: RoadmapExplanationInput,
): { summary: string; finalReason: string | null } => ({
  summary: formatRoadmapText(t, locale, explanation.summaryText),
  finalReason: explanation.finalReasonText ? formatRoadmapText(t, locale, explanation.finalReasonText) : null,
});
