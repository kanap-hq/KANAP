import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

  // The row's width decides, not the window's: beside a side navigation a window of 600px leaves
  // the title too little room, and the actions (the "…" menu) covered it.
  it('keeps room for the title and wraps the actions under it when the row is too narrow', () => {
    renderShell({ actions: <button type="button">More actions</button> });
    const titleColumn = screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement;
    const row = titleColumn.parentElement as HTMLElement;
    const actions = screen.getByRole('button', { name: 'More actions' }).parentElement as HTMLElement;

    expect(row).toHaveStyle({ display: 'flex', flexWrap: 'wrap' });
    expect(titleColumn).toHaveStyle({ flexGrow: '1', flexShrink: '1', flexBasis: '280px', minWidth: '0' });
    expect(actions.parentElement).toBe(row);
    expect(actions).toHaveStyle({ flexShrink: '0', maxWidth: '100%' });
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

describe('PortfolioDetailWorkspaceShell Escape', () => {
  it('goes back on a plain Escape', () => {
    const onBack = vi.fn();
    renderShell({ onBack });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a list, a menu or a dialog it comes from', () => {
    const onBack = vi.fn();
    renderShell({ onBack, properties: <ul role="listbox"><li role="option">Finance</li></ul> });
    fireEvent.keyDown(screen.getByRole('option'), { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('ignores an Escape that arrives on the body just after a field or list was used', () => {
    const onBack = vi.fn();
    renderShell({ onBack, properties: <ul role="listbox"><li role="option">Finance</li></ul> });
    fireEvent.pointerDown(screen.getByRole('option'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('keeps an empty title open with the message when one is given', () => {
    const onTitleSave = vi.fn();
    renderShell({ canEditTitle: true, onTitleSave, titleRequiredMessage: 'The name is required' });
    fireEvent.click(screen.getByText('Title'));
    const input = screen.getByDisplayValue('Title');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('The name is required');
    expect(screen.getByDisplayValue('')).toBeInTheDocument();
    expect(onTitleSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'New title' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTitleSave).toHaveBeenCalledWith('New title');
  });
});
