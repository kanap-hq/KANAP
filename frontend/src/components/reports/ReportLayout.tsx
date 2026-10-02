import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Box, Stack, Typography, IconButton, Tooltip, Breadcrumbs, Link as MLink, ThemeProvider, useTheme } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import PrintIcon from '@mui/icons-material/Print';
import ImageIcon from '@mui/icons-material/Image';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FieldLabel } from '../design';
import { compactSelectMenuProps } from '../../theme/formSx';
import { lightIslandTheme } from '../../config/ThemeContext';
import { useLocale } from '../../i18n/useLocale';
import { prepareReportPrint, setReportPrinting, useReportPrinting } from './reportPrint';
import { REPORT_DATA_STATUS_CLASS } from './ReportDataStatus';

/**
 * Label-above wrapper for a filter control in a report filter bar. The charter bans
 * `FormControl` + `InputLabel` (and the `label` prop that builds one), so the label is
 * a plain block above the field, exactly like `PropertyRow` in drawers and dialogs.
 */
export function ReportFilter({
  label,
  width = 220,
  children,
}: {
  label: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: width }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </Box>
  );
}

/** Shared sizing/typography for the `<Select>` of a report filter. The theme draws the box. */
export const reportFilterSelectSx = {
  width: '100%',
  '& .MuiSelect-select': { fontSize: 13, lineHeight: 1.4 },
} as const;

/** Menu props every report filter select uses, so field and menu read as one object. */
export const reportFilterMenuProps = compactSelectMenuProps;

/**
 * Height of a report grid: everything left between its top edge and the bottom of the
 * viewport, so a report fills the screen the way the list pages do instead of showing a
 * fixed slice with empty space below. Re-measured on resize and after every render (the
 * filter bar wraps, alerts appear), and only committed when it actually moved.
 */
export function useFillViewportHeight(minHeight = 320, bottomPad = 16) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(minHeight);

  const measure = () => {
    const node = ref.current;
    if (!node) return;
    const { top } = node.getBoundingClientRect();
    const next = Math.max(minHeight, Math.floor(window.innerHeight - top - bottomPad));
    setHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  };

  // No dependency array on purpose: a re-render can move the grid (filter bar wrapping,
  // an alert appearing), and `measure` is a no-op once the value has converged.
  useEffect(measure);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minHeight, bottomPad]);

  return { ref, height };
}

/** Matches `--ag-row-height` / `--ag-header-height` in `ag-grid-overrides.css`. */
const GRID_ROW_HEIGHT = 38;
const GRID_HEADER_HEIGHT = 36;

/**
 * Grid height: the screen space available, but never more than the rows actually need,
 * so a short report does not leave a tall empty grid and a long one fills the viewport.
 */
export function reportGridHeight(fillHeight: number, rowCount: number, minHeight = 320) {
  const contentHeight = GRID_HEADER_HEIGHT + Math.max(rowCount, 1) * GRID_ROW_HEIGHT + 2;
  return Math.max(minHeight, Math.min(fillHeight, contentHeight));
}

/**
 * Print mode of a report. The toolbar button, Ctrl+P and `?print=1` go through
 * `requestPrint`: switch to print mode, wait for every chart to be redrawn in the light
 * theme at its paper width and copied, then open the dialog. A print started elsewhere (browser
 * menu) still gets the switch, flushed synchronously on `beforeprint` because the browser
 * lays the pages out right after the handlers return. `afterprint` puts the screen back.
 */
function useReportPrintMode() {
  const printing = useReportPrinting();
  const requestingRef = useRef(false);

  const requestPrint = useCallback(async () => {
    if (requestingRef.current) return;
    requestingRef.current = true;
    try {
      flushSync(() => setReportPrinting(true));
      await prepareReportPrint();
      window.print();
    } finally {
      requestingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const onBeforePrint = () => flushSync(() => setReportPrinting(true));
    const onAfterPrint = () => setReportPrinting(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.key !== 'p' && event.key !== 'P') return;
      event.preventDefault();
      void requestPrint();
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      window.removeEventListener('keydown', onKeyDown);
      setReportPrinting(false);
    };
  }, [requestPrint]);

  return { printing, requestPrint };
}

export default function ReportLayout({
  title,
  subtitle,
  filters,
  actions,
  rootTo = '/ops/reports',
  rootLabel,
  onExportTableCsv,
  onExportChartPng,
  busy = false,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  rootTo?: string;
  rootLabel?: string;
  onExportTableCsv?: () => void;
  onExportChartPng?: () => void;
  /**
   * The report's numbers are loading, or are the last answer kept while new ones load: the chart
   * and the tables are dimmed (the status line is not), and the exports and the print wait.
   */
  busy?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation(['ops']);
  const locale = useLocale();
  const screenTheme = useTheme();
  const { printing, requestPrint } = useReportPrintMode();

  // Auto-print when `?print=1` present, once the numbers are in.
  const autoPrinted = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== '1' || busy || autoPrinted.current) return undefined;
    const timer = setTimeout(() => {
      autoPrinted.current = true;
      void requestPrint();
    }, 300);
    return () => clearTimeout(timer);
  }, [requestPrint, busy]);

  const printedOn = printing
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date())
    : null;

  // Paper is white: the print view always uses the light palette, whatever the screen mode.
  return (
    <ThemeProvider theme={printing ? lightIslandTheme : screenTheme}>
      <Stack spacing={1.5} sx={{ width: '100%', alignSelf: 'stretch' }} className="report-print-frame">
        <Box>
          <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 0.5, fontSize: 12 }} className="report-print-hide">
            <MLink component={RouterLink} to={rootTo} underline="hover" color="inherit" sx={{ fontSize: 12 }}>
              {rootLabel ?? t('reports.landing.title')}
            </MLink>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{title}</Typography>
          </Breadcrumbs>
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={2}>
            <Typography sx={{ fontSize: 22, fontWeight: 500, lineHeight: 1.3, color: 'kanap.text.primary' }}>
              {title}
            </Typography>
            {printedOn && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}>
                {t('reports.shared.printedOn', { date: printedOn })}
              </Typography>
            )}
          </Stack>
          {subtitle && (
            <Typography sx={{ mt: 0.5, fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box
          className="report-print-hide"
          sx={{
            bgcolor: 'kanap.bg.drawer',
            border: '1px solid',
            borderColor: 'kanap.border.soft',
            borderRadius: '8px',
            px: 2,
            py: 1.5,
          }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'flex-end' }} justifyContent="space-between">
            <Stack
              direction="row"
              spacing={2}
              useFlexGap
              alignItems="flex-end"
              sx={{ flexWrap: 'wrap', rowGap: { xs: 1, md: 1.5 } }}
            >
              {filters}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              {actions}
              {onExportTableCsv && (
                <Tooltip title={t('reports.shared.exportTableCsv')}>
                  <span>
                    <IconButton size="small" onClick={onExportTableCsv} disabled={busy} aria-label={t('reports.shared.exportTableCsv')} sx={{ color: 'kanap.text.secondary' }}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {onExportChartPng && (
                <Tooltip title={t('reports.shared.exportChartPng')}>
                  <span>
                    <IconButton size="small" onClick={onExportChartPng} disabled={busy} aria-label={t('reports.shared.exportChartPng')} sx={{ color: 'kanap.text.secondary' }}>
                      <ImageIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <Tooltip title={t('reports.shared.printPdf')}>
                <span>
                  <IconButton size="small" onClick={() => void requestPrint()} disabled={busy} aria-label={t('reports.shared.printReport')} sx={{ color: 'kanap.text.secondary' }}>
                    <PrintIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
        </Box>
        <Box
          aria-busy={busy || undefined}
          sx={{
            [`& > :not(.${REPORT_DATA_STATUS_CLASS})`]: { transition: 'opacity 120ms', opacity: busy ? 0.45 : 1 },
          }}
        >
          {children}
        </Box>
      </Stack>
    </ThemeProvider>
  );
}
