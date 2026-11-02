import { INTERNAL_PLAN_NAME } from '../../billing/plans.config';

/**
 * The trial funnel of platform administration (`doc/trial-funnel.md`): where each trial sign-up
 * stands, from the sign-up to the conversion. Pure rules here; the service reads the milestones.
 */

/** Hours after its activation a trial workspace may stay without a first sign-in before it is flagged. */
export const NO_SIGN_IN_ALERT_HOURS = 24;

/** Weeks the funnel counts, the current one included. */
export const FUNNEL_WEEKS = 8;

export const TRIAL_STATES = ['awaiting_activation', 'trialing', 'ended', 'converted', 'internal'] as const;
export type TrialState = (typeof TRIAL_STATES)[number];

export function isTrialState(value: unknown): value is TrialState {
  return typeof value === 'string' && (TRIAL_STATES as readonly string[]).includes(value);
}

export type TrialSubscription = {
  status: string | null;
  plan_name: string | null;
  trial_end: Date | string | null;
  stripe_subscription_id: string | null;
};

const time = (value: Date | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * - `awaiting_activation`: signed up, the e-mail link never opened (no workspace yet);
 * - `converted`: the subscription is linked to Stripe, whatever happened to it since;
 * - `internal`: turned into an internal workspace by platform administration;
 * - `trialing`: the trial runs; `ended`: it is over without a subscription.
 */
export function trialState(input: {
  activated_at: Date | string | null;
  has_tenant: boolean;
  subscription: TrialSubscription | null;
  now?: Date;
}): TrialState {
  if (!input.activated_at || !input.has_tenant) return 'awaiting_activation';
  const sub = input.subscription;
  if (sub?.stripe_subscription_id) return 'converted';
  if (sub?.plan_name === INTERNAL_PLAN_NAME) return 'internal';
  const end = time(sub?.trial_end);
  const now = (input.now ?? new Date()).getTime();
  return end !== null && end > now ? 'trialing' : 'ended';
}

/** A running trial whose workspace has had no sign-in for NO_SIGN_IN_ALERT_HOURS since its activation. */
export function needsAttention(input: {
  state: TrialState;
  activated_at: Date | string | null;
  first_sign_in_at: Date | string | null;
  now?: Date;
}): boolean {
  if (input.state !== 'trialing' || input.first_sign_in_at) return false;
  const activated = time(input.activated_at);
  if (activated === null) return false;
  return (input.now ?? new Date()).getTime() - activated >= NO_SIGN_IN_ALERT_HOURS * 3600_000;
}

/**
 * The instant after which a creation counts as the person's own: the latest of the activation,
 * the last complete load of the sample data and the last workspace reset. The sample data and a
 * reset write their rows in the person's name. While a load or a reset runs, nothing counts yet.
 */
export function ownActivityCutoff(input: {
  activated_at: Date | string | null;
  sample_data: { status?: unknown; ever_loaded_at?: unknown; loaded_at?: unknown } | null;
  last_reset_at: Date | string | null;
  now?: Date;
}): Date | null {
  const demo = input.sample_data ?? {};
  if (demo.status === 'loading' || demo.status === 'resetting') return input.now ?? new Date();
  const candidates = [
    input.activated_at,
    typeof demo.ever_loaded_at === 'string' ? demo.ever_loaded_at : null,
    typeof demo.loaded_at === 'string' ? demo.loaded_at : null,
    input.last_reset_at,
  ].map(time).filter((value): value is number => value !== null);
  return candidates.length ? new Date(Math.max(...candidates)) : null;
}

/** The steps a person has done on the workspace's path: the best of its people, out of five. */
export function stepsDone(pathKeys: readonly string[], doneByUser: ReadonlyArray<readonly string[]>): number {
  const path = new Set(pathKeys);
  return doneByUser.reduce((best, keys) => Math.max(best, new Set(keys.filter((key) => path.has(key))).size), 0);
}

/** Monday 00:00 UTC of the week of `value`, as YYYY-MM-DD. */
export function weekStart(value: Date): string {
  const day = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export type FunnelWeek = { week: string; created: number; activated: number; signed_in: number; converted: number };

/**
 * The sign-ups of each week (Monday, UTC), most recent first, FUNNEL_WEEKS of them, and how many
 * of them reached each step since: activated, signed in, converted.
 */
export function weeklyFunnel(
  rows: ReadonlyArray<{ created_at: Date | string; activated_at: Date | string | null; first_sign_in_at: Date | string | null; state: TrialState }>,
  now: Date = new Date(),
): FunnelWeek[] {
  const weeks: FunnelWeek[] = [];
  const current = new Date(`${weekStart(now)}T00:00:00Z`);
  for (let i = 0; i < FUNNEL_WEEKS; i += 1) {
    const start = new Date(current);
    start.setUTCDate(start.getUTCDate() - 7 * i);
    weeks.push({ week: start.toISOString().slice(0, 10), created: 0, activated: 0, signed_in: 0, converted: 0 });
  }
  const byWeek = new Map(weeks.map((week) => [week.week, week]));
  for (const row of rows) {
    const created = time(row.created_at);
    if (created === null) continue;
    const week = byWeek.get(weekStart(new Date(created)));
    if (!week) continue;
    week.created += 1;
    if (row.activated_at) week.activated += 1;
    if (row.first_sign_in_at) week.signed_in += 1;
    if (row.state === 'converted') week.converted += 1;
  }
  return weeks;
}
