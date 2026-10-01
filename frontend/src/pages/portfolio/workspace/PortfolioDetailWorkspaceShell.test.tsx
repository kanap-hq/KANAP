import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

import PortfolioDetailWorkspaceShell from './PortfolioDetailWorkspaceShell';

function renderShell(extra: Partial<React.ComponentProps<typeof PortfolioDetailWorkspaceShell>> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: 'Overview' }]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.test.drawerOpen"
        backLabel="Back"
        onBack={() => undefined}
        title="Title"
        titleFallback="Untitled"
        {...extra}
      >
        <div>content</div>
      </PortfolioDetailWorkspaceShell>
    </ThemeProvider>,
  );
}

describe('PortfolioDetailWorkspaceShell', () => {
  it('draws the Properties tab and drawer when properties are given', () => {
    renderShell({ properties: <div>drawer fields</div> });
    expect(screen.getByRole('button', { name: 'workspace.closeProperties' })).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveTextContent('drawer fields');
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('draws neither the tab nor the drawer without properties', () => {
    renderShell({ isCreate: true });
    expect(screen.queryByRole('button', { name: /workspace\.(open|close)Properties/ })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  // The drawer and its tab rise beside the tab row; with a single tab there is no tab row and they
  // would cover the title row and its actions (the Delete button).
  it('lifts the drawer and its tab beside the tab row when there is one', () => {
    renderShell({
      tabs: [{ key: 'overview', label: 'Overview' }, { key: 'budget', label: 'Budget' }],
      properties: <div>drawer fields</div>,
    });
    expect(screen.getByRole('tab', { name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveStyle({ marginTop: '-48px', height: 'calc(100% + 48px)' });
    expect(screen.getByRole('button', { name: 'workspace.closeProperties' })).toHaveStyle({ top: '-48px' });
  });

  it('starts the drawer and its tab at the content top without a tab row', () => {
    renderShell({ properties: <div>drawer fields</div>, actions: <button type="button">Delete</button> });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('complementary')).toHaveStyle({ marginTop: '0px', height: 'calc(100% + 0px)' });
    expect(screen.getByRole('button', { name: 'workspace.closeProperties' })).toHaveStyle({ top: '0px' });
  });
});

// Every breakpoint query answers `matches`: true renders the below-md (mobile) branch.
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function contentColumn() {
  const column = screen.getByText('content').parentElement as HTMLElement;
  return { column, body: column.parentElement as HTMLElement };
}

describe('PortfolioDetailWorkspaceShell scrolling', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('on desktop, the content column is the bounded scroller Layout focuses', () => {
    stubMatchMedia(false);
    renderShell({ properties: <div>drawer fields</div> });
    const { column, body } = contentColumn();

    expect(column).toHaveAttribute('data-primary-scroll');
    expect(column).toHaveAttribute('tabindex', '-1');
    expect(getComputedStyle(column).overflow).toBe('auto');
    expect(getComputedStyle(body).flexDirection).toBe('row');
  });

  it('below md, content and properties take their natural height and the page scrolls', () => {
    stubMatchMedia(true);
    renderShell({ properties: <div>drawer fields</div> });
    const { column, body } = contentColumn();

    expect(column).not.toHaveAttribute('data-primary-scroll');
    expect(column).not.toHaveAttribute('tabindex');
    expect(getComputedStyle(column).overflow).toBe('visible');
    expect(getComputedStyle(column).flex).toMatch(/^none|^0 0 auto/);
    expect(getComputedStyle(body).overflow).toBe('visible');
    expect(getComputedStyle(body).flexDirection).toBe('column');
    // Below md the properties are forced open and stack under the content.
    expect(body).toContainElement(screen.getByRole('complementary'));
  });
});
