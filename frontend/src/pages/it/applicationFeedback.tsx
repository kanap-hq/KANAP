import React from 'react';
import { Alert, Button, Snackbar } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * What a part of the application workspace tells the person: a refusal (the page's error alert)
 * and a short message with an undo for a link that was just removed. Outside the page the calls
 * do nothing.
 */
export type ApplicationFeedback = {
  error: (message: string) => void;
  /** A short message with an "Undo" button; `onUndo` puts the removed link back. */
  undo: (message: string, onUndo: () => void | Promise<void>) => void;
  /** A short confirmation without action. */
  info: (message: string) => void;
};

const NOOP: ApplicationFeedback = { error: () => undefined, undo: () => undefined, info: () => undefined };

export const ApplicationFeedbackContext = React.createContext<ApplicationFeedback>(NOOP);

export function useApplicationFeedback() {
  return React.useContext(ApplicationFeedbackContext);
}

/**
 * Shows the undo snackbar when the page has none. A page that already provides one
 * (an asset, an application) keeps it, so a removed web link and an unlinked row share it.
 */
export function EnsureApplicationFeedback({ children }: { children: React.ReactNode }) {
  const current = React.useContext(ApplicationFeedbackContext);
  if (current !== NOOP) return children;
  return <ApplicationFeedbackProvider onError={() => undefined}>{children}</ApplicationFeedbackProvider>;
}

type Toast = { message: string; onUndo?: () => void | Promise<void> };

export function ApplicationFeedbackProvider({ onError, capture, children }: { onError: (message: string) => void; /** Lets the page itself (outside the provider's tree) use the same messages. */ capture?: React.MutableRefObject<ApplicationFeedback>; children: React.ReactNode }) {
  const { t } = useTranslation('it');
  const [toast, setToast] = React.useState<Toast | null>(null);
  const [open, setOpen] = React.useState(false);
  const show = React.useCallback((next: Toast) => { setToast(next); setOpen(true); }, []);
  const value = React.useMemo<ApplicationFeedback>(() => ({
    error: onError,
    undo: (message, onUndo) => show({ message, onUndo }),
    info: (message) => show({ message }),
  }), [onError, show]);

  if (capture) capture.current = value;

  return (
    <ApplicationFeedbackContext.Provider value={value}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={toast?.onUndo ? 8000 : 3000}
        onClose={(_, reason) => { if (reason !== 'clickaway') setOpen(false); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setOpen(false)}
          action={toast?.onUndo ? (
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                const undo = toast.onUndo;
                setOpen(false);
                void Promise.resolve(undo?.()).catch(() => undefined);
              }}
            >
              {t('workspace.application.undo.undo')}
            </Button>
          ) : undefined}
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </ApplicationFeedbackContext.Provider>
  );
}
