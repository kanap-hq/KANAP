/**
 * Task Detail Page — design tokens
 *
 * All spacing, border-radius, typography and color constants for the
 * redesigned task detail page.  Consumed via MUI `sx` props.
 *
 * Color tokens that depend on theme mode live under `kanapPalette` and are
 * injected into the MUI theme as `theme.palette.kanap.*`.
 */

import type { TaskStatus } from '../task.constants';

/* ------------------------------------------------------------------ */
/*  Layout tokens (mode-independent)                                  */
/* ------------------------------------------------------------------ */

export const taskDetailTokens = {
  topbar: {
    py: '11px',
    px: '20px',
  },
  titleBlock: {
    pt: '26px',
    px: '32px',
    pb: '22px',
  },
  section: {
    pt: '24px',
    px: '32px',
    pb: 0,
    pbLast: '32px',
  },
  titleRow: {
    gap: '24px',
    mb: '18px',
  },
  titleStack: {
    gap: '10px',
    metadataToTabsGap: '36px',
    metadataOnlyBottomGap: '40px',
  },
  metadataBar: {
    gap: '22px',
  },
  activityHead: {
    gap: '20px',
    mb: '14px',
  },
  composer: {
    borderRadius: '8px',
    inputPadding: '14px 16px 18px',
    inputMinHeight: 56,
    footPadding: '10px 16px 12px',
    footGap: '18px',
    mb: '22px',
  },
  comments: {
    gap: '22px',
  },
  actionPills: {
    gap: '8px',
  },
  breadcrumb: {
    gap: '9px',
  },
  drawer: {
    tabWidth: 40,
    tabTop: -48,
    panelTop: -48,
    panelWidth: 280,
    headerPadding: '14px 18px 12px',
    groupPadding: '6px 18px 10px',
    rowPadding: '7px 0',
  },
  borderRadius: {
    composer: '8px',
    pill: '5px',
    submit: '6px',
    avatar: '50%',
    sliderTrack: '2px',
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Typography tokens                                                 */
/* ------------------------------------------------------------------ */

export const taskDetailTypography = {
  title: { fontSize: '22px', fontWeight: 500, lineHeight: 1.3 },
  idPrefix: { fontSize: '14px', fontWeight: 400 },
  bodyDescription: { fontSize: '14px', fontWeight: 400, lineHeight: 1.6 },
  sectionLabel: { fontSize: '12px', fontWeight: 500 },
  metaChip: { fontSize: '12px', fontWeight: 400 },
  metaLabel: { fontSize: '11px', fontWeight: 400 },
  scoreValue: { fontSize: '12px', fontWeight: 400 },
  actionPill: { fontSize: '12px', fontWeight: 500 },
  navChipNum: { fontSize: '11px', fontWeight: 500 },
  commentAuthor: { fontSize: '13px', fontWeight: 500 },
  commentText: { fontSize: '13px', fontWeight: 400, lineHeight: 1.55 },
  commentDate: { fontSize: '11px', fontWeight: 400 },
  tabLabel: { fontSize: '12px' },
  propLabel: { fontSize: '11px', fontWeight: 400 },
  propValue: { fontSize: '12px', fontWeight: 400, lineHeight: 1.45 },
  composerCtrl: { fontSize: '11px', fontWeight: 400 },
  composerSubmit: { fontSize: '12px', fontWeight: 500 },
  linkTeal: { fontSize: '11px', fontWeight: 400 },
} as const;

/* ------------------------------------------------------------------ */
/*  Metadata bar item styling (shared by all workspace metadata bars) */
/* ------------------------------------------------------------------ */

export const metaItemSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '7px',
  ...taskDetailTypography.metaChip,
} as const;

export const metaItemClickableSx = {
  ...metaItemSx,
  cursor: 'pointer',
} as const;

export const metaLabelSx = {
  ...taskDetailTypography.metaLabel,
} as const;

/* ------------------------------------------------------------------ */
/*  Avatar sizes                                                      */
/* ------------------------------------------------------------------ */

export const taskDetailAvatarSizes = {
  metadata: 18,
  comment: 26,
  drawerRequestor: 16,
} as const;

/* ------------------------------------------------------------------ */
/*  Kanap palette (light / dark)                                      */
/* ------------------------------------------------------------------ */

type ModeColors = { light: string; dark: string };

function modeVal(colors: ModeColors, mode: 'light' | 'dark'): string {
  return colors[mode];
}

export const kanapPalette = {
  bg: {
    primary: { light: '#FFFFFF', dark: '#181A20' },
    page: { light: '#FAFAFA', dark: '#0F1117' },
    drawer: { light: '#FBFBFC', dark: '#14161C' },
    composer: { light: '#FFFFFF', dark: '#1F2128' },
    hover: { light: 'rgba(0,0,0,0.04)', dark: 'rgba(255,255,255,0.06)' },
  },
  border: {
    default: { light: '#E5E7EB', dark: 'rgba(255,255,255,0.08)' },
    soft: { light: '#F1F2F4', dark: 'rgba(255,255,255,0.05)' },
    /** Hover border for form fields: one notch darker than `default`. */
    strong: { light: '#D1D5DB', dark: 'rgba(255,255,255,0.16)' },
  },
  text: {
    primary: { light: '#111827', dark: '#E5E7EB' },
    secondary: { light: '#6B7280', dark: '#9CA3AF' },
    /** Dark value reaches 4.5:1 (WCAG AA) on every dark surface, composer included. */
    tertiary: { light: '#9CA3AF', dark: '#818895' },
  },
  teal: { light: '#1A6B7A', dark: '#4DB8C9' },
  tealForeground: { light: '#FFFFFF', dark: '#0F1117' },
  orange: { light: '#E8920F', dark: '#F0A830' },
  danger: { light: '#DC2626', dark: '#F87171' },
  pill: {
    bg: { light: '#F6F7F9', dark: 'rgba(255,255,255,0.04)' },
    border: { light: '#E5E7EB', dark: 'rgba(255,255,255,0.10)' },
    hoverBg: { light: '#EDEEF1', dark: 'rgba(255,255,255,0.07)' },
  },
  pillDanger: {
    bg: { light: 'rgba(220, 38, 38, 0.06)', dark: 'rgba(248, 113, 113, 0.08)' },
    border: { light: 'rgba(220, 38, 38, 0.20)', dark: 'rgba(248, 113, 113, 0.25)' },
    hoverBg: { light: 'rgba(220, 38, 38, 0.10)', dark: 'rgba(248, 113, 113, 0.12)' },
  },
  navChip: {
    bg: { light: 'rgba(26, 107, 122, 0.07)', dark: 'rgba(77, 184, 201, 0.10)' },
    border: { light: 'rgba(26, 107, 122, 0.22)', dark: 'rgba(77, 184, 201, 0.28)' },
    fg: { light: '#1A6B7A', dark: '#4DB8C9' },
  },
  sliderTrack: { light: 'rgba(0,0,0,0.08)', dark: 'rgba(255,255,255,0.10)' },
  tab: {
    bg: { light: 'rgba(26, 107, 122, 0.09)', dark: 'rgba(77, 184, 201, 0.13)' },
    bgHover: { light: 'rgba(26, 107, 122, 0.14)', dark: 'rgba(77, 184, 201, 0.18)' },
    bgActive: { light: '#1A6B7A', dark: '#4DB8C9' },
    border: { light: 'rgba(26, 107, 122, 0.35)', dark: 'rgba(77, 184, 201, 0.42)' },
    borderActive: { light: '#1A6B7A', dark: '#4DB8C9' },
    fg: { light: '#1A6B7A', dark: '#4DB8C9' },
    fgActive: { light: '#FFFFFF', dark: '#0F1117' },
  },
} as const;

/** Resolve a kanapPalette leaf to a concrete color string. */
export { modeVal };

/* ------------------------------------------------------------------ */
/*  Status dot colors                                                 */
/* ------------------------------------------------------------------ */

export const STATUS_DOT_COLORS: Record<TaskStatus, ModeColors> = {
  open: { light: '#9CA3AF', dark: '#9CA3AF' },
  pending: { light: '#E8920F', dark: '#F0A830' },
  in_progress: { light: '#3B82F6', dark: '#60A5FA' },
  in_testing: { light: '#8B5CF6', dark: '#A78BFA' },
  done: { light: '#10B981', dark: '#34D399' },
  cancelled: { light: '#9CA3AF', dark: '#6B7280' },
};

/* ------------------------------------------------------------------ */
/*  Priority dot colors                                               */
/* ------------------------------------------------------------------ */

export type PriorityLevel = 'blocker' | 'high' | 'normal' | 'low' | 'optional';

export const PRIORITY_DOT_COLORS: Record<PriorityLevel, ModeColors> = {
  blocker: { light: '#DC2626', dark: '#F87171' },
  high: { light: '#E8920F', dark: '#F0A830' },
  normal: { light: '#3B82F6', dark: '#60A5FA' },
  low: { light: '#9CA3AF', dark: '#9CA3AF' },
  optional: { light: '#D1D5DB', dark: '#6B7280' },
};

/* ------------------------------------------------------------------ */
/*  Score color scale                                                 */
/* ------------------------------------------------------------------ */

export function getScoreColor(score: number, mode: 'light' | 'dark'): string {
  if (score < 60) return mode === 'light' ? '#9CA3AF' : '#6B7280';
  if (score < 70) return mode === 'light' ? '#6B7280' : '#9CA3AF';
  if (score < 80) return mode === 'light' ? '#111827' : '#E5E7EB';
  if (score < 90) return mode === 'light' ? '#F0A830' : '#FAC775';
  return mode === 'light' ? '#E8920F' : '#F0A830';
}

/* ------------------------------------------------------------------ */
/*  Helper: build resolved kanap palette for a given mode             */
/* ------------------------------------------------------------------ */

function resolveLeaf(obj: Record<string, ModeColors>, mode: 'light' | 'dark'): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    resolved[key] = modeVal(val, mode);
  }
  return resolved;
}

/** Returns a flat resolved palette object for injection into MUI theme. */
export function resolveKanapPalette(mode: 'light' | 'dark') {
  return {
    bg: resolveLeaf(kanapPalette.bg, mode),
    border: resolveLeaf(kanapPalette.border, mode),
    text: resolveLeaf(kanapPalette.text, mode),
    teal: modeVal(kanapPalette.teal, mode),
    tealForeground: modeVal(kanapPalette.tealForeground, mode),
    orange: modeVal(kanapPalette.orange, mode),
    danger: modeVal(kanapPalette.danger, mode),
    pill: resolveLeaf(kanapPalette.pill, mode),
    pillDanger: resolveLeaf(kanapPalette.pillDanger, mode),
    navChip: resolveLeaf(kanapPalette.navChip, mode),
    sliderTrack: modeVal(kanapPalette.sliderTrack, mode),
    tab: resolveLeaf(kanapPalette.tab, mode),
  };
}

export type ResolvedKanapPalette = ReturnType<typeof resolveKanapPalette>;
