import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// The projects and requests lists own their default status filter (Done / Converted unchecked): every
// request they make says `status: 'all'`, so that clearing the filter ("All") shows every status.

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const exportDialog = vi.hoisted(() => ({ params: null as null | Record<string, unknown> }));
const filterValuesGet = vi.hoisted(() => vi.fn(async () => ({ data: {} })));

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }),
}));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: {} })) } }));
vi.mock('../../hooks/useGridScopePreference', () => ({ useGridScopePreference: () => ['all', () => undefined] }));
vi.mock('../../hooks/useListContextSearch', () => ({ useUrlFilterModel: () => ({ model: null, ready: true }) }));
vi.mock('../../lib/listContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/listContext')>()),
  getWithListContext: filterValuesGet,
}));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, unknown>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../../components/PageHeader', () => ({
  default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}));
vi.mock('../../components/csv', () => ({
  CsvExportDialogV2: ({ params }: { params: Record<string, unknown> }) => {
    exportDialog.params = params;
    return null;
  },
  CsvImportDialogV2: () => null,
}));

import ProjectsPage from './ProjectsPage';
import RequestsPage from './RequestsPage';

function renderPage(page: React.ReactElement) {
  grid.props = null;
  exportDialog.params = null;
  filterValuesGet.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>{page}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The filters of the address a row's link opens, once the list has asked for `filterModel`. */
function recordLinkFilters(filterModel: Record<string, unknown>) {
  const { onQueryStateChange, columns } = grid.props as Record<string, any>;
  onQueryStateChange({ sort: 'name:ASC', q: '', filterModel });
  const name = (columns as Array<Record<string, any>>).find((c) => c.field === 'name')!;
  const { container } = render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>{name.cellRenderer({ data: { id: 'row-1', item_number: 1, name: 'One' }, value: 'One' })}</MemoryRouter>
    </ThemeProvider>,
  );
  const href = within(container).getByRole('link', { name: 'One' }).getAttribute('href')!;
  const filters = new URLSearchParams(href.split('?')[1]).get('filters');
  return filters ? JSON.parse(filters) : null;
}

describe.each([
  { name: 'projects', page: <ProjectsPage />, endpoint: '/portfolio/projects/filter-values', hidden: 'done' },
  { name: 'requests', page: <RequestsPage />, endpoint: '/portfolio/requests/filter-values', hidden: 'converted' },
])('$name list and its statuses', ({ page, endpoint, hidden }) => {
  it('opens with the default status filter, and asks the server for every status', () => {
    renderPage(page);
    const status = grid.props?.defaultFilterModel?.status;
    expect(status.values).not.toContain(hidden);
    expect(grid.props?.extraParams).toMatchObject({ status: 'all' });
  });

  it('asks the column filter values for every status', async () => {
    renderPage(page);
    const column = (grid.props?.columns as Array<Record<string, any>>).find((c) => c.field === 'status')!;
    const extraParams = grid.props?.extraParams;
    await column.filterParams.getValues({ context: { getQueryState: () => ({ filters: {}, extraParams }) } });
    expect(filterValuesGet).toHaveBeenCalledWith(endpoint, expect.objectContaining({ status: 'all' }));
  });

  it('opens a record with the status filter cleared, so that the list comes back on "All"', () => {
    renderPage(page);
    expect(recordLinkFilters({})).toEqual({ status: null });
  });

  it('opens a record with the status filter the person chose', () => {
    renderPage(page);
    const status = { filterType: 'set', values: [hidden] };
    expect(recordLinkFilters({ status })).toEqual({ status });
  });

  it('exports the rows of the list with every status when the filter is cleared', () => {
    renderPage(page);
    const { onListRequestChange, extraParams } = grid.props as Record<string, any>;
    onListRequestChange({ params: { ...extraParams, sort: 'name:ASC', page: 1, limit: 50 }, total: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'common:export.button' }));
    expect(exportDialog.params).toMatchObject({ status: 'all', rows: 'list' });
    expect(exportDialog.params).not.toHaveProperty('include');
  });
});
