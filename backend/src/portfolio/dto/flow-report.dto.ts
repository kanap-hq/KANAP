/**
 * One local period of the flow window: a Monday-to-Sunday week for tasks, a calendar month
 * for requests and projects. Both are read in the viewer's zone.
 */
export type FlowPeriod = {
  /** First day of the period, `YYYY-MM-DD`. */
  periodStart: string;
  /** Last day of the period, `YYYY-MM-DD`. The period in progress ends on today all the same. */
  periodEnd: string;
  /** Items created during the period and still present. */
  created: number;
  /** Items whose last status event of the period left them closed. */
  closed: number;
  /** Items in flight at the end of the period: created by then, not closed then. */
  openAtEnd: number;
};

/** The movement of one entity over its own grain, plus how many of it are open right now. */
export type FlowSeries = {
  /** `week` for tasks, `month` for requests and projects. */
  granularity: 'week' | 'month';
  periods: FlowPeriod[];
  openNow: number;
};

/** Age brackets of an open task, in whole days since it was created. */
export type AgeBucket = 'upTo7' | 'from8To30' | 'from31To90' | 'over90';

/** Open tasks of one task type, spread over the age brackets. */
export type AgeRow = {
  taskTypeId: string | null;
  /** Null on the row that gathers the tasks with no type. */
  taskTypeName: string | null;
  /** The shipped type it started as, for display in the reader's language; null for a tenant's own type. */
  taskTypeCode: string | null;
  buckets: Record<AgeBucket, number>;
  total: number;
};

/**
 * How long ago an open request or project was created, in whole local days between its
 * creation day and today. The bounds are fixed:
 *
 * - `underOneMonth`: 0 to 29 days
 * - `oneToThreeMonths`: 30 to 91 days
 * - `threeToSixMonths`: 92 to 182 days
 * - `overSixMonths`: 183 days and over
 */
export type MonthBucket = 'underOneMonth' | 'oneToThreeMonths' | 'threeToSixMonths' | 'overSixMonths';

/** Bracket bounds in whole days, oldest bracket last. The last one has no upper bound. */
export const MONTH_BUCKETS: Array<{ key: MonthBucket; from: number; to: number | null }> = [
  { key: 'underOneMonth', from: 0, to: 29 },
  { key: 'oneToThreeMonths', from: 30, to: 91 },
  { key: 'threeToSixMonths', from: 92, to: 182 },
  { key: 'overSixMonths', from: 183, to: null },
];

/** The open items of one status, spread over the creation-age brackets. */
export type CreatedAgeRow = {
  /** Live status, e.g. `waiting_list`. The UI holds the label. */
  status: string;
  buckets: Record<MonthBucket, number>;
  total: number;
};

/** Status by status, how long ago the open items were created. */
export type CreatedAgeTable = {
  /** One row per status of the journey, in order, even when the status is empty. */
  rows: CreatedAgeRow[];
  total: CreatedAgeRow;
};

/**
 * Days an item has to sit in the same status before it counts as stuck. A task is read on a
 * month, a request or a project on a quarter: they do not move at the same speed.
 */
export const STUCK_THRESHOLD_DAYS = { tasks: 30, requests: 91, projects: 91 } as const;

/** One open item that has been sitting in the same status for longer than the threshold. */
export type StuckItem = {
  id: string;
  /** Business reference, `T-8`, `REQ-12` or `PRJ-3`. */
  ref: string;
  itemPath: string;
  name: string;
  status: string;
  /** Local day the item entered its current status, `YYYY-MM-DD`. */
  statusSince: string;
  /** Projects only. */
  plannedEnd?: string | null;
  plannedEndPassed?: boolean;
};

/** How many open items one status holds, and how many of them have stopped moving. */
export type ByStatusRow = {
  status: string;
  open: number;
  /** Open items whose time in this status is strictly over `thresholdDays`. */
  stuck: number;
  /** Projects only: how many of the row's open items are past their planned end. */
  plannedEndPassed?: number;
};

/** The stagnation table of one entity: where the open work sits and what is not moving. */
export type ByStatusTable = {
  thresholdDays: number;
  rows: ByStatusRow[];
  total: ByStatusRow;
  /** The stuck items only — no list filters on time in status, so the report holds them. */
  items: StuckItem[];
};

/** How long it took to close, over the window of the entity's own grain. */
export type LeadTime = {
  /** Closings of the window, the weekly report's rule. */
  closedCount: number;
  /**
   * The closings the median is read on: the ones whose closing event is a real transition.
   * An item imported already closed carries a closing event of its own creation, a zero-day
   * lead time by construction, and would pull every median to the floor.
   */
  measuredCount: number;
  /** Median days between creation and closing, one decimal. Null when nothing was measured. */
  medianDays: number | null;
};

export type LeadTimeByType = { taskTypeId: string | null; taskTypeName: string | null; taskTypeCode: string | null } & LeadTime;

/** Closings of finished projects, with how far off the planned end they landed. */
export type ProjectDoneLeadTime = LeadTime & {
  /** Measured finished projects of the window that carried a planned end. */
  withPlannedEnd: number;
  /** Median of (closing day − planned end) in days, positive when late. Null when none. */
  medianOverrunDays: number | null;
};

export type FlowReportResponse = {
  weeks: number;
  months: number;
  /** Monday of the first week, first day of the first month, and today, in the viewer's zone. */
  startDate: string;
  monthsStartDate: string;
  endDate: string;
  timeZone: string;
  /** The classification the whole report was narrowed to. Empty lists mean "every value". */
  sourceIds: string[];
  categoryIds: string[];
  /** The projects and teams the whole report was narrowed to. Empty lists mean "every value". */
  projectIds: string[];
  teamIds: string[];
  /** Instant the figures were read, ISO 8601. */
  asOf: string;
  flow: { tasks: FlowSeries; requests: FlowSeries; projects: FlowSeries };
  /** How long ago the open work was created — the same reading for the three entities. */
  age: {
    tasks: { rows: AgeRow[]; total: AgeRow };
    requests: CreatedAgeTable;
    projects: CreatedAgeTable;
  };
  /** Where the open work sits, and what has not moved out of its status. */
  byStatus: { tasks: ByStatusTable; requests: ByStatusTable; projects: ByStatusTable };
  leadTime: {
    tasks: LeadTime;
    tasksByType: LeadTimeByType[];
    requests: LeadTime & { converted: LeadTime; rejected: LeadTime };
    projects: LeadTime & { done: ProjectDoneLeadTime };
  };
};

/** Periods the report offers for tasks, in weeks. Anything else falls back to the middle one. */
export const FLOW_WEEKS = [8, 13, 26] as const;
export const FLOW_DEFAULT_WEEKS = 13;

/** Periods the report offers for requests and projects, in months. */
export const FLOW_MONTHS = [6, 12, 24] as const;
export const FLOW_DEFAULT_MONTHS = 12;
