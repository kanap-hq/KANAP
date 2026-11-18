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
  Divider,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import { csvEntityOf, csvFieldLabel } from './csvLabels';
import { screenLanguage } from './readings';
import api from '../../api';
import { useCsvImport } from './useCsvImport';
import { csvRequestErrorMessage } from './csvRequestError';
import { CsvImportWorkflowPresets } from './CsvImportWorkflowPresets';
import { CsvValidationResults } from './CsvValidationResults';
import type { CsvImportResult, ImportLookalike, ImportLookalikeChoice } from './csv.types';
import { useImportFiles } from './importFiles';
import ImportExampleButton, { type ImportExampleKey } from './ImportExampleButton';
import ImportMatchesView, { type UndoneMatch } from './ImportMatchesView';
import ImportLookalikesView, { applicationLookalikeReason, applicationUpdateChoice } from './ImportLookalikesView';
import { buildEntityUrl } from '../../ai/utils/entityUrls';
import { importFollowsClearingRule } from './clearingRule';
import InfoHint from '../workspace/InfoHint';

/** A load refused for a row whose situation changed since the check: nothing was written (T-I3l). */
const LOAD_REFUSALS = new Set(['CSV_LOOKALIKE_CHANGED', 'CSV_LOOKALIKE_GONE', 'CSV_LOOKALIKE_NAME_FOUND', 'CSV_LOOKALIKE_NEW']);

interface CsvImportDialogV2Props {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  title?: string;
  onImported?: () => void;
  params?: Record<string, string | number | boolean | null | undefined>;
  /** The import's example file, offered next to the template. */
  example?: ImportExampleKey;
}

export default function CsvImportDialogV2({
  open,
  onClose,
  endpoint,
  title: titleProp,
  onImported,
  params,
  example,
}: CsvImportDialogV2Props) {
  const { t, i18n } = useTranslation('common');
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const { accept, workbook } = useImportFiles();
  const {
    file,
    phase,
    result,
    loading,
    error,
    presetId,
    operation,
    setFile,
    setPhase,
    setResult,
    setLoading,
    setError,
    selectPreset,
    reset,
    goBack,
  } = useCsvImport();

  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = React.useState(false);
  // The matches the person undid on the check (lot I3 of 26.11.9): the next check and the load send them,
  // and the check lists them with their way back, as they were found.
  const [unmatched, setUnmatched] = React.useState<UndoneMatch[]>([]);
  // The person's last choices on the rows that look like an existing record (the applications), for a
  // check that gave none back; a check that did gives the list the next check and the load send.
  const [lookalikes, setLookalikes] = React.useState<ImportLookalikeChoice[]>([]);
  // The matches stay unfolded while the file is checked again after an undo.
  const [matchesOpen, setMatchesOpen] = React.useState(false);
  const entity = csvEntityOf(endpoint);
  const columnName = (column: string) => csvFieldLabel(t, entity, { csvColumn: column, label: column });

  const handleClose = useCallback(() => {
    onClose();
    // Reset after dialog closes
    setTimeout(() => {
      reset();
      setUnmatched([]);
      setLookalikes([]);
      setMatchesOpen(false);
    }, 300);
  }, [onClose, reset]);

  const chooseFile = (next: File | null | undefined) => {
    if (!next) return;
    // The report, the error, the matches undone and the rows' choices were about the previous file.
    setResult(null);
    setError(null);
    setUnmatched([]);
    setLookalikes([]);
    setMatchesOpen(false);
    setFile(next);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(false);
    chooseFile(e.dataTransfer.files?.[0]);
  };

  const onPick = () => inputRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    chooseFile(e.target.files?.[0]);
  };

  /** `next` carries the choice just made (a match undone, a row's choice), before the state has caught up. */
  const upload = async (
    dryRun: boolean,
    next: { undone?: UndoneMatch[]; chosen?: ImportLookalikeChoice[] } = {},
  ) => {
    const undone = next.undone ?? unmatched;
    // The choices of the check shown, as it gave them back, the targets of the rows it left out included:
    // a row left out stays left out even when its application was renamed since (as the budget file's load).
    const chosen = next.chosen ?? result?.lookalikes?.choices ?? lookalikes;
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      // In the form, never in the address: they hold values of the file.
      if (undone.length > 0) fd.append('unmatched', JSON.stringify(undone.map(({ column, value }) => ({ column, value }))));
      if (chosen.length > 0) fd.append('lookalikes', JSON.stringify(chosen));
      const queryParams = { ...(params ?? {}), dryRun, operation, language };
      const res = await api.post(`${endpoint}/import`, fd, { params: queryParams });
      const data = res.data as CsvImportResult;
      setResult(data);
      // A load refused because a row's situation changed since the check (T-I3l) wrote nothing: back to
      // the check, the row in error and its choices open, as the budget file's dialog does.
      const refused = !data.ok && data.errors.some((entry) => !!entry.code && LOAD_REFUSALS.has(entry.code));
      const stale = !dryRun && refused;
      // The choices the server followed dropped the refused row's: the next check shows its new situation
      // (an update of the application that took its name, a row left out), never the same refusal (T-I3l).
      if (refused) setLookalikes(data.lookalikes?.choices ?? []);
      setPhase(dryRun || stale ? 'validate' : 'result');

      if (!dryRun && data.ok) {
        onImported?.();
      }
    } catch (e) {
      // The request itself failed (a refused file, a server error): its message replaces the report.
      console.error('Import failed', e);
      setError(await csvRequestErrorMessage(e, t, t('messages.importFailed')));
    } finally {
      setLoading(false);
    }
  };

  const undo = (entry: UndoneMatch) => {
    const next = [...unmatched, { column: entry.column, value: entry.value, name: entry.name, origin: entry.origin }];
    setUnmatched(next);
    void upload(true, { undone: next });
  };

  const redo = (entry: UndoneMatch) => {
    const next = unmatched.filter((item) => !(item.column === entry.column && item.value === entry.value));
    setUnmatched(next);
    void upload(true, { undone: next });
  };

  const chooseLookalikes = (next: ImportLookalikeChoice[]) => {
    setLookalikes(next);
    void upload(true, { chosen: next });
  };

  const canValidate = !!file && !loading;
  const canImport = result?.ok && result?.dryRun && !loading;
  // Choices are made on the check: a dry run, or a load refused and brought back to it (it wrote nothing).
  const choosing = phase === 'validate';

  const downloadTemplate = async () => {
    setError(null);
    try {
      // The template follows the screen, as the export does.
      const queryParams = { ...(params ?? {}), scope: 'template', language };
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
      setError(await csvRequestErrorMessage(e, t, t('messages.exportFailed')));
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {titleProp || t(workbook ? 'buttons.import' : 'csv.importTitle')}
        {importFollowsClearingRule(endpoint) && <InfoHint text={t('csv.clearingRule')} />}
      </DialogTitle>
      <DialogContent>
        {phase === 'upload' && (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {t(workbook ? 'csv.uploadDescriptionFlexibleWorkbook' : 'csv.uploadDescriptionFlexible')}
            </Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, mb: 2 }}>
              <Button
                variant="text"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={downloadTemplate}
              >
                {t('csv.downloadTemplate')}
              </Button>
              {example && <ImportExampleButton example={example} onError={setError} />}
            </Box>
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
              <Typography sx={{ textTransform: 'none', overflowWrap: 'anywhere' }}>{file ? file.name : t(workbook ? 'csv.dragDropFileOrClick' : 'csv.dragDropOrClick')}</Typography>
              <input type="file" ref={inputRef} onChange={onFileChange} hidden accept={accept} />
            </Box>

            {/* Workflow presets: each sets the operation. */}
            <CsvImportWorkflowPresets
              selectedId={presetId}
              onSelect={selectPreset}
            />
          </>
        )}

        {(phase === 'validate' || phase === 'result') && result && (
          <>
            <CsvValidationResults result={result} entity={entity} />
            {/* Under the warnings: the names found beyond case, undone on the check only. */}
            {((result.matches?.length ?? 0) > 0 || (result.refusedProposals?.length ?? 0) > 0 || (choosing && unmatched.length > 0)) && (
              <Box sx={{ mt: 2 }}>
                <ImportMatchesView
                  matches={result.matches ?? []}
                  matchesTotal={result.matchesTotal}
                  refusedProposals={result.refusedProposals ?? []}
                  refusedTotal={result.refusedProposalsTotal}
                  columnName={columnName}
                  open={matchesOpen}
                  onToggle={() => setMatchesOpen((open) => !open)}
                  onUndo={choosing ? undo : undefined}
                  undone={unmatched}
                  onRedo={choosing ? redo : undefined}
                  disabled={loading}
                />
              </Box>
            )}
            {/* Under the matches: the rows that look like an existing record, chosen on the check only. */}
            {result.lookalikes && result.lookalikes.count > 0 && (
              <Box sx={{ mt: 2 }}>
                <ImportLookalikesView<ImportLookalike, ImportLookalikeChoice>
                  lookalikes={result.lookalikes}
                  title={t('ops:operations.budgetFile.lookalikes.applicationsTitle')}
                  choices={result.lookalikes.choices ?? lookalikes}
                  updateChoice={applicationUpdateChoice}
                  onChoices={choosing ? chooseLookalikes : undefined}
                  choicesDisabled={loading}
                  reasonText={(look) => applicationLookalikeReason(look, t)}
                  targetUrl={(look) => buildEntityUrl(entity, look.target.ref)}
                  fieldName={columnName}
                  changedLines={new Set(result.errors.filter((error) => error.code === 'CSV_LOOKALIKE_CHANGED').map((error) => error.row))}
                  refusedLines={new Set(result.errors.map((error) => error.row))}
                />
              </Box>
            )}
          </>
        )}

        {loading && <LinearProgress sx={{ mt: 2 }} />}

        {error && (
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
            <Button variant="action" onClick={handleClose}>{t('buttons.cancel')}</Button>
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
