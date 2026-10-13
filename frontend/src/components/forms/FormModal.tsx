import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

type FormModalProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  formId?: string;
  disableSave?: boolean;
  saving?: boolean;
  fullWidth?: boolean;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
  actions?: React.ReactNode;
};

/**
 * @deprecated Use FormModal instead of FormDrawer for centered modal dialogs.
 * FormModal renders a centered modal with overlay, accessibility, and footer actions.
 *
 * API is kept close to FormDrawer to minimize migration effort.
 */
export default function FormModal({
  title,
  open,
  onClose,
  children,
  formId,
  disableSave,
  saving,
  fullWidth = true,
  maxWidth = 'sm',
  actions,
}: FormModalProps) {
  const titleId = 'form-modal-title';
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // Ignore if Alt is pressed; allow Ctrl/Cmd+Enter from textareas
    const isCtrlOrMeta = (e.ctrlKey || e.metaKey);
    const target = e.target as HTMLElement | null;
    const isTextArea = target?.tagName === 'TEXTAREA' || target?.getAttribute('contenteditable') === 'true';
    // If an options popup is open (Autocomplete/Menu), do not submit on plain Enter
    const menuOpen = !!(document.querySelector('.MuiAutocomplete-popper[role="presentation"]') || document.querySelector('.MuiMenu-paper'));
    if (!isCtrlOrMeta && (isTextArea || menuOpen)) {
      return; // let Enter insert newline or select option
    }
    if (isCtrlOrMeta && isTextArea) {
      // Ctrl/Cmd+Enter submits from multiline fields
      e.preventDefault();
      if (formId) (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
      return;
    }
    // Plain Enter anywhere else triggers submit
    if (!e.shiftKey && !e.altKey) {
      // Avoid double-submit if focus is on a button of type=button? We still rely on form semantics.
      if (formId) {
        e.preventDefault();
        (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
      }
    }
  }, [formId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      fullWidth={fullWidth}
      maxWidth={maxWidth}
      onKeyDown={handleKeyDown}
    >
      <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
        <Typography variant="h6" component="div" sx={{ flex: 1 }}>
          {title}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ pt: 2 }}>
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        {actions ? (
          actions
        ) : (
          <>
            <Button variant="action" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              form={formId}
              variant="action-primary"
              disabled={!!disableSave || !!saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
