import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Stack, Alert, LinearProgress, Divider } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

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
};

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
  const { t } = useTranslation('common');
  const [file, setFile] = useState<File | null>(null);
  const [hover, setHover] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  // The request itself failed: the server's message, shown instead of a report.
  const [requestError, setRequestError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setReport(null);
    setRequestError(null);
    setLoading(false);
    setHover(false);
  }, []);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const onPick = () => inputRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f) setFile(f);
  };

  const upload = async (dryRun: boolean) => {
    if (!file) return;
    setLoading(true);
    setReport(null);
    setRequestError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const queryParams = { ...(params ?? {}), dryRun };
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

  const canLoad = useMemo(() => !!report && (report as any).ok && (report as any).dryRun, [report]);

  const downloadTemplate = async () => {
    try {
      const queryParams = { ...(params ?? {}), scope: 'template' };
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
