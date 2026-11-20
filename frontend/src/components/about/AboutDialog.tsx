import React from 'react';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import AboutContent from './AboutContent';

export default function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['settings', 'common']);
  // The path question opened from the window outlives it: a picked path closes the window while
  // the question, or its confirmation, is still on screen.
  const [pathQuestion, setPathQuestion] = React.useState(false);

  return (
    <Dialog
      open={open}
      keepMounted={pathQuestion}
      onClose={onClose}
      fullWidth
      maxWidth={false}
      aria-labelledby="about-dialog-title"
      BackdropProps={{
        sx: (theme: Theme) => ({
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.65)' : 'rgba(15, 17, 23, 0.45)',
        }),
      }}
      PaperProps={{
        sx: (theme: Theme) => ({
          width: '100%',
          maxWidth: 480,
          m: 2,
          bgcolor: theme.palette.kanap.bg.primary,
          borderRadius: '8px',
          border: `0.5px solid ${theme.palette.kanap.border.default}`,
          boxShadow: 'none',
          backgroundImage: 'none',
        }),
      }}
    >
      <Box
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: '20px',
          py: '16px',
          borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
        })}
      >
        <Typography
          id="about-dialog-title"
          component="h2"
          sx={(theme) => ({ flex: 1, fontSize: 16, fontWeight: 500, color: theme.palette.kanap.text.primary, m: 0 })}
        >
          {t('settings:about.title')}
        </Typography>
        <IconButton aria-label={t('common:labels.closeDialog')} onClick={onClose} size="small">
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      <Box sx={{ px: '20px', py: '18px' }}>
        <AboutContent onNavigate={onClose} onPathQuestion={setPathQuestion} />
      </Box>
    </Dialog>
  );
}
