/**
 * When each trial e-mail is due (`doc/trial-mails.md`). Pure: the facts come from the database,
 * the clock from the caller.
 *
 * - J0, the welcome: once the path and the mode are chosen, or an hour after the first sign-in
 *   seen without them.
 * - J+5: five days after the trial started.
 * - J+12: two days before the trial ends (follows a trial extended by the platform administrator).
 * - The end-of-trial notice: once the trial has ended without a subscription.
 * - The thank-you: once Stripe confirms the first subscription of a workspace seen in trial.
 *
 * A mail is sent only while it still makes sense: J0 before J+5 is due, J+5 before J+12, J+12
 * before the end, the notice until a week before the deletion. A workspace seen for the first
 * time late in its trial (a deploy, an outage) gets the current mail, never the ones it missed.
 * The trial sequence stops at the subscription and at the unsubscription; the thank-you is a
 * service e-mail and goes out either way.
 */

export const TRIAL_MAIL_MILESTONES = ['j0', 'j5', 'j12', 'ended', 'thanks'] as const;
export type TrialMailMilestone = typeof TRIAL_MAIL_MILESTONES[number];

/** The column of `trial_mails` that stamps each mail. Column names come only from here. */
export const TRIAL_MAIL_SENT_COLUMN: Record<TrialMailMilestone, string> = {
  j0: 'j0_sent_at',
  j5: 'j5_sent_at',
  j12: 'j12_sent_at',
  ended: 'ended_sent_at',
  thanks: 'thanks_sent_at',
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const TRIAL_MAIL_J0_FALLBACK_MS = HOUR_MS;
export const TRIAL_MAIL_J5_AFTER_MS = 5 * DAY_MS;
export const TRIAL_MAIL_J12_BEFORE_END_MS = 2 * DAY_MS;
/** The notice is not sent in the last week before the deletion. */
export const TRIAL_MAIL_ENDED_LAST_CALL_MS = 7 * DAY_MS;

export type TrialMailFacts = {
  /** `trialing`; `subscribed` is an active Stripe subscription; anything else sends nothing. */
  subscription: 'trialing' | 'subscribed' | 'other';
  trialStart: Date;
  trialEnd: Date | null;
  /**
   * When the workspace is deleted if it does not subscribe (`computeTrialDeletionAt`, E1); null
   * when no deletion is planned (billing not enforced, a plan set by hand): J+12 and the notice
   * announce the deletion, so they are not sent.
   */
  deletionAt: Date | null;
  /** The path (angle) and the mode are both chosen. */
  choiceMade: boolean;
  firstLoginAt: Date | null;
  sent: ReadonlySet<TrialMailMilestone>;
  unsubscribed: boolean;
};

export function dueTrialMail(facts: TrialMailFacts, now: Date): TrialMailMilestone | null {
  const at = now.getTime();
  if (facts.subscription === 'subscribed') return facts.sent.has('thanks') ? null : 'thanks';
  if (facts.subscription !== 'trialing' || !facts.trialEnd || facts.unsubscribed) return null;

  const end = facts.trialEnd.getTime();
  let due: TrialMailMilestone | null;
  if (at >= end - TRIAL_MAIL_J12_BEFORE_END_MS) {
    if (!facts.deletionAt) due = null;
    else if (at < end) due = 'j12';
    else due = at < facts.deletionAt.getTime() - TRIAL_MAIL_ENDED_LAST_CALL_MS ? 'ended' : null;
  } else if (at >= facts.trialStart.getTime() + TRIAL_MAIL_J5_AFTER_MS) {
    due = 'j5';
  } else {
    const signedInLongEnough = !!facts.firstLoginAt && at >= facts.firstLoginAt.getTime() + TRIAL_MAIL_J0_FALLBACK_MS;
    due = facts.choiceMade || signedInLongEnough ? 'j0' : null;
  }
  return due && !facts.sent.has(due) ? due : null;
}
