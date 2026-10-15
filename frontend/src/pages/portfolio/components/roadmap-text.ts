import type { TFunction } from 'i18next';
import { formatShortDate } from '../../../lib/dateFormat';
import { formatNumber } from '../../../i18n/formatters';

const P = 'portfolio:planning.roadmap.';

export type RoadmapConstraint =
  | { type: 'pin_start'; startWeek: string }
  | { type: 'pin_window'; startWeek: string; endWeek: string }
  | { type: 'not_before'; startWeek: string };

type ReasonEntry = {
  kind: string;
  label: string;
  projectId: string | null;
  fromWeek: string | null;
  toWeek: string | null;
};

export type RoadmapExplanationInput = {
  classification: 'scheduled' | 'reservation' | 'unschedulable';
  startReason: string;
  earliestEligibleWeek: string | null;
  actualStartWeek: string | null;
  activeConstraint: RoadmapConstraint | null;
  blockerReasons: ReasonEntry[];
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

/**
 * The sentence for a constraint the schedule could not honour. The server marks the conflict with a
 * `constraint_conflict` reason whose `fromWeek` is the constraint start moved to a Monday.
 */
export const formatConstraintConflict = (
  t: TFunction,
  locale: string,
  constraint: RoadmapConstraint,
  effectiveStartWeek: string | null,
  actualStartWeek: string | null,
  actualEndWeek: string | null,
): string => {
  const date = (value: string | null) => formatRoadmapDate(t, locale, value);
  const K = `${P}explainText.conflict.`;
  switch (constraint.type) {
    case 'pin_start':
      if (!actualStartWeek) return t(`${K}pinStartUnsatisfied`, { week: date(constraint.startWeek) });
      if (effectiveStartWeek && effectiveStartWeek !== constraint.startWeek) {
        return t(`${K}pinStartNormalized`, {
          week: date(constraint.startWeek),
          normalized: date(effectiveStartWeek),
          actual: date(actualStartWeek),
        });
      }
      return t(`${K}pinStartSlipped`, { week: date(constraint.startWeek), actual: date(actualStartWeek) });
    case 'pin_window':
      if (!actualStartWeek) {
        return t(`${K}pinWindowUnsatisfied`, { start: date(constraint.startWeek), end: date(constraint.endWeek) });
      }
      return t(`${K}pinWindowMissed`, {
        start: date(constraint.startWeek),
        end: date(constraint.endWeek),
        actualStart: date(actualStartWeek),
        actualEnd: date(actualEndWeek ?? actualStartWeek),
      });
    case 'not_before':
    default:
      return t(`${K}notBeforeViolated`, { week: date(constraint.startWeek), actual: date(actualStartWeek) });
  }
};

/** The conflict sentence of an explanation, or null when its constraint was honoured. */
export const explanationConflict = (
  t: TFunction,
  locale: string,
  explanation: RoadmapExplanationInput,
  actualEndWeek: string | null,
): string | null => {
  const entry = explanation.blockerReasons.find((reason) => reason.kind === 'constraint_conflict');
  if (!entry || !explanation.activeConstraint) return null;
  return formatConstraintConflict(
    t,
    locale,
    explanation.activeConstraint,
    entry.fromWeek,
    explanation.actualStartWeek,
    actualEndWeek,
  );
};

/** The text of a "why not earlier" entry; conflicts are rebuilt in the reader's language. */
export const formatReasonLabel = (
  t: TFunction,
  locale: string,
  explanation: RoadmapExplanationInput,
  reason: ReasonEntry,
  actualEndWeek: string | null,
): string => (reason.kind === 'constraint_conflict'
  ? (explanationConflict(t, locale, explanation, actualEndWeek) ?? reason.label)
  : reason.label);

/** The summary and the final reason of an explanation, built in the reader's language. */
export const buildExplanationTexts = (
  t: TFunction,
  locale: string,
  explanation: RoadmapExplanationInput,
  context: { projectName: string; actualEndWeek: string | null; unschedulableReason?: string | null },
): { summary: string; finalReason: string | null } => {
  const K = `${P}explainText.`;
  const project = context.projectName;
  const conflict = explanationConflict(t, locale, explanation, context.actualEndWeek);
  const { actualStartWeek, earliestEligibleWeek } = explanation;
  const week = actualStartWeek ? formatRoadmapDate(t, locale, actualStartWeek) : null;
  const eligible = earliestEligibleWeek ? formatRoadmapDate(t, locale, earliestEligibleWeek) : null;

  if (explanation.classification === 'unschedulable') {
    const reason = conflict ?? t(`${P}reasons.${context.unschedulableReason ?? 'insufficient_capacity'}`, {
      defaultValue: t(`${P}reasons.insufficient_capacity`),
    });
    return { summary: t(`${K}summaryUnschedulable`, { project, reason }), finalReason: reason };
  }

  const delayedByCapacity = explanation.startReason === 'capacity_available'
    && !!earliestEligibleWeek && !!actualStartWeek && earliestEligibleWeek < actualStartWeek;
  const releasedByBlockers = !!actualStartWeek && explanation.blockerReasons
    .some((reason) => reason.kind !== 'constraint_conflict' && !!reason.projectId);

  let finalReason: string | null = null;
  if (conflict) finalReason = conflict;
  else if (delayedByCapacity) finalReason = t(`${K}finalCapacity`, { eligible, week });
  else if (releasedByBlockers) finalReason = t(`${K}finalBlockers`, { week });
  else if (week) finalReason = t(`${K}finalStarted`, { week });

  let summary: string;
  if (!week) summary = t(`${K}summaryNoStart`, { project });
  else if (explanation.startReason === 'historical_start') summary = t(`${K}summaryHistorical`, { project, week });
  else if (explanation.activeConstraint) {
    const constraint = formatRoadmapConstraint(t, locale, explanation.activeConstraint);
    summary = conflict
      ? t(`${K}summaryConstraintConflict`, { project, week, constraint, conflict })
      : t(`${K}summaryConstraint`, { project, week, constraint });
  } else if (delayedByCapacity) summary = t(`${K}summaryCapacity`, { project, eligible, week });
  else if (releasedByBlockers) summary = t(`${K}summaryBlockers`, { project, week });
  else summary = t(`${K}summarySchedulable`, { project, week });

  return { summary, finalReason };
};
