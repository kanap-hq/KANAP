import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Stack, Alert, LinearProgress, Divider } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { csvRequestErrorMessage } from './csvRequestError';
import { csvEntityOf, csvFieldLabel } from './csvLabels';
import { CsvReportMessage, csvMessageText } from './csvMessage';
import { AmountReading, DateReading, amountReadingOf, dateReadingOf, screenLanguage } from './readings';
import { useImportFiles } from './importFiles';

type ImportReport = {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  processed?: number;
  /** Rows identical to what is stored, left untouched (budget rows import only). */
  unchanged?: number;
  errors: RowError[];
  /** Rows that import, with a note on how (account numbers whose leading zeros are dropped). */
  warnings?: RowError[];
  /** How the server read the dates and the amounts, in English, when it had to choose. */
  notices?: { dates: string | null; amounts: string | null; firstSheetOnly?: string };
  /** Headers the importer does not know and left out of the import. */
  ignoredColumns?: string[];
};

/**
 * `code`: the error code the interface translates, when the server gave one (MARKDOWN_TOO_LARGE, ...),
 * with the values its sentence names (`params`). Row 0 is the header.
 */
type RowError = CsvReportMessage;

/** A row error in the interface language when it has a code, with the column it is about. */
function rowErrorText(err: RowError, t: TFunction, entity: string): string {
  const message = csvMessageText(err, t);
  if (err.row === 0) return t('csv.headerError', { message });
  const column = err.column ? csvFieldLabel(t, entity, { csvColumn: err.column, label: err.column }) : err.column;
  return err.code && column
    ? t('csv.rowColumnError', { row: err.row, column, message })
    : t('csv.rowError', { row: err.row, message });
}

/** The notice sentences and the switch labels, shared with the budget file import. */
// `t` is bound to `common` (the first namespace): the `ops` keys need their prefix.
const K = 'ops:operations.budgetFile.';

/**
 * The heading of a refused file. Every importer numbers the data rows from 2 (row 1 is the header):
 * an error on row 0 or 1 is about the file itself (a header mismatch, an empty file, an unknown
 * column), the others are about the rows.
 */
function refusedFileHeading(errors: ImportReport['errors']): 'csv.fileNotFormatted' | 'csv.validationFailed' {
  return errors.length > 0 && errors.every((e) => e.row >= 2) ? 'csv.validationFailed' : 'csv.fileNotFormatted';
}

/** Created, updated and unchanged rows after a load. A count of zero is left out. */
function loadedSummary(report: ImportReport, t: TFunction): string {
  const parts: string[] = [];
  if (report.inserted > 0) parts.push(t('csv.loadedCreated', { count: report.inserted }));
  if (report.updated > 0) parts.push(t('csv.loadedUpdated', { count: report.updated }));
  if ((report.unchanged ?? 0) > 0) parts.push(t('csv.loadedUnchanged', { count: report.unchanged }));
  if (parts.length === 0) return t('csv.loadedSuccessfully', { count: report.processed ?? report.total ?? 0 });
  return parts.join(', ');
}

export default function CsvImportDialog({
  open,
  onClose,
  endpoint,
  title: titleProp,
  onImported,
  params,
  preflight = true,
  flexibleFormat = false,
  hint,
  hintList,
}: {
  // i18n handled below
  open: boolean;
  onClose: () => void;
  endpoint: string; // e.g. '/suppliers'
  title?: string;
  onImported?: () => void; // called after successful non-dryRun import
  params?: Record<string, string | number | boolean | null | undefined>;
  preflight?: boolean; // when false, skip preflight and perform single-step upload
  /**
   * The master-data files: the separator, the amount convention and the dates
   * follow the screen language, and an Excel-saved file imports as it is. The
   * files that keep the semicolon (CoA templates, the IT and portfolio
   * registers) leave this off.
   */
  flexibleFormat?: boolean;
  /** The values the file's columns accept, when the template's titles do not say it, under the description. */
  hint?: string;
  /** The same note as a short list: one introduction, then one line per rule. */
  hintList?: { intro: string; items: string[] };
}) {
  const { t, i18n } = useTranslation(['common', 'ops']);
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const entity = csvEntityOf(endpoint);
  const { accept, workbook } = useImportFiles();
  const [file, setFile] = useState<File | null>(null);
  const [hover, setHover] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  // The reading a switch or an earlier report settled on, pinned for the import that follows.
  const [dateOrder, setDateOrder] = useState<DateReading | null>(null);
  const [amountReading, setAmountReading] = useState<AmountReading | null>(null);
  // The request itself failed: the server's message, shown instead of a report.
  const [requestError, setRequestError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const dateNotice = report?.notices?.dates ?? null;
  const amountNotice = report?.notices?.amounts ?? null;
  // An Excel workbook of several sheets: the one read, the first.
  const firstSheetOnly = report?.notices?.firstSheetOnly;
  // What the shown report says, when it is one of the sentences the dialog knows.
  const appliedDates = dateReadingOf(dateNotice);
  const appliedAmounts = amountReadingOf(amountNotice);
  // A file refused for its header ignores nothing: the header error already names the unknown columns.
  const headerRefused = (report?.errors ?? []).some((e) => e.row < 2);
  const ignoredColumns = headerRefused ? [] : report?.ignoredColumns ?? [];
  // Shown with the check, before the load: the rows import as the warnings say.
  const warnings = report?.dryRun ? report.warnings ?? [] : [];
  // A dry run is re-checked and then loaded; a finished import only reports its outcome.
  const completed = !!report && report.ok && !report.dryRun;

  const reset = useCallback(() => {
    setFile(null);
    setReport(null);
    setDateOrder(null);
    setAmountReading(null);
    setRequestError(null);
    setLoading(false);
    setHover(false);
  }, []);

  const chooseFile = (next: File | null | undefined) => {
    if (!next) return;
    // A new file decides its own reading: the next check starts from the server's choice.
    setDateOrder(null);
    setAmountReading(null);
    // The report and the error were about the previous file.
    setReport(null);
    setRequestError(null);
    setFile(next);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(false);
    chooseFile(e.dataTransfer.files?.[0]);
  };

  const onPick = () => inputRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    chooseFile(e.target.files?.[0] || null);
  };

  /** `chosen` carries the reading a switch just picked, before the state has caught up. */
  const upload = async (
    dryRun: boolean,
    chosen: { dateOrder?: DateReading | null; decimalMark?: AmountReading | null } = {},
  ) => {
    if (!file) return;
    setLoading(true);
    setReport(null);
    setRequestError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const queryParams: Record<string, string | number | boolean | null | undefined> = {
        ...(params ?? {}),
        language,
        dryRun,
      };
      // Keep the reading the shown report applied, so the load repeats the dry run.
      const order = chosen.dateOrder ?? dateOrder ?? appliedDates;
      const mark = chosen.decimalMark ?? amountReading ?? appliedAmounts;
      if (order) queryParams.dateOrder = order;
      if (mark) queryParams.decimalMark = mark;
      const res = await api.post(`${endpoint}/import`, fd, { params: queryParams });
      const data = res.data as ImportReport;
      setReport(data);
      if (!dryRun && (data as any)?.ok) {
        onImported?.();
      }
    } catch (e) {
      console.error('Import failed', e);
      setRequestError(getApiErrorMessage(e, t, t('csv.fileNotFormatted')));
    } finally {
      setLoading(false);
    }
  };

  // A switch checks the file again, so the report always matches what Load sends.
  const switchDates = () => {
    if (!appliedDates) return;
    const next: DateReading = appliedDates === 'day-first' ? 'month-first' : 'day-first';
    setDateOrder(next);
    if (report?.dryRun) void upload(true, { dateOrder: next });
  };
  const switchAmounts = () => {
    if (!appliedAmounts) return;
    // Keep the date order the check applied when switching amounts.
    const order = dateOrder ?? appliedDates;
    if (!dateOrder && order) setDateOrder(order);
    const next: AmountReading = appliedAmounts === 'comma' ? 'dot' : 'comma';
    setAmountReading(next);
    if (report?.dryRun) void upload(true, { dateOrder: order, decimalMark: next });
  };

  const canLoad = useMemo(() => !!report && (report as any).ok && (report as any).dryRun, [report]);

  const downloadTemplate = async () => {
    setRequestError(null);
    try {
      const queryParams = { ...(params ?? {}), language, scope: 'template' };
      const res = await api.get(`${endpoint}/export`, { params: queryParams, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = (res.headers?.['content-disposition'] ?? res.headers?.['Content-Disposition']) as string | undefined;
      let filename = 'template.csv';
      if (disposition) {
        const match = /filename="?([^"]+)"?/i.exec(disposition);
        if (match?.[1]) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Template download failed', e);
      setRequestError(await csvRequestErrorMessage(e, t, t('messages.exportFailed')));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" onTransitionExited={reset}>
      <DialogTitle>{titleProp || t(workbook ? 'buttons.import' : 'csv.importTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t(flexibleFormat
            ? (workbook ? 'csv.uploadDescriptionFlexibleWorkbook' : 'csv.uploadDescriptionFlexible')
            : (workbook ? 'csv.uploadDescriptionWorkbook' : 'csv.uploadDescription'))}
        </Typography>
        {hint && <Typography variant="body2" sx={{ mb: 2 }}>{hint}</Typography>}
        {hintList && hintList.items.length > 0 && (
          <Box sx={{ mb: 2 }}>
            {hintList.intro ? <Typography variant="body2" sx={{ mb: 0.5 }}>{hintList.intro}</Typography> : null}
            <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
              {hintList.items.map((item) => (
                <Typography component="li" key={item} variant="body2">{item}</Typography>
              ))}
            </Box>
          </Box>
        )}
        <Button
          variant="text"
          size="small"
          startIcon={<DownloadIcon />}
          onClick={downloadTemplate}
          sx={{ mb: 2 }}
        >
          {t('csv.downloadTemplate')}
        </Button>
        <Divider sx={{ mb: 2 }} />
        <Box
          onDragOver={(e) => { e.preventDefault(); setHover(true); }}
          onDragLeave={() => setHover(false)}
          onDrop={onDrop}
          sx={{
            border: '2px dashed',
            borderColor: hover ? 'primary.main' : 'divider',
            borderRadius: 1,
            p: 3,
            textAlign: 'center',
            cursor: 'pointer',
            mb: 2,
          }}
          onClick={onPick}
        >
          <Typography>{file ? file.name : t(workbook ? 'csv.dragDropFileOrClick' : 'csv.dragDropOrClick')}</Typography>
          <input type="file" ref={inputRef} onChange={onFileChange} hidden accept={accept} />
        </Box>
        <Stack direction="row" spacing={1}>
          {preflight ? (
            <>
              <Button variant="outlined" onClick={() => upload(true)} disabled={!file || loading}>{t('csv.preflightCheck')}</Button>
              <Button variant="contained" onClick={() => upload(false)} disabled={!file || loading || !canLoad}>{t('csv.load')}</Button>
            </>
          ) : (
            <Button variant="contained" onClick={() => upload(false)} disabled={!file || loading}>{t('buttons.upload')}</Button>
          )}
        </Stack>
        {loading && <LinearProgress sx={{ mt: 2 }} />}
        {requestError && <Alert severity="error" sx={{ mt: 2 }}>{requestError}</Alert>}
        {report && !completed && (dateNotice || amountNotice || ignoredColumns.length > 0 || firstSheetOnly !== undefined) && (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {dateNotice && (
              <NoticeLine
                text={appliedDates ? t(appliedDates === 'day-first' ? `${K}datesDayFirst` : `${K}datesMonthFirst`) : dateNotice}
                action={appliedDates && report.dryRun ? t(appliedDates === 'day-first' ? `${K}readMonthFirst` : `${K}readDayFirst`) : null}
                onAction={switchDates}
                disabled={loading}
              />
            )}
            {amountNotice && (
              <NoticeLine
                text={appliedAmounts ? t(appliedAmounts === 'comma' ? `${K}amountsComma` : `${K}amountsDot`) : amountNotice}
                action={appliedAmounts && report.dryRun ? t(appliedAmounts === 'comma' ? `${K}readDecimalDot` : `${K}readDecimalComma`) : null}
                onAction={switchAmounts}
                disabled={loading}
              />
            )}
            {ignoredColumns.length > 0 && (
              <NoticeLine text={t('csv.ignoredColumns', { columns: ignoredColumns.join(', ') })} action={null} />
            )}
            {firstSheetOnly !== undefined && (
              <NoticeLine text={t(`${K}firstSheetOnly`, { name: firstSheetOnly })} action={null} />
            )}
          </Box>
        )}
        {report && (
          <Box sx={{ mt: 2 }}>
            {(report as any).ok ? (
              <Alert severity="success">
                {preflight ? (
                  (report as any).dryRun ? (
                    <>{t('csv.preflightOk', { count: (report as any).total ?? 0, inserted: (report as any).inserted, updated: (report as any).updated })}</>
                  ) : (
                    <>{loadedSummary(report, t)}</>
                  )
                ) : (
                  <>{t('csv.uploadCompleted')}</>
                )}
                {report.dryRun && typeof report.unchanged === 'number' && (
                  <Box component="span" sx={{ display: 'block' }}>{t('csv.rowsUnchanged', { count: report.unchanged })}</Box>
                )}
              </Alert>
            ) : (
              <Alert severity="error">{t(refusedFileHeading(report.errors ?? []))}</Alert>
            )}
            {(report as any).errors && (report as any).errors.length > 0 && (
              <Box sx={{ mt: 1 }}>
                {(report as any).errors.slice(0, 5).map((err: any, i: number) => (
                  <Typography key={i} variant="body2">{rowErrorText(err, t, entity)}</Typography>
                ))}
                {(report as any).errors.length > 5 && (
                  <Typography variant="caption">{t('csv.andMoreErrors', { count: (report as any).errors.length - 5 })}</Typography>
                )}
              </Box>
            )}
            {warnings.length > 0 && (
              <Alert severity="warning" sx={{ mt: 1 }} data-testid="csv-import-warnings">
                {warnings.slice(0, 5).map((warning, i) => (
                  <Box key={i} component="span" sx={{ display: 'block' }}>{rowErrorText(warning, t, entity)}</Box>
                ))}
                {warnings.length > 5 && (
                  <Box component="span" sx={{ display: 'block' }}>{t('csv.andMoreErrors', { count: warnings.length - 5 })}</Box>
                )}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('buttons.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function ActionLink({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="text"
      size="small"
      onClick={onClick}
      disabled={disabled}
      sx={{ p: 0, minWidth: 0, fontSize: 12, fontWeight: 400, textTransform: 'none', lineHeight: 1.4, whiteSpace: 'nowrap', '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } }}
    >
      {children}
    </Button>
  );
}

function NoticeLine({ text, action, onAction, disabled }: { text: string; action: string | null; onAction?: () => void; disabled?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{text}</Typography>
      {action && onAction && <ActionLink onClick={onAction} disabled={disabled}>{action}</ActionLink>}
    </Box>
  );
}
