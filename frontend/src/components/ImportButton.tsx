import React from 'react';
import {
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { useTranslation } from 'react-i18next';
import type { ImportDocumentResult } from '../api/endpoints/import';
import { KanapDialog, useKanapDialogs } from './design';
import { useNotify } from './notify/NotifyProvider';
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
  const notify = useNotify();
  const dialogs = useKanapDialogs();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const focusCleanupRef = React.useRef<(() => void) | null>(null);
  const selectionHandledRef = React.useRef(false);
  const [importing, setImporting] = React.useState(false);
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);

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
      // The document itself changes on screen. A warning is the part that does not.
      if (result.warnings.length > 0) {
        notify({ message: result.warnings.join(' '), tone: 'info' });
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
  }, [clearDialogState, dialogs, notify, onError, onImportFile, onImported]);

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
    </>
  );
}
