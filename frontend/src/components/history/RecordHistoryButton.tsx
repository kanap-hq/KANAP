import React from 'react';
import { Box, Drawer, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import { useTranslation } from 'react-i18next';
import RecordHistory from './RecordHistory';

export type RecordHistoryButtonProps = {
  table: string;
  recordId: string;
};

/**
 * The History action of a record page without a tab row: an icon button in the header opens the
 * common record history in a right panel under the 48px application bar. Mounted only while open;
 * Escape closes it and gives the focus back to the button. The shell (`PortfolioDetailWorkspaceShell`)
 * and the pages that draw their own header (a business process) share it.
 */
export function RecordHistoryButton({ table, recordId }: RecordHistoryButtonProps) {
  const { t } = useTranslation(['admin', 'common']);
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const title = t('admin:auditLogs.history.title');

  // The shell also closes its panel on Escape, before the page's shortcut reads that key. The
  // panel is not inside the shell any more: close it here, in the capture phase, and stop the
  // press there so a page's own Escape (going back) never sees it.
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  return (
    <>
      <Tooltip title={title}>
        <IconButton
          ref={buttonRef}
          size="small"
          aria-label={title}
          onClick={() => setOpen(true)}
          sx={(theme) => ({
            color: theme.palette.kanap.text.secondary,
            '&:hover': { color: theme.palette.kanap.text.primary, bgcolor: theme.palette.kanap.tab.bgHover },
          })}
        >
          <HistoryIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        ModalProps={{ keepMounted: false, disableRestoreFocus: true }}
        // The modal would put the focus on the page body once it closes; the keyboard continues
        // where the panel opened.
        SlideProps={{ onExited: () => buttonRef.current?.focus() }}
        PaperProps={{
          // Under the 48px application bar, as the other right panels of the app.
          sx: (theme) => ({
            top: 48,
            height: 'calc(100dvh - 48px)',
            width: { xs: '100%', sm: 480 },
            maxWidth: '100vw',
            bgcolor: theme.palette.kanap.bg.drawer,
            borderLeft: `1px solid ${theme.palette.kanap.border.default}`,
            display: 'flex',
            flexDirection: 'column',
          }),
        }}
      >
        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 2,
            py: '10px',
            borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
            flexShrink: 0,
          })}
        >
          <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>
            {title}
          </Typography>
          <IconButton
            size="small"
            aria-label={t('common:buttons.close')}
            onClick={() => setOpen(false)}
            sx={{ color: 'kanap.text.secondary' }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1 }}>
          {open && <RecordHistory table={table} recordId={recordId} />}
        </Box>
      </Drawer>
    </>
  );
}

export default RecordHistoryButton;
