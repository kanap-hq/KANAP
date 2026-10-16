import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const grid = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => {} } };
});
vi.mock('../../auth/AuthContext', () => {
  const auth = { hasLevel: () => true, profile: { id: 'u-1' } };
  return { useAuth: () => auth };
});
vi.mock('../../tenant/TenantContext', () => {
  const tenant = { tenantSlug: 'acme' };
  return { useTenant: () => tenant };
});
vi.mock('../../components/PageHeader', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: Object.assign([], { items: [] }) })), post: vi.fn() } }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: unknown) => {
    grid.calls.push(props);
    return null;
  },
}));

import ApplicationsPage from './ApplicationsPage';

const lastProps = () => grid.calls[grid.calls.length - 1] as {
  columns: Array<{ field?: string; cellRenderer?: React.FC<any> }>;
  extraParams: Record<string, unknown>;
  onGridApiReady: (api: unknown) => void;
  onColumnStateChange: (state: Array<{ colId: string; hide?: boolean }>) => void;
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ApplicationsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ApplicationsPage', () => {
  it('asks for the suites whenever the name cell shows them, the suites column hidden', () => {
    renderPage();
    // Before the grid reports its columns, the first request already carries them.
    expect(String(lastProps().extraParams.include ?? '').split(',')).toContain('structure');

    act(() => {
      lastProps().onGridApiReady({ getColumnState: () => [{ colId: 'name' }, { colId: 'suites_count', hide: true }, { colId: 'components_count', hide: true }] });
    });
    expect(String(lastProps().extraParams.include ?? '').split(',')).toContain('structure');

    act(() => {
      lastProps().onColumnStateChange([{ colId: 'name' }, { colId: 'lifecycle' }, { colId: 'suites_count', hide: true }]);
    });
    expect(String(lastProps().extraParams.include ?? '').split(',')).toContain('structure');
  });

  it('shows "Included in" in the name cell while the suites column is hidden', () => {
    renderPage();
    act(() => {
      lastProps().onColumnStateChange([{ colId: 'name' }, { colId: 'suites_count', hide: true }]);
    });
    const Cell = lastProps().columns.find((column) => column.field === 'name')!.cellRenderer!;
    render(
      <MemoryRouter>
        <Cell value="Payroll" data={{ id: 'a-1', name: 'Payroll', suites_count: 2, first_suite_name: 'HR suite' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/pages\.applications\.includedIn/).textContent).toContain('HR suite +1');
  });

  it('keeps the "Included in" chip on one line, cut with its full text on hover', () => {
    renderPage();
    act(() => {
      lastProps().onColumnStateChange([{ colId: 'name' }, { colId: 'suites_count', hide: true }]);
    });
    const Cell = lastProps().columns.find((column) => column.field === 'name')!.cellRenderer!;
    render(
      <MemoryRouter>
        <Cell value="Exchange Online" data={{ id: 'a-1', name: 'Exchange Online', suites_count: 1, first_suite_name: 'Microsoft 365' }} />
      </MemoryRouter>,
    );
    const chip = screen.getByText(/pages\.applications\.includedIn/);
    expect(chip).toHaveAttribute('title', 'pages.applications.includedIn Microsoft 365');
    const style = window.getComputedStyle(chip);
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
  });

  it('centres "No active environments" in the row like the environment pills', () => {
    renderPage();
    const Cell = lastProps().columns.find((column) => (column as { colId?: string }).colId === 'environments')!.cellRenderer!;
    render(
      <MemoryRouter>
        <Cell data={{ id: 'a-1', name: 'Payroll', instances: [] }} />
      </MemoryRouter>,
    );
    const container = screen.getByText('pages.applications.noActiveEnvironments').parentElement!;
    const style = window.getComputedStyle(container);
    expect(style.display).toBe('flex');
    expect(style.alignItems).toBe('center');
    expect(style.height).toBe('100%');
  });
});
