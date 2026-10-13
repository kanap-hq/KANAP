import React from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import KanapDialog from './KanapDialog';

type DialogIntent = 'default' | 'danger';

type SharedDialogOptions = {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: DialogIntent;
};

export type KanapAlertOptions = Omit<SharedDialogOptions, 'cancelLabel'>;
export type KanapConfirmOptions = SharedDialogOptions;
export type KanapPromptOptions = {
  title?: string;
  message?: React.ReactNode;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
  intent?: DialogIntent;
  validate?: (value: string) => string | null | undefined;
};

type DialogRequest =
  | {
      type: 'alert';
      options: KanapAlertOptions;
      resolve: () => void;
    }
  | {
      type: 'confirm';
      options: KanapConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      type: 'prompt';
      options: KanapPromptOptions;
      resolve: (value: string | null) => void;
    };

type KanapDialogApi = {
  alert: (options: KanapAlertOptions | string) => Promise<void>;
  confirm: (options: KanapConfirmOptions | string) => Promise<boolean>;
  prompt: (options: KanapPromptOptions | string) => Promise<string | null>;
};

const KanapDialogContext = React.createContext<KanapDialogApi | null>(null);

function normalizeAlertOptions(options: KanapAlertOptions | string): KanapAlertOptions {
  return typeof options === 'string' ? { message: options } : options;
}

function normalizeConfirmOptions(options: KanapConfirmOptions | string): KanapConfirmOptions {
  return typeof options === 'string' ? { message: options } : options;
}

function normalizePromptOptions(options: KanapPromptOptions | string): KanapPromptOptions {
  return typeof options === 'string' ? { title: options } : options;
}

function DialogMessage({ children }: { children: React.ReactNode }) {
  if (children == null || children === '') return null;
  if (typeof children === 'string') {
    return (
      <Typography sx={(theme) => ({ whiteSpace: 'pre-line', fontSize: 13, color: theme.palette.kanap.text.secondary })}>
        {children}
      </Typography>
    );
  }
  return <Box sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>{children}</Box>;
}

export function KanapDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common');
  const [active, setActive] = React.useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = React.useState('');
  const [promptError, setPromptError] = React.useState<string | null>(null);
  const activeRef = React.useRef<DialogRequest | null>(null);
  const queueRef = React.useRef<DialogRequest[]>([]);

  React.useEffect(() => {
    activeRef.current = active;
    if (active?.type === 'prompt') {
      setPromptValue(active.options.initialValue ?? '');
      setPromptError(null);
    }
  }, [active]);

  const enqueue = React.useCallback((request: DialogRequest) => {
    if (activeRef.current) {
      queueRef.current.push(request);
      return;
    }
    activeRef.current = request;
    setActive(request);
  }, []);

  const showNext = React.useCallback(() => {
    const [next, ...rest] = queueRef.current;
    queueRef.current = rest;
    activeRef.current = next ?? null;
    setActive(next ?? null);
  }, []);

  const api = React.useMemo<KanapDialogApi>(() => ({
    alert(options) {
      return new Promise<void>((resolve) => {
        enqueue({ type: 'alert', options: normalizeAlertOptions(options), resolve });
      });
    },
    confirm(options) {
      return new Promise<boolean>((resolve) => {
        enqueue({ type: 'confirm', options: normalizeConfirmOptions(options), resolve });
      });
    },
    prompt(options) {
      return new Promise<string | null>((resolve) => {
        enqueue({ type: 'prompt', options: normalizePromptOptions(options), resolve });
      });
    },
  }), [enqueue]);

  const handleClose = React.useCallback(() => {
    if (!activeRef.current) return;
    const current = activeRef.current;
    if (current.type === 'alert') current.resolve();
    if (current.type === 'confirm') current.resolve(false);
    if (current.type === 'prompt') current.resolve(null);
    showNext();
  }, [showNext]);

  const handleSave = React.useCallback(() => {
    if (!activeRef.current) return;
    const current = activeRef.current;
    if (current.type === 'alert') {
      current.resolve();
      showNext();
      return;
    }
    if (current.type === 'confirm') {
      current.resolve(true);
      showNext();
      return;
    }
    const validationError = current.options.required && promptValue.trim().length === 0
      ? t('systemDialogs.valueRequired')
      : current.options.validate?.(promptValue);
    if (validationError) {
      setPromptError(validationError);
      return;
    }
    current.resolve(promptValue);
    showNext();
  }, [promptValue, showNext, t]);

  const title = active?.type === 'alert'
    ? active.options.title ?? t('systemDialogs.noticeTitle')
    : active?.type === 'confirm'
      ? active.options.title ?? t('systemDialogs.confirmTitle')
      : active?.options.title ?? t('systemDialogs.promptTitle');
  const intent = active?.options.intent ?? 'default';

  return (
    <KanapDialogContext.Provider value={api}>
      {children}
      {active ? (
        <KanapDialog
          open
          title={title}
          onClose={handleClose}
          onSave={handleSave}
          showCancel={active.type !== 'alert'}
          cancelLabel={active.type === 'alert' ? t('buttons.cancel') : active.options.cancelLabel ?? t('buttons.cancel')}
          saveLabel={
            active.options.confirmLabel
            ?? (active.type === 'alert' ? t('buttons.close') : t('buttons.continue'))
          }
          saveVariant={active.type === 'confirm' && intent === 'danger' ? 'action-danger' : 'action-primary'}
        >
          {active.type === 'prompt' ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              {active.options.message ? <DialogMessage>{active.options.message}</DialogMessage> : null}
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={promptValue}
                placeholder={active.options.placeholder}
                error={!!promptError}
                helperText={promptError}
                onChange={(event) => {
                  setPromptValue(event.target.value);
                  setPromptError(null);
                }}
              />
            </Box>
          ) : (
            <DialogMessage>{active.options.message}</DialogMessage>
          )}
        </KanapDialog>
      ) : null}
    </KanapDialogContext.Provider>
  );
}

export function useKanapDialogs() {
  const context = React.useContext(KanapDialogContext);
  if (!context) {
    throw new Error('useKanapDialogs must be used inside KanapDialogProvider');
  }
  return context;
}
