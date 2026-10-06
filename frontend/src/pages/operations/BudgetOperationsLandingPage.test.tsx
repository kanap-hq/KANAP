import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../components/PageHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));
const auth = vi.hoisted(() => ({
  grants: {} as Record<string, string>,
  rank: { reader: 1, member: 3, admin: 4 } as Record<string, number>,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (auth.rank[auth.grants[resource]] ?? 0) >= auth.rank[level],
  }),
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

const BUDGET_ADMIN = { opex: 'admin', capex: 'admin', budget_ops: 'admin' };
const BUDGET_MEMBER = { opex: 'member', capex: 'member', budget_ops: 'reader', companies: 'reader', departments: 'member' };

describe('BudgetOperationsLandingPage', () => {
  beforeEach(() => {
    auth.grants = {};
  });

  it('shows every tile to a budget administrator, in two titled sections', () => {
    auth.grants = BUDGET_ADMIN;
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

  it('shows no tile to a budget member', () => {
    auth.grants = BUDGET_MEMBER;
    renderPage();

    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('shows the item operations only to a CAPEX administrator, and hides the empty settings section', () => {
    auth.grants = { opex: 'reader', capex: 'admin' };
    renderPage();

    expect(screen.queryByRole('region', { name: 'operations.sections.settings' })).not.toBeInTheDocument();
    expect(hrefs(section('operations.sections.operations'))).toEqual([
      '/ops/operations/copy-budget-columns',
      '/ops/operations/copy-allocations',
      '/ops/operations/column-reset',
    ]);
  });

  it('shows the master data tiles to a departments administrator with budget access', () => {
    auth.grants = { ...BUDGET_MEMBER, departments: 'admin' };
    renderPage();

    expect(hrefs(section('operations.sections.operations'))).toEqual([
      '/ops/operations/master-data-freeze',
      '/ops/operations/metrics-copy',
    ]);
  });

  it('shows no tile without any right', () => {
    renderPage();

    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });
});
