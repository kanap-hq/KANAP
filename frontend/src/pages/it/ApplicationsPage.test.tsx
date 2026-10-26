import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const grid = vi.hoisted(() => ({ calls: [] as any[] }));
const features = vi.hoisted(() => ({ vulnerabilityFeed: false, isLoading: false }));
const auth = vi.hoisted(() => ({ write: true }));

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => {} } };
});
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_area: string, level: string) => level === 'reader' || auth.write,
    profile: { id: 'u-1' },
  }),
}));
vi.mock('../../tenant/TenantContext', () => {
  const tenant = { tenantSlug: 'acme' };
  return { useTenant: () => tenant };
});
vi.mock('../../components/PageHeader', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: Object.assign([], { items: [] }) })), post: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { features: { vulnerabilityFeed: features.vulnerabilityFeed } }, isLoading: features.isLoading }),
}));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: unknown) => {
    grid.calls.push(props);
    return null;
  },
}));

import ApplicationsPage from './ApplicationsPage';

const lastProps = () => grid.calls[grid.calls.length - 1] as {
  columns: Array<{ field?: string; cellRenderer?: React.FC<any>; sortable?: boolean; filterParams?: any }>;
  extraParams: Record<string, unknown>;
  initialState?: { filter?: { filterModel?: Record<string, unknown> } };
  onGridApiReady: (api: unknown) => void;
  onColumnStateChange: (state: Array<{ colId: string; hide?: boolean }>) => void;
};

function renderPage(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/it/applications${search}`]}><ApplicationsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const includeFlags = () => String(lastProps().extraParams.include ?? '').split(',');

describe('ApplicationsPage', () => {
  beforeEach(() => {
    grid.calls = [];
    features.vulnerabilityFeed = false;
    features.isLoading = false;
    auth.write = true;
  });

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
    // One quiet line under the name (the suite), cut with its full text on hover.
    const chip = screen.getByText(/pages\.applications\.includedIn/).parentElement!;
    expect(chip).toHaveAttribute('title', 'pages.applications.includedIn Microsoft 365');
    const style = window.getComputedStyle(chip);
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
  });

  it('leaves the category to its own column: the name cell names only the suite, or nothing else', () => {
    renderPage();
    act(() => {
      lastProps().onColumnStateChange([{ colId: 'name' }, { colId: 'suites_count', hide: true }]);
    });
    const Cell = lastProps().columns.find((column) => column.field === 'name')!.cellRenderer!;
    const { container } = render(
      <MemoryRouter>
        <Cell value="Exchange Online" data={{ id: 'a-1', name: 'Exchange Online', category: 'productivity', suites_count: 1, first_suite_name: 'Microsoft 365' }} />
        <Cell value="Payroll" data={{ id: 'a-2', name: 'Payroll', category: 'lob', suites_count: 0, first_suite_name: null }} />
      </MemoryRouter>,
    );
    const included = screen.getByText(/pages\.applications\.includedIn/).parentElement!;
    expect(included.textContent).toBe('pages.applications.includedIn Microsoft 365');
    expect(container.textContent).not.toMatch(/productivity|lob|·/i);
    // The application outside any suite: its name alone, one line.
    const payroll = screen.getByText('Payroll').parentElement!;
    expect(payroll.children).toHaveLength(1);
  });

  it('shows one dash for an empty value, and explains the derived users column', () => {
    renderPage();
    const columns = lastProps().columns as Array<{ field?: string; headerName?: string; headerTooltip?: string; cellRenderer?: React.ComponentType<any>; valueFormatter?: (p: any) => string }>;
    const derived = columns.find((column) => column.field === 'derived_total_users')!;
    expect(derived.headerName).toBe('pages.applications.columns.derivedUsers');
    expect(derived.headerTooltip).toBe('pages.applications.columns.derivedUsersHelp');
    for (const field of ['cyber_criticality', 'recovery_wave', 'classification_reviewed_at']) {
      expect(columns.find((column) => column.field === field)!.valueFormatter!({ value: null }), field).toBe('');
    }
    const Cell = columns.find((column) => column.field === 'cyber_criticality')!.cellRenderer!;
    render(
      <MemoryRouter>
        <Cell value={null} valueFormatted="" data={{ id: 'a-1', name: 'Payroll' }} colDef={{}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
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

  it('keeps an obsolete deployment in the environment pills, greyed and struck through, and hides a retired one', () => {
    renderPage();
    const Cell = lastProps().columns.find((column) => (column as { colId?: string }).colId === 'environments')!.cellRenderer!;
    render(
      <MemoryRouter>
        <Cell
          data={{
            id: 'a-1',
            name: 'Payroll',
            instances: [
              { environment: 'qa', lifecycle: 'deprecated' },
              { environment: 'prod', lifecycle: 'active' },
              { environment: 'dev', lifecycle: 'retired' },
            ],
          }}
        />
      </MemoryRouter>,
    );
    const pills = screen.getAllByText(/^pages\.applications\.environments\..*\.short$/).map((node) => node.textContent);
    expect(pills).toEqual(['pages.applications.environments.prod.short', 'pages.applications.environments.qa.short']);
    const qa = screen.getByText('pages.applications.environments.qa.short').closest('a')!;
    expect(qa.getAttribute('aria-label')).toContain('pages.applications.environments.qa.name');
    // The label is a span inside the link: the grid resets the colour and decoration of every link in a cell.
    const qaLabel = screen.getByText('pages.applications.environments.qa.short');
    const prodLabel = screen.getByText('pages.applications.environments.prod.short');
    // The test theme has no `kanap` palette, so the grey is not checked here; the strike-through is.
    expect(window.getComputedStyle(qaLabel).textDecoration).toContain('line-through');
    expect(window.getComputedStyle(prodLabel).textDecoration).not.toContain('line-through');
  });

  it('shows the vulnerabilities to review after the name while the feed is on, linked to the filtered page', async () => {
    features.vulnerabilityFeed = true;
    renderPage();
    const fields = lastProps().columns.map((column) => column.field);
    expect(fields.slice(0, 3)).toEqual(['sequential_id', 'name', 'vulnerabilities_to_review']);
    const column = lastProps().columns[2];
    expect(column.sortable).not.toBe(false);
    expect(await column.filterParams.getValues()).toEqual([
      { value: 'severe', label: 'pages.technologies.vulnerabilityFilter.severe' },
      { value: 'any', label: 'pages.technologies.vulnerabilityFilter.any' },
      { value: 'none', label: 'pages.technologies.vulnerabilityFilter.none' },
    ]);
    const Cell = column.cellRenderer!;
    const { unmount } = render(<MemoryRouter><Cell data={{ id: 'a-1', sequential_id: 'APP-7', vulnerabilities_to_review: 4, vulnerabilities_severe: 1 }} /></MemoryRouter>);
    expect(screen.getByTestId('vulnerabilities-to-review').getAttribute('href')).toBe('/it/vulnerabilities?application=APP-7');
    expect(screen.getByTestId('vulnerabilities-to-review').textContent).toBe('4 · 1');
    unmount();
    // Out of service (null): an empty cell.
    const { container } = render(<MemoryRouter><Cell data={{ id: 'a-2', sequential_id: 'APP-8', vulnerabilities_to_review: null, vulnerabilities_severe: null }} /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });

  it('asks for the counts only while the column shows', () => {
    features.vulnerabilityFeed = true;
    renderPage();
    act(() => {
      lastProps().onColumnStateChange([{ colId: 'name' }, { colId: 'vulnerabilities_to_review' }]);
    });
    expect(includeFlags()).toContain('vulnerabilities');
    act(() => {
      lastProps().onColumnStateChange([{ colId: 'name' }, { colId: 'vulnerabilities_to_review', hide: true }]);
    });
    expect(includeFlags()).not.toContain('vulnerabilities');
  });

  it('pre-applies ?vulnerabilities= and ?criticality= from the address', () => {
    features.vulnerabilityFeed = true;
    renderPage('?vulnerabilities=severe&criticality=business_critical');
    expect(lastProps().initialState?.filter?.filterModel).toEqual({
      vulnerabilities_to_review: { filterType: 'set', values: ['severe'] },
      criticality: { filterType: 'set', values: ['business_critical'] },
    });
    grid.calls = [];
    renderPage('?vulnerabilities=other');
    expect(lastProps().initialState?.filter?.filterModel?.vulnerabilities_to_review).toBeUndefined();
  });

  it('waits for the features before a vulnerabilities filter, and has no column with the feed off', () => {
    features.isLoading = true;
    renderPage('?vulnerabilities=any');
    expect(grid.calls).toHaveLength(0);
    renderPage('?criticality=high');
    expect(grid.calls.length).toBeGreaterThan(0);
    expect(lastProps().columns.map((column) => column.field)).not.toContain('vulnerabilities_to_review');
  });

  it('says the list is empty in one line, with the creation for someone who may create', () => {
    renderPage();
    const emptyState = (lastProps() as { emptyState?: React.ReactElement }).emptyState;
    render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
    expect(screen.getByTestId('applications-empty').textContent).toContain('pages.applications.empty');
    expect(screen.getByRole('button', { name: 'pages.applications.newAppService' })).toBeInTheDocument();
  });

  it('leaves the creation out of the empty list for a reader', () => {
    auth.write = false;
    renderPage();
    const emptyState = (lastProps() as { emptyState?: React.ReactElement }).emptyState;
    render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
    expect(screen.getByTestId('applications-empty').textContent).toBe('pages.applications.empty');
    expect(screen.queryByRole('button', { name: 'pages.applications.newAppService' })).toBeNull();
  });
});
