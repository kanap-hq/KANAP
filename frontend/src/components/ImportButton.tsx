import React from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Snackbar,
  Typography,
} from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { useTranslation } from 'react-i18next';
import type { ImportDocumentResult } from '../api/endpoints/import';
import { KanapDialog, useKanapDialogs } from './design';
import { getApiErrorMessage } from '../utils/apiErrorMessage';

interface ImportButtonProps {
  onImportFile: (file: File) => Promise<ImportDocumentResult>;
  onImported: (result: ImportDocumentResult) => void;
  onError?: (error: unknown) => void;
  onDialogStateChange?: (open: boolean) => void;
  hasContent?: boolean;
  disabled?: boolean;
  disabledTitle?: string;
  size?: 'small' | 'medium' | 'large';
  buttonVariant?: string;
}

const ACCEPTED_FILE_TYPES = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function getErrorMessage(error: unknown): string {
  const responseMessage = (error as any)?.response?.data?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage;
  }
  if (Array.isArray(responseMessage) && responseMessage.length > 0) {
    return responseMessage.join('\n');
  }
  const message = (error as any)?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  return 'Import failed. Please try again.'; // fallback - not translated as this is a module-level function
}

export default function ImportButton({
  onImportFile,
  onImported,
  onError,
  onDialogStateChange,
  hasContent = false,
  disabled = false,
  disabledTitle,
  size = 'small',
  buttonVariant = 'outlined',
}: ImportButtonProps) {
  const { t } = useTranslation('common');
  const dialogs = useKanapDialogs();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const focusCleanupRef = React.useRef<(() => void) | null>(null);
  const selectionHandledRef = React.useRef(false);
  const [importing, setImporting] = React.useState(false);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [warningText, setWarningText] = React.useState('');
  const [warningOpen, setWarningOpen] = React.useState(false);

  const clearDialogState = React.useCallback(() => {
    if (focusCleanupRef.current) {
      focusCleanupRef.current();
      focusCleanupRef.current = null;
    }
    onDialogStateChange?.(false);
  }, [onDialogStateChange]);

  React.useEffect(() => {
    return () => {
      clearDialogState();
    };
  }, [clearDialogState]);

  const runImport = React.useCallback(async (file: File) => {
    setImporting(true);
    try {
      const result = await onImportFile(file);
      onImported(result);
      if (result.warnings.length > 0) {
        setWarningText(result.warnings.join(' '));
        setWarningOpen(true);
      }
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        await dialogs.alert({ message: getApiErrorMessage(error, t, getErrorMessage(error)), intent: 'danger' });
      }
      // eslint-disable-next-line no-console
      console.error('Document import failed', error);
    } finally {
      setImporting(false);
      clearDialogState();
    }
  }, [clearDialogState, dialogs, onError, onImportFile, onImported]);

  const openPicker = React.useCallback(() => {
    if (disabled || importing) return;
    selectionHandledRef.current = false;
    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (selectionHandledRef.current) {
          return;
        }
        clearDialogState();
      }, 150);
    };
    focusCleanupRef.current = () => window.removeEventListener('focus', handleWindowFocus);
    window.addEventListener('focus', handleWindowFocus, { once: true });
    onDialogStateChange?.(true);
    inputRef.current?.click();
  }, [clearDialogState, disabled, importing, onDialogStateChange]);

  const handleFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    selectionHandledRef.current = true;
    if (focusCleanupRef.current) {
      focusCleanupRef.current();
      focusCleanupRef.current = null;
    }
    if (!file) {
      clearDialogState();
      return;
    }
    if (hasContent) {
      setPendingFile(file);
      return;
    }
    await runImport(file);
  }, [clearDialogState, hasContent, runImport]);

  const handleConfirmImport = React.useCallback(async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    await runImport(file);
  }, [pendingFile, runImport]);

  const handleCancelConfirm = React.useCallback(() => {
    setPendingFile(null);
    clearDialogState();
  }, [clearDialogState]);

  return (
    <>
      <span title={disabled ? (disabledTitle || '') : ''}>
        <Button
          size={size}
          variant={buttonVariant as any}
          disabled={disabled || importing}
          onClick={openPicker}
          startIcon={importing ? <CircularProgress size={14} /> : <UploadFileOutlinedIcon fontSize="small" />}
        >
          {importing ? t('status.importing') : t('import.button')}
        </Button>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        hidden
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      <KanapDialog
        open={!!pendingFile}
        title={t('import.replaceTitle')}
        onClose={handleCancelConfirm}
        onSave={() => { void handleConfirmImport(); }}
        saveLabel={t('buttons.continue')}
        cancelLabel={t('buttons.cancel')}
      >
        <Typography sx={{ fontSize: 13.5, color: 'kanap.text.primary' }}>
          {t('import.replaceDescription')}
        </Typography>
      </KanapDialog>
      <Snackbar
        open={warningOpen}
        autoHideDuration={8000}
        onClose={() => setWarningOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setWarningOpen(false)} sx={{ width: '100%' }}>
          {warningText}
        </Alert>
      </Snackbar>
    </>
  );
}
