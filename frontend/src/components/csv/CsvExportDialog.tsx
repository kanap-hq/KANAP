import React, { useState } from 'react';
import { Alert, Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
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
  /** A sentence on what the file holds (the whole register, its order), under the description. */
  note?: string;
}) {
  const { t, i18n } = useTranslation('common');
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const [error, setError] = useState<string | null>(null);
  const download = async (scope: 'template' | 'data') => {
    setError(null);
    try {
      const queryParams = { ...(params ?? {}), language, scope };
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
      <DialogTitle>{titleProp || t('csv.exportTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t(flexibleFormat ? 'csv.exportDescriptionFlexible' : 'csv.exportDescription')}
        </Typography>
        {note && <Typography variant="body2" sx={{ mb: 2 }}>{note}</Typography>}
        <Button variant="contained" onClick={() => download('data')}>{t('csv.exportData')}</Button>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('buttons.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
