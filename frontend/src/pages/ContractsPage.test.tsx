import React from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));

import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import ContractsPage from './ContractsPage';

type Col = {
  field?: string;
  colId?: string;
  filter?: unknown;
  floatingFilterComponent?: unknown;
  filterParams?: { values?: unknown };
  valueFormatter?: (params: { value?: unknown }) => string;
  cellRenderer?: (params: any) => React.ReactElement;
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/ops/contracts']}>
      <ContractsPage />
    </MemoryRouter>,
  );
}

const columns = () => grid.props?.columns as Col[];
const column = (field: string) => columns().find((c) => c.field === field || c.colId === field)!;

describe('ContractsPage', () => {
  beforeEach(() => {
    grid.props = null;
  });

  it('shows a status column with a checkbox filter and translated cells', () => {
    renderPage();
    const status = column('status');
    expect(status.filter).toBe(CheckboxSetFilter);
    expect(status.floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    expect(status.filterParams?.values).toEqual([
      { value: 'enabled', label: 'common:statuses.enabled' },
      { value: 'disabled', label: 'common:statuses.disabled' },
    ]);
    expect(status.valueFormatter?.({ value: 'disabled' })).toBe('common:statuses.disabled');
  });

  it('lists active contracts by default and offers the other scopes', () => {
    renderPage();
    expect(grid.props?.statusScopeConfig).toEqual({ defaultScope: 'enabled' });
  });

  it('carries the grid scope into the workspace link, so prev/next walks the same contracts', () => {
    renderPage();
    act(() => {
      grid.props?.onQueryStateChange({ sort: 'name:ASC', q: '', filterModel: {}, statusScope: 'all' });
    });
    const { container } = render(
      <MemoryRouter>
        {column('name').cellRenderer!({ value: 'Expired contract', data: { id: 'c-1', name: 'Expired contract' } })}
      </MemoryRouter>,
    );
    const href = container.querySelector('a')?.getAttribute('href') ?? '';
    expect(href.startsWith('/ops/contracts/c-1/overview?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('scope')).toBe('all');
    expect(params.get('sort')).toBe('name:ASC');
  });
});
