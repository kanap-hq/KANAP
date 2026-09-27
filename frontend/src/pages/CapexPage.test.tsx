import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
const grid = vi.fn();
vi.mock('../components/ServerDataGrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ServerDataGrid')>()),
  default: (props: unknown) => {
    grid(props);
    return null;
  },
}));

import api from '../api';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import CapexPage from './CapexPage';

type Col = {
  colId?: string;
  field?: string;
  defaultHidden?: boolean;
  filter?: unknown;
  floatingFilterComponent?: unknown;
  filterParams?: { getValues?: unknown };
  headerName?: string;
  valueGetter?: (p: unknown) => unknown;
  cellRenderer?: (p: unknown) => React.ReactElement;
};
type GridProps = { columns: Col[]; pinnedBottomRowData: Array<{ versions?: Record<string, { totals?: Record<string, number> }> }> };

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const lastProps = () => grid.mock.calls[grid.mock.calls.length - 1][0] as GridProps;
const column = (id: string) => lastProps().columns.find((c) => (c.colId ?? c.field) === id);

/** Renders the page and waits for the totals footer, the last state update of the first load. */
async function renderPage() {
  render(
    <MemoryRouter>
      <CapexPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
}

describe('CapexPage', () => {
  beforeEach(() => {
    grid.mockReset();
    get.mockReset();
    get.mockResolvedValue({ data: { yBudget: 10, yPlus2Forecast: 4, yMinus1Revision: 3, reportingCurrency: 'X' } });
  });

  it('offers every column of every list year, filtered with number models', async () => {
    await renderPage();
    const amounts = lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter');
    expect(amounts).toHaveLength(20);
    expect(amounts.filter((c) => !c.defaultHidden).map((c) => c.colId)).toEqual(['yBudget', 'yLanding']);
    expect(column('yPlus2Forecast')).toBeDefined();
    expect(column('yMinus1Revision')).toBeDefined();
  });

  it('has a contract column, a project column hidden by default, and a visible task column', async () => {
    await renderPage();
    expect(column('contract_name')?.headerName).toBe('capex.columns.contract');
    expect(column('contract_name')?.valueGetter?.({ data: { latest_contract_name: 'Support' } })).toBe('Support');
    expect(column('project_name')?.headerName).toBe('capex.columns.project');
    expect(column('project_name')?.defaultHidden).toBe(true);
    expect(column('latest_task_text')?.defaultHidden).toBeFalsy();
  });

  it('filters every date column with date models, from the menu and from the box under the header', async () => {
    await renderPage();
    for (const id of ['effective_start', 'disabled_at', 'created_at', 'updated_at']) {
      expect(column(id)).toMatchObject({ filter: 'agDateColumnFilter', floatingFilterComponent: 'agDateColumnFloatingFilter' });
    }
  });

  it('filters the allocation column with the values the server lists', async () => {
    await renderPage();
    const allocation = column('allocation_label');
    expect(allocation?.filter).toBe(CheckboxSetFilter);
    expect(allocation?.filterParams?.getValues).toBeTypeOf('function');
  });

  it('filters the status column with a checkbox list of the two statuses', async () => {
    await renderPage();
    const status = column('status') as Col & { filterParams?: { values?: unknown; searchable?: boolean } };
    expect(status.filter).toBe(CheckboxSetFilter);
    expect(status.floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    expect(status.filterParams).toMatchObject({
      values: [
        { value: 'enabled', label: 'common:statuses.enabled' },
        { value: 'disabled', label: 'common:statuses.disabled' },
      ],
      searchable: false,
    });
  });

  it('links the contract cell to the contract and an amount cell to the budget of its year', async () => {
    await renderPage();
    const hrefOf = (id: string, data: Record<string, unknown>) => {
      const el = column(id)!.cellRenderer!({ data, value: '', colDef: {} });
      return (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    };
    const row = { id: 'c-1', item_number: 7, latest_contract_id: 'k-1' };
    expect(hrefOf('contract_name', row)).toBe('/ops/contracts/k-1/overview');
    const Y = new Date().getFullYear();
    expect(hrefOf('yPlus1Forecast', row)).toMatch(new RegExp(`^/ops/capex/CPX-7/budget\\?.*year=${Y + 1}`));
  });

  it('fills the footer from the totals keys of the same name', async () => {
    await renderPage();
    const versions = lastProps().pinnedBottomRowData[0].versions!;
    expect(versions.yPlus2.totals?.forecast).toBe(4);
    expect(versions.yMinus1.totals?.revision).toBe(3);
    expect(versions.y.totals?.budget).toBe(10);
  });
});
