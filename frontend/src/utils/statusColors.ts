/**
 * Centralized status color utility for the KANAP "Refined Density" design system.
 *
 * Provides dot+text colors for all semantic status types.
 * All pages import from here — no more per-page color maps.
 *
 * MUI color name → actual hex for light and dark modes.
 * The MUI name is kept for backward compatibility with existing StatusConfig types.
 */

export interface StatusDotColor {
  light: string;
  dark: string;
}

/**
 * Maps a MUI semantic color name to the actual dot+text hex pair.
 *
 * Semantic logic (4 colors + 1 accent):
 *   grey    = passive / not started (open, waiting, draft)
 *   blue    = active / in progress
 *   orange  = attention required / blocked (on hold, pending)
 *   green   = done / validated
 *   red     = failed / rejected / cancelled
 *   purple  = in testing (accent, kept distinct from blue)
 */
const MUI_COLOR_TO_DOT: Record<string, StatusDotColor> = {
  success:   { light: '#15803D', dark: '#4ADE80' },   // green — done, approved
  error:     { light: '#B91C1C', dark: '#F87171' },   // red — cancelled, rejected
  warning:   { light: '#B45309', dark: '#F0A830' },   // orange — on hold, pending
  info:      { light: '#1D4ED8', dark: '#60A5FA' },   // blue — in progress, active
  secondary: { light: '#7C3AED', dark: '#A78BFA' },   // purple — in testing
  default:   { light: '#6B7280', dark: 'rgba(255,255,255,0.45)' }, // grey — open, not started
};

/**
 * Get dot+text color for a given MUI color name.
 */
export function getDotColor(muiColor: string | undefined, mode: 'light' | 'dark'): string {
  return (MUI_COLOR_TO_DOT[muiColor ?? 'default'] ?? MUI_COLOR_TO_DOT.default)[mode];
}

/**
 * Pill background colors for dashboard cards (subtle tint + colored text).
 */
const MUI_COLOR_TO_PILL_BG: Record<string, StatusDotColor> = {
  success:   { light: '#F0FDF4', dark: 'rgba(34,197,94,0.12)' },
  error:     { light: '#FEF2F2', dark: 'rgba(239,68,68,0.12)' },
  warning:   { light: '#FFF4E0', dark: 'rgba(240,168,48,0.12)' },
  info:      { light: '#EFF6FF', dark: 'rgba(59,130,246,0.12)' },
  secondary: { light: '#F5F3FF', dark: 'rgba(124,58,237,0.12)' },  // purple tint
  default:   { light: '#F3F4F6', dark: 'rgba(255,255,255,0.06)' },
};

/**
 * Get pill background color for dashboard card chips.
 */
export function getPillBg(muiColor: string | undefined, mode: 'light' | 'dark'): string {
  return (MUI_COLOR_TO_PILL_BG[muiColor ?? 'default'] ?? MUI_COLOR_TO_PILL_BG.default)[mode];
}

/* ------------------------------------------------------------------ */
/*  Unified status color maps (single source of truth)                */
/* ------------------------------------------------------------------ */

/** User account lifecycle (Users admin page) */
export const USER_ACCOUNT_STATUS_COLORS: Record<string, string> = {
  enabled: 'success',
  invited: 'info',
  pending_access: 'warning',
  disabled: 'default',
};

/** Task statuses */
export const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'default',
  in_progress: 'info',
  pending: 'warning',
  in_testing: 'secondary',
  done: 'success',
  cancelled: 'error',
};

/** Project statuses */
export const PROJECT_STATUS_COLORS: Record<string, string> = {
  waiting_list: 'default',
  planned: 'default',
  in_progress: 'info',
  in_testing: 'secondary',
  on_hold: 'warning',
  done: 'success',
  cancelled: 'error',
};

/** Project phase statuses */
export const PHASE_STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
};

/** Project milestone statuses */
export const MILESTONE_STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  achieved: 'success',
  missed: 'error',
};

/** Request statuses */
export const REQUEST_STATUS_COLORS: Record<string, string> = {
  pending_review: 'default',
  candidate: 'info',
  approved: 'success',
  on_hold: 'warning',
  rejected: 'error',
  converted: 'success',
};

/** Knowledge document statuses */
export const KNOWLEDGE_STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  in_review: 'warning',
  published: 'success',
  archived: 'secondary',
  obsolete: 'default',
};

/** Priority levels (shared across tasks/requests/projects) */
export const PRIORITY_COLORS: Record<string, string> = {
  blocker: 'error',
  high: 'warning',
  normal: 'default',
  low: 'default',
  optional: 'default',
};

/** Lifecycle statuses (interfaces, applications, connections) */
export const LIFECYCLE_COLORS: Record<string, string> = {
  proposed: 'info',
  active: 'success',
  deprecated: 'warning',
  retired: 'default',
};

/** Application criticality levels */
export const CRITICALITY_COLORS: Record<string, string> = {
  low: 'default',
  medium: 'info',
  high: 'warning',
  business_critical: 'warning',
};

/** Incident severity (IT incident register) */
export const INCIDENT_SEVERITY_COLORS: Record<string, string> = {
  critical: 'error',
  major: 'warning',
  minor: 'info',
  low: 'default',
};

/** Incident statuses (IT incident register) */
export const INCIDENT_STATUS_COLORS: Record<string, string> = {
  open: 'warning',
  in_progress: 'info',
  resolved: 'success',
  closed: 'default',
  cancelled: 'default',
};

/** Decision outcomes */
export const DECISION_COLORS: Record<string, string> = {
  go: 'success',
  no_go: 'error',
  defer: 'warning',
  need_info: 'info',
  analysis_complete: 'info',
};

/** Sample data of a workspace (Administration › Sample data): running in blue, never orange. */
export const SAMPLE_DATA_STATUS_COLORS: Record<string, string> = {
  idle: 'default',
  loading: 'info',
  resetting: 'info',
  loaded: 'success',
  failed: 'error',
};
