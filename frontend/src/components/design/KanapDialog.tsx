import React from 'react';
import { useTranslation } from 'react-i18next';
import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Button,
  type ButtonProps,
  CircularProgress,
  Dialog,
  IconButton,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export type KanapDialogProps = {
  open: boolean;
  title: string;
  /** Quiet line under the title (13px, secondary text). */
  subtitle?: React.ReactNode;
  onClose: () => void;
  /** Called once the dialog has finished closing. */
  onExited?: () => void;
  children: React.ReactNode;
  footerLeft?: React.ReactNode;
  /** Extra footer buttons, rendered between Cancel and the main action. */
  secondaryActions?: React.ReactNode;
  onSave: () => void | Promise<void>;
  saveLabel?: string;
  saveVariant?: ButtonProps['variant'];
  saveColor?: ButtonProps['color'];
  saveDisabled?: boolean;
  saveLoading?: boolean;
  /** The main action takes the focus when the dialog opens (its answer is the safe one). */
  saveAutoFocus?: boolean;
  /** Extra styles for the main action button, merged after the defaults. */
  saveSx?: SxProps<Theme>;
  /** Defaults to the localized "Cancel"; pass one only for a non-standard label. */
  cancelLabel?: string;
  showCancel?: boolean;
  sx?: SxProps<Theme>;
};

/** Inputs whose Enter means "submit the form" (implicit submission): one-line text entries. */
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/**
 * Enter submits the dialog only from a one-line text input, and only when nothing handled it
 * first. A select, a menu option (its portal bubbles to the form), an autocomplete choosing an
 * option, a button or a textarea keeps its own Enter.
 */
function isSubmitEnter(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' || event.shiftKey || event.defaultPrevented || event.nativeEvent.isComposing) return false;
  const target = event.target;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type);
}

export default function KanapDialog({
  open,
  title,
  subtitle,
  onClose,
  onExited,
  children,
  footerLeft,
  secondaryActions,
  onSave,
  saveLabel = 'Save',
  saveVariant = 'contained',
  saveColor = 'primary',
  saveDisabled = false,
  saveLoading = false,
  saveAutoFocus = false,
  saveSx,
  cancelLabel,
  showCancel = true,
  sx,
}: KanapDialogProps) {
  const { t } = useTranslation('common');
  const resolvedCancelLabel = cancelLabel ?? t('buttons.cancel');
  const handleSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveDisabled || saveLoading) return;
    void onSave();
  }, [onSave, saveDisabled, saveLoading]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={false}
      TransitionProps={onExited ? { onExited } : undefined}
      BackdropProps={{
        sx: (theme: Theme) => ({
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.65)' : 'rgba(15, 17, 23, 0.45)',
        }),
      }}
      PaperProps={{
        sx: [
          (theme: Theme) => ({
            width: '100%',
            maxWidth: 480,
            m: 2,
            bgcolor: theme.palette.kanap.bg.primary,
            borderRadius: '8px',
            border: `0.5px solid ${theme.palette.kanap.border.default}`,
            boxShadow: 'none',
            backgroundImage: 'none',
          }),
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ],
      }}
    >
      <Box
        component="form"
        onSubmit={handleSubmit}
        onKeyDown={(event: React.KeyboardEvent<HTMLFormElement>) => {
          if (isSubmitEnter(event)) {
            event.preventDefault();
            if (!saveDisabled && !saveLoading) void onSave();
          }
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
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              component="h2"
              sx={(theme) => ({
                fontSize: 16,
                fontWeight: 500,
                color: theme.palette.kanap.text.primary,
                m: 0,
              })}
            >
              {title}
            </Typography>
            {subtitle ? (
              <Typography
                sx={(theme) => ({
                  mt: '2px',
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: theme.palette.kanap.text.secondary,
                })}
              >
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          <IconButton aria-label="Close dialog" onClick={onClose} size="small">
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box sx={{ px: '20px', py: '18px' }}>
          {children}
        </Box>

        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: '20px',
            py: '14px',
            borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
          })}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {footerLeft}
          </Box>
          {showCancel ? (
            <Button variant="action" onClick={onClose}>
              {resolvedCancelLabel}
            </Button>
          ) : null}
          {secondaryActions}
          <Button
            type="submit"
            autoFocus={saveAutoFocus}
            variant={saveVariant}
            color={saveColor}
            disabled={saveDisabled || saveLoading}
            startIcon={saveLoading ? <CircularProgress color="inherit" size={14} /> : undefined}
            sx={[
              { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
              ...(Array.isArray(saveSx) ? saveSx : saveSx ? [saveSx] : []),
            ]}
          >
            {saveLabel}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
