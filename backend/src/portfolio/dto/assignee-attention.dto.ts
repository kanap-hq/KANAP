/** Windows the block offers for "no movement", and the one it falls back to. */
export const ASSIGNEE_STALE_DAYS = [7, 14, 30] as const;
export const ASSIGNEE_STALE_DEFAULT_DAYS = 14;

/** The three figures every line carries: what is open, late, and sitting still. */
export type AttentionCounts = {
  /** Open tasks of the portfolio scope. */
  open: number;
  /** Among them, the ones whose due day is already past. */
  overdue: number;
  /** Among them, the ones nobody has touched for the chosen window. */
  stale: number;
};

/** One person with at least one open task. */
export type AssigneeRow = AttentionCounts & {
  userId: string;
  /** First and last name, or the local part of the address when no name is recorded. */
  name: string;
  /** `MEM-12` when the person has a contributor profile, null otherwise. */
  contributorRef: string | null;
};

/** One team, or the catch-all group of the people without a team (`teamId` null). */
export type TeamGroup = AttentionCounts & {
  teamId: string | null;
  teamName: string | null;
  members: AssigneeRow[];
};

export type AssigneeAttentionResponse = {
  staleDays: number;
  /** Today in the viewer's zone, `YYYY-MM-DD`. */
  asOf: string;
  /** `asOf` minus the window, the day a task has to predate to count as still. */
  staleBefore: string;
  teams: TeamGroup[];
  unassigned: AttentionCounts;
  /** The whole scope: every group plus the unassigned tasks. */
  totals: AttentionCounts;
};
