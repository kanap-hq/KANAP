import React from 'react';
import { useNotify } from '../../components/notify/NotifyProvider';

/**
 * What a part of the application workspace tells the person: a refusal (the page's error alert)
 * and a short message with an undo for a link that was just removed. Outside the page the calls
 * do nothing.
 */
export type ApplicationFeedback = {
  error: (message: string) => void;
  /** A short message with an "Undo" button; `onUndo` puts the removed link back. */
  undo: (message: string, onUndo: () => void | Promise<void>) => void;
  /** A short confirmation without action, for an effect the page itself does not show. */
  info: (message: string) => void;
};

const NOOP: ApplicationFeedback = { error: () => undefined, undo: () => undefined, info: () => undefined };

export const ApplicationFeedbackContext = React.createContext<ApplicationFeedback>(NOOP);

export function useApplicationFeedback() {
  return React.useContext(ApplicationFeedbackContext);
}

/**
 * Provides the undo notice when the page has none. A page that already provides one
 * (an asset, an application) keeps it, so a removed web link and an unlinked row share it.
 */
export function EnsureApplicationFeedback({ children }: { children: React.ReactNode }) {
  const current = React.useContext(ApplicationFeedbackContext);
  if (current !== NOOP) return children;
  return <ApplicationFeedbackProvider onError={() => undefined}>{children}</ApplicationFeedbackProvider>;
}

export function ApplicationFeedbackProvider({ onError, capture, children }: { onError: (message: string) => void; /** Lets the page itself (outside the provider's tree) use the same messages. */ capture?: React.MutableRefObject<ApplicationFeedback>; children: React.ReactNode }) {
  const notify = useNotify();
  const value = React.useMemo<ApplicationFeedback>(() => ({
    error: onError,
    undo: (message, onUndo) => notify({ message, undo: onUndo }),
    info: (message) => notify({ message, tone: 'info' }),
  }), [notify, onError]);

  if (capture) capture.current = value;

  return (
    <ApplicationFeedbackContext.Provider value={value}>
      {children}
    </ApplicationFeedbackContext.Provider>
  );
}
