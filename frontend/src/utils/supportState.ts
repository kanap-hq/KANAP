import type { Theme } from '@mui/material/styles';

/**
 * Support states of a version, an OS or any dated support period, shared by every screen that
 * shows one (technology record, technologies list, end of support report).
 *
 * - `supportStateOf(standardEnd, extendedEnd, today, horizonMonths)` tells where a period stands.
 *   Dates are `YYYY-MM-DD` (a longer ISO text is cut to its day), inclusive: support still runs
 *   on its end date. With one date only, that date is the end.
 *     - `ended`: every end date is past;
 *     - `extended`: the standard end is past, the extended end is still to come;
 *     - `ending_soon`: the first end is within `horizonMonths` from today (today included);
 *     - `supported`: the first end is beyond the horizon;
 *     - `unknown`: no end date.
 *   Same rule as the end of support report (`supportState` in
 *   `backend/src/technologies/reports/end-of-support.service.ts`): `out_of_support` is `ended`,
 *   `extended_support` is `extended`, `upcoming` is `ending_soon`.
 * - `SUPPORT_STATE_TOKENS` names the theme token of each state, `supportStateColor(state, theme)`
 *   resolves it. Colour marks attention only (charter): `ended` red, `extended` and `ending_soon`
 *   orange, `supported` and `unknown` neutral.
 */

export const SUPPORT_STATES = ['supported', 'ending_soon', 'extended', 'ended', 'unknown'] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

/** Default horizon of "ending soon", in months. */
export const SUPPORT_HORIZON_MONTHS = 12;

type DateInput = string | null | undefined;

/** The local day of a date as `YYYY-MM-DD`. */
export function toYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` plus whole months, the day clamped to the end of the month (Jan 31 + 1 = Feb 28). */
export function addMonthsYmd(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date, lastDay));
  return toYmd(target);
}

function day(value: DateInput): string | null {
  const text = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** Where a support period stands on `today` (see the head of this file). */
export function supportStateOf(
  standardEnd: DateInput,
  extendedEnd: DateInput,
  today: Date | string = new Date(),
  horizonMonths: number = SUPPORT_HORIZON_MONTHS,
): SupportState {
  const standard = day(standardEnd);
  const extended = day(extendedEnd);
  const first = standard ?? extended;
  if (!first) return 'unknown';
  const last = extended && extended > first ? extended : first;
  const now = typeof today === 'string' ? day(today) ?? toYmd(new Date()) : toYmd(today);
  if (last < now) return 'ended';
  if (first < now) return 'extended';
  if (first <= addMonthsYmd(now, horizonMonths)) return 'ending_soon';
  return 'supported';
}

/** Theme token of each state (`theme.palette.kanap.<token>`). */
export const SUPPORT_STATE_TOKENS: Record<SupportState, 'danger' | 'orange' | 'text.secondary'> = {
  ended: 'danger',
  extended: 'orange',
  ending_soon: 'orange',
  supported: 'text.secondary',
  unknown: 'text.secondary',
};

/** The colour of a state in the current theme (light or dark), for a status dot or a date. */
export function supportStateColor(state: SupportState, theme: Theme): string {
  const kanap = theme.palette.kanap;
  switch (SUPPORT_STATE_TOKENS[state]) {
    case 'danger': return kanap.danger;
    case 'orange': return kanap.orange;
    default: return kanap.text.secondary;
  }
}

/** True for the states that call for attention (coloured). */
export function supportStateNeedsAttention(state: SupportState): boolean {
  return SUPPORT_STATE_TOKENS[state] !== 'text.secondary';
}
