import React, { useEffect, useState } from 'react';
import { Alert, Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { withListContext } from '../../lib/listContext';
import type { ListRequest } from '../ServerDataGrid';
import { screenLanguage } from './readings';
import { csvRequestErrorMessage } from './csvRequestError';
import { ExportFormat, readExportFormat, writeExportFormat } from './exportFormat';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The rows an export following the list can hold: the backend's `MAX_EXPORT_LIMIT`
 * (`backend/src/common/pagination.ts`). Past it, the dialog says the file stops there.
 */
export const EXPORT_ROW_LIMIT = 50_000;

export default function CsvExportDialog({
  open,
  onClose,
  endpoint,
  title: titleProp,
  params,
  flexibleFormat = false,
  note,
  listRequest,
  entity,
  csvOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  endpoint: string; // e.g. '/suppliers'
  title?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  /**
   * The master-data files: the separator, the decimal mark and the dates follow
   * the screen language. The files that keep the semicolon (CoA templates, the
   * IT and portfolio registers) leave this off.
   */
  flexibleFormat?: boolean;
  /** A sentence on what the file holds (its order, for example), under the description. */
  note?: string;
  /**
   * The list on screen (`ServerDataGrid` `onListRequestChange`): the file then holds what the list
   * shows by default (`rows=list`: its search, filters, Show scope and sort), or the whole register
   * on request, and the title counts the rows.
   */
  listRequest?: ListRequest | null;
  /** The rows the title names, a key of `csv.exportRows` (`suppliers`, `contracts`...). */
  entity?: string;
  /** A stored CSV file (a chart of accounts template): no format choice. */
  csvOnly?: boolean;
}) {
  const { t, i18n } = useTranslation(['common', 'ops']);
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<'list' | 'all'>('list');
  // CSV or Excel: the choice last made in any export dialog of this browser.
  const [chosenFormat, setChosenFormat] = useState<ExportFormat>(readExportFormat);
  useEffect(() => {
    if (open) {
      setRows('list');
      setChosenFormat(readExportFormat());
    }
  }, [open]);
  const format: ExportFormat = csvOnly ? 'csv' : chosenFormat;
  const chooseFormat = (next: ExportFormat) => {
    setChosenFormat(next);
    writeExportFormat(next);
  };
  const followsList = !!listRequest && !!entity;
  // The list shows nothing: nothing to export from it (the whole register stays possible).
  const listEmpty = followsList && rows === 'list' && listRequest!.total === 0;
  const title = followsList
    ? rows === 'list'
      ? listEmpty
        ? t(`csv.exportNoRows.${entity}`)
        : t(`csv.exportRows.${entity}`, { count: listRequest!.total })
      : t(`csv.exportAllRows.${entity}`)
    : titleProp || t(csvOnly ? 'csv.exportTitle' : 'export.button');
  const download = async (scope: 'template' | 'data') => {
    setError(null);
    try {
      // The list's own parameters, long filters as a saved list context like the list's requests.
      // An import template is a CSV file.
      const fileFormat: ExportFormat = scope === 'template' ? 'csv' : format;
      const formatParam = fileFormat === 'xlsx' ? { format: 'xlsx' } : {};
      const queryParams = followsList && rows === 'list'
        ? await withListContext(endpoint, { ...(params ?? {}), ...listRequest!.params, language, scope, rows: 'list', ...formatParam })
        : { ...(params ?? {}), language, scope, ...formatParam };
      const res = await api.get(`${endpoint}/export`, { params: queryParams, responseType: 'blob' });
      const blob = new Blob([res.data], { type: fileFormat === 'xlsx' ? XLSX_TYPE : 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = (res.headers?.['content-disposition'] ?? res.headers?.['Content-Disposition']) as string | undefined;
      let filename = scope === 'template' ? 'template.csv' : `data.${fileFormat}`;
      if (disposition) {
        const match = /filename="?([^"]+)"?/i.exec(disposition);
        if (match?.[1]) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      // The browser shows the download: the dialog has nothing left to say.
      onClose();
    } catch (e) {
      console.error('Export failed', e);
      setError(await csvRequestErrorMessage(e, t, t('messages.exportFailed')));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {format === 'csv' && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t(flexibleFormat ? 'csv.exportDescriptionFlexible' : 'csv.exportDescription')}
          </Typography>
        )}
        {note && <Typography variant="body2" sx={{ mb: 2 }}>{note}</Typography>}
        {followsList && rows === 'list' && listRequest!.total > EXPORT_ROW_LIMIT && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('csv.exportRowLimit', {
              limit: EXPORT_ROW_LIMIT.toLocaleString(i18n.resolvedLanguage || i18n.language),
              total: listRequest!.total.toLocaleString(i18n.resolvedLanguage || i18n.language),
            })}
          </Alert>
        )}
        {followsList && (
          <RadioGroup
            value={rows}
            onChange={(event) => setRows(event.target.value === 'all' ? 'all' : 'list')}
            sx={{ mb: 2 }}
          >
            <FormControlLabel value="list" control={<Radio size="small" />} label={t('csv.exportScopeList')} />
            <FormControlLabel value="all" control={<Radio size="small" />} label={t('csv.exportScopeAll')} />
          </RadioGroup>
        )}
        {!csvOnly && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>
              {t('ops:operations.budgetFile.format')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5 }}>
              {(['csv', 'xlsx'] as const).map((choice) => (
                <Box key={choice} component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer' }}>
                  <Radio
                    size="small"
                    checked={format === choice}
                    onChange={() => chooseFormat(choice)}
                    value={choice}
                    name="csv-export-format"
                    sx={{ p: 0.25 }}
                  />
                  <Typography component="span" sx={{ fontSize: 13, color: 'kanap.text.primary', lineHeight: 1.4 }}>
                    {t(choice === 'csv' ? 'ops:operations.budgetFile.formatCsv' : 'ops:operations.budgetFile.formatXlsx')}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
        <Button variant="contained" disabled={listEmpty} onClick={() => download('data')}>{t('csv.exportData')}</Button>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('buttons.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
