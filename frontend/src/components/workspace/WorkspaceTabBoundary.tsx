import React from 'react';
import { Alert, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * A workspace tab whose code loads on demand (`retryableLazy`). React.lazy keeps a failed import
 * for good, so `retry()` swaps in a fresh one and the browser asks for the chunk again; a tab
 * that loaded is never reloaded.
 */
export function retryableLazy<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let failed = false;
  const tracked = () => load().catch((error: unknown) => {
    failed = true;
    throw error;
  });
  let lazy = React.lazy(tracked);
  const Component = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => React.createElement(lazy, { ...props, ref } as never));
  Component.displayName = 'RetryableLazy';
  return {
    Component: Component as unknown as T,
    /** Loads the code ahead of the tab (no error surfaces here: the tab shows it when opened). */
    preload: () => { void load().catch(() => undefined); },
    /** After a failed load: the next render loads the code again. */
    retry: () => {
      if (!failed) return;
      failed = false;
      lazy = React.lazy(tracked);
    },
  };
}

function TabLoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('common');
  return (
    <Alert
      severity="error"
      action={<Button color="inherit" size="small" onClick={onRetry}>{t('buttons.retry')}</Button>}
      sx={{ mt: 1 }}
    >
      {t('messages.tabLoadFailed')}
    </Alert>
  );
}

type Props = {
  children: React.ReactNode;
  /** Called before the tab renders again (e.g. `retryableLazy().retry`). */
  onRetry?: () => void;
  /** The tab shown: another tab starts without the error. */
  resetKey?: unknown;
};
type State = { error: Error | null };

/**
 * Around a workspace's tabs: a tab that cannot render (its code failed to load after a deploy, or
 * it crashed) shows a message and a retry button in its place. The rest of the workspace stays as
 * it is, with what the user typed; without it, the application's boundary reloads the whole page.
 */
export class WorkspaceTabBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Workspace tab failed', error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private retry = (): void => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) return <TabLoadFailed onRetry={this.retry} />;
    return this.props.children;
  }
}

export default WorkspaceTabBoundary;
