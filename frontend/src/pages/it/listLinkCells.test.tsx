import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coversItsCell, staysAboveCellLink } from '../../components/grid/renderers/wholeCellLink.testUtils';

// Every custom link cell of the IT lists covers its whole grid cell, as LinkCellRenderer does: a
// click in the empty part of the cell opens the row. A second link in the same cell (the suite
// chip of an application) stays above that area and keeps its own target.

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key, language: 'en' }, resolveSupportedLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u1' } }) }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 't' }) }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: [] })), post: vi.fn() } }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: { businessCriticalityLevels: [] } }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: new Proxy({}, { get: () => [] }), labelFor: (_field: string, code: string) => code }),
}));
const grid = vi.fn();
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: unknown) => {
    grid(props);
    return null;
  },
}));

import ApplicationsPage from './ApplicationsPage';
import AssetsPage from './AssetsPage';
import IncidentsPage from './IncidentsPage';
import InterfacesPage from './InterfacesPage';

type Col = { field?: string; colId?: string; cellRenderer?: unknown; cellStyle?: unknown };

const ROW: Record<string, unknown> = {
  id: 'r1', item_number: 7, name: 'Okta', title: 'Outage', category: 'business', environment: 'prod',
  severity: 'high', status: 'open', cluster: 'Cluster A', is_cluster: false,
  suites_count: 2, first_suite_name: 'Suite', first_suite_ref: 'APP-1', components_count: 1, first_component_name: 'Part',
  owners: ['Ann'], it_owners: ['Ann'], business_owners: ['Bob'], data_residency: ['FR'],
  spend_count: 2, spend_first_name: 'Line', capex_count: 1, capex_first_description: 'Capex', contracts_count: 1, contracts_first_name: 'Contract',
  binding_environments: ['prod', 'test'], interface_reference: 'INT-1',
};

function cellsOf(page: React.ReactElement): Array<{ key: string; Cell: React.FC<any> }> {
  grid.mockClear();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
  const props = grid.mock.calls[grid.mock.calls.length - 1][0] as { columns: Col[] };
  cleanup();
  return props.columns
    .filter((col) => typeof col.cellRenderer === 'function')
    .map((col) => ({ key: String(col.field ?? col.colId), Cell: col.cellRenderer as React.FC<any> }));
}

/** Renders each link cell in an `.ag-cell` and checks its links. `except`: cells with several links of equal rank. */
function expectWholeCellLinks(page: React.ReactElement, except: string[] = []) {
  const failures: string[] = [];
  let checked = 0;
  for (const { key, Cell } of cellsOf(page)) {
    if (except.includes(key)) continue;
    const draw = (value: unknown) => render(
      <MemoryRouter>
        <div className="ag-cell">
          <Cell value={value} valueFormatted={null} data={ROW} colDef={{ field: key }} />
        </div>
      </MemoryRouter>,
    );
    let drawn: ReturnType<typeof draw>;
    try {
      drawn = draw(ROW[key] ?? 'Okta');
    } catch {
      // A list cell (owners, residency) reads an array.
      cleanup();
      drawn = draw(['Okta', 'OVHcloud']);
    }
    const { container, unmount } = drawn;
    const links = Array.from(container.querySelectorAll('a'));
    if (links.length > 0) {
      checked += 1;
      if (!coversItsCell(links[0])) failures.push(`${key}: the link does not cover the cell`);
      for (const other of links.slice(1)) {
        if (!staysAboveCellLink(other)) failures.push(`${key}: a second link is under the cell link`);
      }
    }
    unmount();
  }
  expect(failures).toEqual([]);
  expect(checked).toBeGreaterThan(0);
}

describe('IT list link cells', () => {
  // A cell drawn with the wrong value shape throws once before the retry: keep the log quiet.
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('applications: the name, owners, residency, relations and structure cells cover their cell', () => {
    // The environments cell holds one pill per environment, each its own link: no single target.
    expectWholeCellLinks(<ApplicationsPage />, ['environments']);
  });

  it('applications: the environments cell is no link outside its pills', () => {
    grid.mockClear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><ApplicationsPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    const columns = (grid.mock.calls[grid.mock.calls.length - 1][0] as { columns: Col[] }).columns;
    cleanup();
    const col = columns.find((c) => c.colId === 'environments') as Col;
    // The row rule gives every cell a pointer: this cell takes it back, only its pills keep it.
    expect(col.cellStyle).toMatchObject({ cursor: 'default' });
    const Cell = col.cellRenderer as React.FC<any>;
    const row = { ...ROW, instances: [{ environment: 'prod', status: 'enabled' }, { environment: 'test', status: 'enabled' }] };
    const { container } = render(
      <MemoryRouter>
        <div className="ag-cell"><Cell value={null} data={row} colDef={{ colId: 'environments' }} /></div>
      </MemoryRouter>,
    );
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.length).toBe(2);
    for (const link of links) expect(coversItsCell(link)).toBe(false);
  });

  it('applications: the suite links open the suite, not the application', () => {
    const cells = cellsOf(<ApplicationsPage />);
    const draw = (key: string, data: Record<string, unknown>) => {
      const { Cell } = cells.find((c) => c.key === key)!;
      return render(
        <MemoryRouter>
          <Cell value={data[key] ?? data.name} valueFormatted={null} data={data} colDef={{ field: key }} />
        </MemoryRouter>,
      );
    };
    const row = { ...ROW, sequential_id: 'APP-2' };
    // Suites column
    const suites = draw('suites_count', row).container.querySelector('a')!;
    expect(suites.getAttribute('href')).toMatch(/^\/it\/applications\/APP-1\/overview/);
    cleanup();
    // "Included in" chip of the name cell (shown while the suites column is hidden)
    const chip = Array.from(draw('name', row).container.querySelectorAll('a')).find((a) => a.textContent?.includes('Suite'))!;
    expect(chip.getAttribute('href')).toMatch(/^\/it\/applications\/APP-1\/overview/);
  });

  it('assets, incidents and interfaces: every link cell covers its cell', () => {
    expectWholeCellLinks(<AssetsPage />);
    expectWholeCellLinks(<IncidentsPage />);
    expectWholeCellLinks(<InterfacesPage />);
  });
});
