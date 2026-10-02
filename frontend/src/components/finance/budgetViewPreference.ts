/**
 * The budget tab's view (yearly or monthly) is a choice of each user (plan
 * planning/perf-scale, lot 3D, scenario 22): it used to be stored on the
 * version (`input_grain`), shared by everyone, so one person switching to the
 * monthly view switched it for the others. It is now kept in the browser, per
 * user, like the grids' columns (`ServerDataGrid`, `grid-columns:…`): a user
 * id belongs to one tenant, so the key needs nothing else. A user who never
 * chose sees the version's `input_grain`, which keeps the way the line's
 * budget was entered; the tab no longer writes it.
 */

export type BudgetView = 'flat' | 'monthly';

const storageKey = (userId: string) => `budget-view:${userId}`;

/** The view the user last chose, or null (never chose, no user, or no storage). */
export function readBudgetView(userId: string | null | undefined): BudgetView | null {
  if (!userId) return null;
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    return value === 'flat' || value === 'monthly' ? value : null;
  } catch {
    return null;
  }
}

export function writeBudgetView(userId: string | null | undefined, view: BudgetView): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(storageKey(userId), view);
  } catch {
    /* storage unavailable: the choice lasts for the page only */
  }
}

/** The view a year opens in: the user's choice, else the version's grain (the yearly view without a version). */
export function initialBudgetView(userId: string | null | undefined, inputGrain: string | null | undefined): BudgetView {
  return readBudgetView(userId) ?? (inputGrain && inputGrain !== 'annual' ? 'monthly' : 'flat');
}
