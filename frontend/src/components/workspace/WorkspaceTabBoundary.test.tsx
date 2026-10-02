import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

import { WorkspaceTabBoundary, retryableLazy } from './WorkspaceTabBoundary';

function BudgetTabStandIn({ label }: { label: string }) {
  return <div>{label}</div>;
}

describe('WorkspaceTabBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // React reports the caught error on the console.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  it("a tab whose code fails to load shows a retry in its place, and the retry loads it again", async () => {
    let attempts = 0;
    const tab = retryableLazy(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Failed to fetch dynamically imported module: /assets/BudgetTab-old.js');
      return { default: BudgetTabStandIn };
    });
    const Tab = tab.Component;
    render(
      <div>
        <input aria-label="title" defaultValue="Typed before" />
        <WorkspaceTabBoundary resetKey="budget" onRetry={tab.retry}>
          <React.Suspense fallback={null}>
            <Tab label="Budget content" />
          </React.Suspense>
        </WorkspaceTabBoundary>
      </div>,
    );
    expect(await screen.findByText('messages.tabLoadFailed')).toBeInTheDocument();
    // The rest of the workspace stays as it was (no page reload).
    expect(screen.getByLabelText('title')).toHaveValue('Typed before');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'buttons.retry' })); });
    expect(await screen.findByText('Budget content')).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(screen.queryByText('messages.tabLoadFailed')).toBeNull();
  });

  it('another tab starts without the error', async () => {
    const broken = retryableLazy(async () => { throw new Error('Loading chunk 7 failed.'); });
    const Broken = broken.Component as unknown as React.ComponentType<{ label: string }>;
    const view = render(
      <WorkspaceTabBoundary resetKey="budget">
        <React.Suspense fallback={null}><Broken label="never" /></React.Suspense>
      </WorkspaceTabBoundary>,
    );
    expect(await screen.findByText('messages.tabLoadFailed')).toBeInTheDocument();
    view.rerender(
      <WorkspaceTabBoundary resetKey="relations">
        <div>Relations content</div>
      </WorkspaceTabBoundary>,
    );
    expect(screen.getByText('Relations content')).toBeInTheDocument();
  });

  it('a tab that loaded is never loaded again by a retry', async () => {
    let attempts = 0;
    const tab = retryableLazy(async () => {
      attempts += 1;
      return { default: BudgetTabStandIn };
    });
    const Tab = tab.Component;
    render(<React.Suspense fallback={null}><Tab label="Loaded" /></React.Suspense>);
    expect(await screen.findByText('Loaded')).toBeInTheDocument();
    tab.retry();
    expect(attempts).toBe(1);
  });
});
