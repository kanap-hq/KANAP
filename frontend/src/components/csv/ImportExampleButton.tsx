import React from 'react';
import { Button } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import { csvRequestErrorMessage } from './csvRequestError';
import { screenLanguage } from './readings';

/** The imports that have an example file (`GET /import-examples/<key>`). */
export type ImportExampleKey = 'applications' | 'assets' | 'portfolio-projects' | 'suppliers' | 'contracts' | 'budget-lines';

/**
 * Downloads the example workbook of an import, in the screen language: sample rows on the first
 * sheet, the other columns on a second one, and what each column accepts.
 */
export default function ImportExampleButton({ example, onError }: { example: ImportExampleKey; onError: (message: string | null) => void }) {
  const { t, i18n } = useTranslation('common');

  const download = async () => {
    onError(null);
    try {
      const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
      const res = await api.get(`/import-examples/${example}`, { params: { language }, responseType: 'blob' });
      const disposition = (res.headers?.['content-disposition'] ?? res.headers?.['Content-Disposition']) as string | undefined;
      downloadBlob(res.data as Blob, extractFilenameFromDisposition(disposition) ?? `${example}-example.xlsx`);
    } catch (e) {
      console.error('Example download failed', e);
      onError(await csvRequestErrorMessage(e, t, t('messages.exportFailed')));
    }
  };

  return (
    <Button variant="text" size="small" startIcon={<DownloadIcon />} onClick={download}>
      {t('csv.downloadExample')}
    </Button>
  );
}
