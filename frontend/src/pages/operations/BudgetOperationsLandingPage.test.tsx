import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../components/PageHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));
const auth = vi.hoisted(() => ({ readable: new Set<string>() }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => auth.readable.has(resource) }),
}));

import BudgetOperationsLandingPage from './BudgetOperationsLandingPage';

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <BudgetOperationsLandingPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const section = (name: string) => screen.getByRole('region', { name });
const hrefs = (region: HTMLElement) => within(region).getAllByRole('link').map((link) => link.getAttribute('href'));

describe('BudgetOperationsLandingPage', () => {
  beforeEach(() => {
    auth.readable = new Set();
  });

  it('shows the settings and the operations in two titled sections', () => {
    auth.readable = new Set(['opex']);
    renderPage();

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'operations.sections.settings',
      'operations.sections.operations',
    ]);
    expect(hrefs(section('operations.sections.settings'))).toEqual([
      '/ops/operations/currency',
      '/ops/operations/columns',
      '/ops/operations/allocation-default',
    ]);
    expect(hrefs(section('operations.sections.operations'))).toEqual([
      '/ops/operations/freeze',
      '/ops/operations/copy-budget-columns',
      '/ops/operations/copy-allocations',
      '/ops/operations/column-reset',
      '/ops/operations/master-data-freeze',
      '/ops/operations/metrics-copy',
    ]);
    expect(screen.getByRole('link', { name: /operations\.cards\.currencyTitle/ })).toHaveAttribute('href', '/ops/operations/currency');
  });

  it('hides a section when none of its tiles is permitted', () => {
    // A CAPEX reader may open the currencies only: the operations section goes away.
    auth.readable = new Set(['capex']);
    renderPage();

    expect(hrefs(section('operations.sections.settings'))).toEqual(['/ops/operations/currency']);
    expect(screen.queryByRole('region', { name: 'operations.sections.operations' })).not.toBeInTheDocument();
    expect(screen.queryByText('operations.sections.operations')).not.toBeInTheDocument();
  });

  it('shows the currency tile to a budget reader', () => {
    auth.readable = new Set(['budget_ops']);
    renderPage();

    expect(hrefs(section('operations.sections.settings'))).toEqual(['/ops/operations/currency']);
  });

  it('shows no section without any right', () => {
    renderPage();

    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });
});
