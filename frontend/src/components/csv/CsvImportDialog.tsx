import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Stack, Alert, LinearProgress, Divider } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { AmountReading, DateReading, amountReadingOf, dateReadingOf, screenLanguage } from './readings';

type ImportReport = {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  processed?: number;
  /** Rows identical to what is stored, left untouched (budget rows import only). */
  unchanged?: number;
  errors: { row: number; message: string }[];
  /** How the server read the dates and the amounts, in English, when it had to choose. */
  notices?: { dates: string | null; amounts: string | null };
  /** Headers the importer does not know and left out of the import. */
  ignoredColumns?: string[];
};

/** The notice sentences and the switch labels, shared with the budget file import. */
const K = 'operations.budgetFile.';

/**
 * The heading of a refused file. Every importer numbers the data rows from 2 (row 1 is the header):
 * an error on row 0 or 1 is about the file itself (a header mismatch, an empty file, an unknown
 * column), the others are about the rows.
 */
function refusedFileHeading(errors: ImportReport['errors']): 'csv.fileNotFormatted' | 'csv.validationFailed' {
  return errors.length > 0 && errors.every((e) => e.row >= 2) ? 'csv.validationFailed' : 'csv.fileNotFormatted';
}

export default function CsvImportDialog({
  open,
  onClose,
  endpoint,
  title: titleProp,
  onImported,
  params,
  preflight = true,
}: {
  // i18n handled below
  open: boolean;
  onClose: () => void;
  endpoint: string; // e.g. '/suppliers'
  title?: string;
  onImported?: () => void; // called after successful non-dryRun import
  params?: Record<string, string | number | boolean | null | undefined>;
  preflight?: boolean; // when false, skip preflight and perform single-step upload
}) {
  const { t, i18n } = useTranslation(['common', 'ops']);
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
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
  // What the shown report says, when it is one of the sentences the dialog knows.
  const appliedDates = dateReadingOf(dateNotice);
  const appliedAmounts = amountReadingOf(amountNotice);
  const ignoredColumns = report?.ignoredColumns ?? [];
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
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" onTransitionExited={reset}>
      <DialogTitle>{titleProp || t('csv.importTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t('csv.uploadDescription')}
        </Typography>
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
          <Typography>{file ? file.name : t('csv.dragDropOrClick')}</Typography>
          <input type="file" ref={inputRef} onChange={onFileChange} hidden accept=".csv,text/csv" />
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
        {report && !completed && (dateNotice || amountNotice || ignoredColumns.length > 0) && (
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
          </Box>
        )}
        {report && (
          <Box sx={{ mt: 2 }}>
            {(report as any).ok ? (
              <Alert severity="success">
                {preflight ? (
                  (report as any).dryRun ? (
                    <>{t('csv.preflightOk', { total: (report as any).total, inserted: (report as any).inserted, updated: (report as any).updated })}</>
                  ) : (
                    <>{t('csv.loadedSuccessfully', { total: (report as any).processed ?? (report as any).total ?? '' })}</>
                  )
                ) : (
                  <>{t('csv.uploadCompleted')}</>
                )}
                {typeof report.unchanged === 'number' && (
                  <Box component="span" sx={{ display: 'block' }}>{t('csv.rowsUnchanged', { count: report.unchanged })}</Box>
                )}
              </Alert>
            ) : (
              <Alert severity="error">{t(refusedFileHeading(report.errors ?? []))}</Alert>
            )}
            {(report as any).errors && (report as any).errors.length > 0 && (
              <Box sx={{ mt: 1 }}>
                {(report as any).errors.slice(0, 5).map((err: any, i: number) => (
                  <Typography key={i} variant="body2">{t('csv.rowError', { row: err.row, message: err.message })}</Typography>
                ))}
                {(report as any).errors.length > 5 && (
                  <Typography variant="caption">{t('csv.andMoreErrors', { count: (report as any).errors.length - 5 })}</Typography>
                )}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('buttons.close')}</Button>
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
