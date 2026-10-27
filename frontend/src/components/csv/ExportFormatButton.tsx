import React, { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { drawerMenuItemSx } from '../../theme/formSx';
import { ExportFormat, readExportFormat, writeExportFormat } from './exportFormat';

/**
 * The export action of a page whose file the server builds (`…/export?format=csv|xlsx`): the page's
 * own button, which opens a compact menu, CSV or Excel, the format last chosen in this browser
 * highlighted (`exportFormat.ts`, shared with the export dialogs and the report menus). The page
 * sends the request with its own parameters in `onExport`.
 */
export default function ExportFormatButton({
  label,
  onExport,
  disabled = false,
  size,
}: {
  label: string;
  onExport: (format: ExportFormat) => void | Promise<void>;
  disabled?: boolean;
  size?: 'small' | 'medium';
}) {
  const { t } = useTranslation(['ops']);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [remembered, setRemembered] = useState<ExportFormat>(readExportFormat);

  const open = (event: React.MouseEvent<HTMLElement>) => {
    setRemembered(readExportFormat());
    setAnchor(event.currentTarget);
  };

  const choose = (format: ExportFormat) => {
    setAnchor(null);
    writeExportFormat(format);
    setRemembered(format);
    void onExport(format);
  };

  return (
    <>
      <Button variant="action" size={size} onClick={open} disabled={disabled} aria-haspopup="menu" aria-expanded={!!anchor}>
        {label}
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem sx={drawerMenuItemSx} selected={remembered === 'csv'} onClick={() => choose('csv')}>
          {t('ops:reports.shared.exportCsv')}
        </MenuItem>
        <MenuItem sx={drawerMenuItemSx} selected={remembered === 'xlsx'} onClick={() => choose('xlsx')}>
          {t('ops:reports.shared.exportXlsx')}
        </MenuItem>
      </Menu>
    </>
  );
}
