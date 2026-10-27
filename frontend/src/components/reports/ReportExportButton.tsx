import React, { useState } from 'react';
import { IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { drawerMenuItemSx } from '../../theme/formSx';
import { downloadBlob, extractFilenameFromDisposition } from '../../utils/downloadBlob';
import { ExportFormat, readExportFormat, writeExportFormat } from '../csv/exportFormat';
import { screenLanguage } from '../csv/readings';

/**
 * The table export of a report: the server builds the file (`GET <url>?format=csv|xlsx&language=…`,
 * common/report-export on the API) from the same parameters as the screen. The icon opens a compact
 * menu: CSV (one item per table when the report has several and none is chosen on the screen) or
 * Excel, the format last chosen in this browser highlighted. Every request carries `tz`: the screen's
 * when it sends one, else the browser's zone.
 */
export type ReportTableExport = {
  /** The export route, `/portfolio/reports/time-logged/export`. */
  url: string;
  /** The screen's parameters, as the data route takes them. Empty values are not sent. */
  params: Record<string, string | number | null | undefined>;
  /** Several tables: CSV holds one, picked here (`table=<key>`); the workbook holds them all. */
  tables?: ReadonlyArray<{ key: string; label: string }>;
  /** The name of the file when the server gives none. */
  fileBase: string;
};

export default function ReportExportButton({
  url,
  params,
  tables,
  fileBase,
  disabled = false,
}: ReportTableExport & { disabled?: boolean }) {
  const { t, i18n } = useTranslation(['ops']);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [remembered, setRemembered] = useState<ExportFormat>(readExportFormat);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);

  const open = (event: React.MouseEvent<HTMLElement>) => {
    setRemembered(readExportFormat());
    setAnchor(event.currentTarget);
  };

  const download = async (format: ExportFormat, table?: string) => {
    setAnchor(null);
    writeExportFormat(format);
    setRemembered(format);
    setFailed(false);
    setRunning(true);
    try {
      const query: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') query[key] = value;
      }
      query.format = format;
      query.language = screenLanguage(i18n.resolvedLanguage || i18n.language);
      // The Parameters sheet dates the file in the user's zone: the browser's, unless the screen sent one.
      if (query.tz === undefined) {
        const zone = browserTimeZone();
        if (zone) query.tz = zone;
      }
      if (table) query.table = table;
      const res = await api.get<Blob>(url, { params: query, responseType: 'blob' });
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      const disposition = (headers['content-disposition'] ?? headers['Content-Disposition']) as string | undefined;
      const name = extractFilenameFromDisposition(disposition) || `${fileBase}.${format}`;
      downloadBlob(res.data instanceof Blob ? res.data : new Blob([res.data]), name);
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  };

  const csvItems = tables && tables.length > 1
    ? tables.map((table) => ({ key: `csv-${table.key}`, label: t('reports.shared.exportCsvTable', { table: table.label }), run: () => download('csv', table.key) }))
    : [{ key: 'csv', label: t('reports.shared.exportCsv'), run: () => download('csv') }];

  return (
    <>
      {failed && (
        <Typography role="alert" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
          {t('reports.shared.exportFailed')}
        </Typography>
      )}
      <Tooltip title={t('reports.shared.exportTable')}>
        <span>
          <IconButton
            size="small"
            onClick={open}
            disabled={disabled || running}
            aria-label={t('reports.shared.exportTable')}
            aria-haspopup="menu"
            sx={{ color: 'kanap.text.secondary' }}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {csvItems.map((item) => (
          <MenuItem key={item.key} sx={drawerMenuItemSx} selected={remembered === 'csv' && item === csvItems[0]} onClick={() => void item.run()}>
            {item.label}
          </MenuItem>
        ))}
        <MenuItem sx={drawerMenuItemSx} selected={remembered === 'xlsx'} onClick={() => void download('xlsx')}>
          {t('reports.shared.exportXlsx')}
        </MenuItem>
      </Menu>
    </>
  );
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
