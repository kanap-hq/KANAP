import React, { useEffect, useState } from 'react';
import { Alert, Dialog, DialogTitle, DialogContent, DialogActions, Button, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { withListContext } from '../../lib/listContext';
import type { ListRequest } from '../ServerDataGrid';
import { screenLanguage } from './readings';
import { csvRequestErrorMessage } from './csvRequestError';

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
}: {
  open: boolean;
  onClose: () => void;
  endpoint: string; // e.g. '/suppliers'
  title?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  /**
   * The master-data files: the separator, the decimal mark and the dates follow
   * the screen language. The files that keep the semicolon (contacts, contracts,
   * business processes, CoA templates) leave this off.
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
}) {
  const { t, i18n } = useTranslation('common');
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<'list' | 'all'>('list');
  useEffect(() => {
    if (open) setRows('list');
  }, [open]);
  const followsList = !!listRequest && !!entity;
  const title = followsList
    ? rows === 'list'
      ? t(`csv.exportRows.${entity}`, { count: listRequest!.total })
      : t(`csv.exportAllRows.${entity}`)
    : titleProp || t('csv.exportTitle');
  const download = async (scope: 'template' | 'data') => {
    setError(null);
    try {
      // The list's own parameters, long filters as a saved list context like the list's requests.
      const queryParams = followsList && rows === 'list'
        ? await withListContext(endpoint, { ...(params ?? {}), ...listRequest!.params, language, scope, rows: 'list' })
        : { ...(params ?? {}), language, scope };
      const res = await api.get(`${endpoint}/export`, { params: queryParams, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = (res.headers?.['content-disposition'] ?? res.headers?.['Content-Disposition']) as string | undefined;
      let filename = scope === 'template' ? 'template.csv' : 'data.csv';
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
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t(flexibleFormat ? 'csv.exportDescriptionFlexible' : 'csv.exportDescription')}
        </Typography>
        {note && <Typography variant="body2" sx={{ mb: 2 }}>{note}</Typography>}
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
        <Button variant="contained" onClick={() => download('data')}>{t('csv.exportData')}</Button>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('buttons.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
