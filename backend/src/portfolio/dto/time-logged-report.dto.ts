/** Horizons the time-logged report offers, in months, and the one it falls back to. */
export const TIME_LOGGED_MONTHS = [6, 12] as const;
export const TIME_LOGGED_DEFAULT_MONTHS = 6;

/** Logged days of one month: project time and the rest. */
export type TimeLoggedCell = {
  /** `YYYY-MM`, a calendar month in the viewer's zone. */
  month: string;
  projectDays: number;
  otherDays: number;
  /** The two above added, one decimal: what the screen and the export show as the month's days. */
  totalDays: number;
};

/** One person of a team, with a cell for every month of the window (zeros when nothing was logged). */
export type TimeLoggedMember = {
  /** Null for the entries logged without a person ("Unknown user"). */
  userId: string | null;
  name: string;
  /** `CTR-12` when the person has a contributor profile, null otherwise. */
  contributorRef: string | null;
  cells: TimeLoggedCell[];
};

/** One team, or the last group of the people without a team (`teamId` null). */
export type TimeLoggedTeam = {
  teamId: string | null;
  teamName: string | null;
  members: TimeLoggedMember[];
  cells: TimeLoggedCell[];
};

export type TimeLoggedTotals = {
  projectDays: number;
  otherDays: number;
  totalDays: number;
  /** Contributor profiles in scope with no entry at all over the window. */
  contributorsWithoutEntries: number;
  contributorsTotal: number;
};

export type TimeLoggedReportResponse = {
  months: string[];
  totals: TimeLoggedTotals;
  series: TimeLoggedCell[];
  teams: TimeLoggedTeam[];
};
