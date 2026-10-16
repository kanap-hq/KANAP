/** Horizons each block offers, and the one it falls back to. */
export const UPCOMING_TASK_DAYS = [7, 14, 30] as const;
export const UPCOMING_TASK_DEFAULT_DAYS = 14;
export const UPCOMING_PROJECT_DAYS = [30, 60, 90] as const;
export const UPCOMING_PROJECT_DEFAULT_DAYS = 30;
export const UPCOMING_REQUEST_DAYS = [14, 30, 60] as const;
export const UPCOMING_REQUEST_DEFAULT_DAYS = 30;

/** What every row carries: its business reference, where it opens, its name and status. */
type UpcomingRowCommon = {
  /** `T-4`, `PRJ-3`, `REQ-12`. */
  ref: string;
  itemPath: string;
  name: string;
  status: string;
};

export type UpcomingProjectLink = { ref: string; name: string; itemPath: string };

export type UpcomingTaskRow = UpcomingRowCommon & {
  taskTypeName: string | null;
  /** The shipped type it started as, for display in the reader's language; null for a tenant's own type. */
  taskTypeCode: string | null;
  /** `blocker`, `high`, `normal`, `low` or `optional`. */
  priorityLevel: string | null;
  assigneeName: string | null;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  /** The project the task hangs off, null for a standalone task. */
  project: UpcomingProjectLink | null;
};

export type UpcomingProjectRow = UpcomingRowCommon & {
  priority: number | null;
  /** `YYYY-MM-DD` or null. */
  plannedStart: string | null;
  plannedEnd: string | null;
  progress: number | null;
  itLeadName: string | null;
  businessLeadName: string | null;
};

export type UpcomingRequestRow = UpcomingRowCommon & {
  sourceName: string | null;
  /** The creation day, `YYYY-MM-DD`, read the way the request list reads it. */
  createdOn: string | null;
  targetDeliveryDate: string | null;
  requestorName: string | null;
};

/** A block that looks forward: from `asOf` to `until`, both days included. */
type HorizonBlock<TRow> = { horizonDays: number; until: string; rows: TRow[] };

export type UpcomingReportResponse = {
  /** Today in the viewer's zone, `YYYY-MM-DD`. */
  asOf: string;
  tasks: HorizonBlock<UpcomingTaskRow> & {
    /** Open tasks whose due day is already past, the steering strip's rule. */
    overdueCount: number;
  };
  projectEnds: HorizonBlock<UpcomingProjectRow> & {
    /** Open projects whose planned end is already past. */
    passedCount: number;
  };
  projectStarts: HorizonBlock<UpcomingProjectRow>;
  pendingRequests: {
    thresholdDays: number;
    /**
     * The first creation day that no longer counts, `asOf` minus the threshold plus one: a
     * request counts when created before it, i.e. at least `thresholdDays` days ago. The list
     * link reads the same bound with `lessThan`, the date operator the list grid restores.
     */
    createdBefore: string;
    rows: UpcomingRequestRow[];
  };
  requestDeliveries: HorizonBlock<UpcomingRequestRow>;
};
