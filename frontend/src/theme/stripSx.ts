import type { Theme } from '@mui/material/styles';

/**
 * The full-width metric strip of a status page (charter: "Workspace metric strips"): one light
 * surface, groups of a tertiary label over a value, an optional small line under it. Spread into
 * the page's `sx` and use the `kanap-strip*` class names (NetboxSyncPage, SampleDataPage).
 */
export const metricStripSx = (theme: Theme) => ({
  '& .kanap-strip': {
    // Several groups: pack them left with a generous gap. `space-between` is for the
    // two-metric case and scatters the groups across a wide page.
    display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start',
    gap: '40px', flexWrap: 'wrap', fontSize: 13, p: '14px 18px',
    bgcolor: theme.palette.kanap.bg.drawer,
    borderRadius: '8px',
    border: `1px solid ${theme.palette.kanap.border.soft}`,
    width: '100%', boxSizing: 'border-box',
  },
  '& .kanap-strip-group': { display: 'flex', flexDirection: 'column', gap: '2px' },
  '& .kanap-strip-label': { fontSize: 12, color: theme.palette.kanap.text.tertiary, whiteSpace: 'nowrap' },
  '& .kanap-strip-val': { fontWeight: 500, color: theme.palette.kanap.text.primary, display: 'flex', alignItems: 'center', gap: '6px' },
  '& .kanap-strip-sub': { fontSize: 11, color: theme.palette.kanap.text.tertiary },
});
