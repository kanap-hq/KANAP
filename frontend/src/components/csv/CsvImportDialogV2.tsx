import React, { useCallback, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Stack,
  Alert,
  LinearProgress,
  Collapse,
  Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useCsvImport } from './useCsvImport';
import { CsvImportWorkflowPresets } from './CsvImportWorkflowPresets';
import { CsvImportAdvancedOptions } from './CsvImportAdvancedOptions';
import { CsvValidationResults } from './CsvValidationResults';
import { CsvImportResult } from './csv.types';

interface CsvImportDialogV2Props {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  title?: string;
  onImported?: () => void;
  params?: Record<string, string | number | boolean | null | undefined>;
}

export default function CsvImportDialogV2({
  open,
  onClose,
  endpoint,
  title: titleProp,
  onImported,
  params,
}: CsvImportDialogV2Props) {
  const { t } = useTranslation('common');
  const {
    file,
    phase,
    result,
    loading,
    error,
    presetId,
    mode,
    operation,
    setFile,
    setPhase,
    setResult,
    setLoading,
    setError,
    selectPreset,
    setMode,
    setOperation,
    reset,
    goBack,
  } = useCsvImport();

  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = React.useState(false);

  const handleClose = useCallback(() => {
    onClose();
    // Reset after dialog closes
    setTimeout(reset, 300);
  }, [onClose, reset]);

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
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      const queryParams = { ...(params ?? {}), dryRun, mode, operation };
      const res = await api.post(`${endpoint}/import`, fd, { params: queryParams });
      const data = res.data as CsvImportResult;
      setResult(data);
      setPhase(dryRun ? 'validate' : 'result');

      if (!dryRun && data.ok) {
        onImported?.();
      }
    } catch (e: any) {
      console.error('Import failed', e);
      const errorMsg = e.response?.data?.message || e.message || 'Import failed';
      setError(errorMsg);
      setResult({
        ok: false,
        dryRun,
        total: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 0, message: errorMsg }],
        warnings: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const canValidate = !!file && !loading;
  const canImport = result?.ok && result?.dryRun && !loading;

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
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{titleProp || t('csv.importTitle')}</DialogTitle>
      <DialogContent>
        {phase === 'upload' && (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {t('csv.uploadDescriptionShort')}
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

            {/* File drop zone */}
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
                transition: 'border-color 0.2s',
              }}
              onClick={onPick}
            >
              <Typography>{file ? file.name : t('csv.dragDropOrClick')}</Typography>
              <input type="file" ref={inputRef} onChange={onFileChange} hidden accept=".csv,text/csv" />
            </Box>

            {/* Workflow presets */}
            <CsvImportWorkflowPresets
              selectedId={presetId}
              onSelect={selectPreset}
            />

            {/* Advanced options toggle */}
            <Button
              size="small"
              onClick={() => setShowAdvanced(!showAdvanced)}
              endIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ mt: 2, mb: 1 }}
            >
              {t('csv.advancedOptions')}
            </Button>

            <Collapse in={showAdvanced}>
              <CsvImportAdvancedOptions
                mode={mode}
                operation={operation}
                onModeChange={setMode}
                onOperationChange={setOperation}
              />
            </Collapse>
          </>
        )}

        {(phase === 'validate' || phase === 'result') && result && (
          <CsvValidationResults result={result} />
        )}

        {loading && <LinearProgress sx={{ mt: 2 }} />}

        {error && !result && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        {phase === 'upload' && (
          <>
            <Button variant="action" onClick={handleClose}>{t('buttons.cancel')}</Button>
            <Button
              variant="action-primary"
              onClick={() => upload(true)}
              disabled={!canValidate}
            >
              {t('buttons.validate')}
            </Button>
          </>
        )}

        {phase === 'validate' && (
          <>
            <Button variant="action" onClick={goBack}>{t('buttons.back')}</Button>
            <Button variant="action" onClick={handleClose}>Cancel</Button>
            <Button
              variant="action-primary"
              onClick={() => upload(false)}
              disabled={!canImport}
            >
              {t('buttons.import')}
            </Button>
          </>
        )}

        {phase === 'result' && (
          <Button variant="action" onClick={handleClose}>{t('buttons.close')}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
