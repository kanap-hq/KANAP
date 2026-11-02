import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectAnchoredRight, placeAnchor, stubPopoverPaperWidth } from '../../../test/popoverAnchor';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import TechnologyApplicationsTab, { countApplications, type TechnologyApplicationRow } from './TechnologyApplicationsTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'fr', resolvedLanguage: 'fr' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'business_critical', label: 'Business critical' }] } }),
}));
const download = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/downloadBlob', () => ({ downloadBlob: download, extractFilenameFromDisposition: () => 'TEC-3_applications.csv' }));

const mocked = vi.mocked(api);
const A = 'workspace.technology.applications';

const row = (overrides: Partial<TechnologyApplicationRow>): TechnologyApplicationRow => ({
  kind: 'hosted', link_id: null, application_id: 'app', application_name: 'App', application_reference: null,
  criticality: null, external_facing: false, it_owner_names: [], environment: null, asset_id: null, asset_name: null,
  via_asset_id: null, via_asset_name: null, technology_version_id: null, version_label: null, ...overrides,
});

const ROWS: TechnologyApplicationRow[] = [
  row({
    application_id: 'erp', application_name: 'ERP', application_reference: 'APP-4', criticality: 'business_critical', external_facing: true,
    it_owner_names: ['Ada Lovelace', 'Alan Turing'], environment: 'prod', asset_id: 'db1', asset_name: 'PAR-DB-01', technology_version_id: 'v19', version_label: '2019',
  }),
  row({
    application_id: 'erp', application_name: 'ERP', application_reference: 'APP-4', criticality: 'business_critical', external_facing: true,
    environment: 'pre_prod', asset_id: 'vm1', asset_name: 'PAR-VM-01', via_asset_id: 'esx', via_asset_name: 'ESX-01',
  }),
  row({ kind: 'declared', link_id: 'd-1', application_id: 'crm', application_name: 'CRM', application_reference: 'APP-7', criticality: 'medium' }),
];
const VERSIONS = [{ id: 'v22', label: '2022' }, { id: 'v19', label: '2019' }];

const picker = () => within(document.querySelector('.MuiPopover-paper') as HTMLElement);

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderTab(items: TechnologyApplicationRow[] | null = ROWS, canManage = true) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/technologies/tech-1/applications') return { data: { items } } as never;
    if (url === '/technologies/tech-1/applications/export') return { data: 'csv', headers: {} } as never;
    if (url === '/applications') {
      return { data: { items: [{ id: 'crm', name: 'CRM', sequential_id: 'APP-7' }, { id: 'hr', name: 'HR', sequential_id: 'APP-8' }, { id: 'web', name: 'Web shop', sequential_id: 'APP-9' }] } } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/technologies/TEC-3/applications']}>
          <Routes>
            <Route
              path="*"
              element={<><TechnologyApplicationsTab technologyId="tech-1" technologyReference="TEC-3" versions={VERSIONS} canManage={canManage} /><Location /></>}
            />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.patch.mockReset();
  mocked.delete.mockReset();
  download.mockReset();
  mocked.post.mockResolvedValue({ data: { ok: true, added: 2 } } as never);
  mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
  mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
});

describe('TechnologyApplicationsTab', () => {
  it('lists the hosted and declared applications with their facts, the server and the version', async () => {
    renderTab();
    const table = await screen.findByRole('table', { name: `${A}.title` });
    const rows = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(rows.map((tr) => tr.querySelector('td')?.textContent)).toEqual(['APP-4', 'APP-4', 'APP-7']);
    const first = within(rows[0]);
    expect(first.getByText('enums.environment.prod')).toBeTruthy();
    expect(first.getByText('Business critical')).toBeTruthy();
    expect(first.getByText(`${A}.yes`)).toBeTruthy();
    expect(first.getByText('PAR-DB-01')).toBeTruthy();
    expect(first.getByText('2019')).toBeTruthy();
    expect(first.getByText('Ada Lovelace, Alan Turing')).toBeTruthy();
    expect(within(rows[1]).getByText(`${A}.viaHost(server=PAR-VM-01,host=ESX-01)`)).toBeTruthy();
    expect(within(rows[1]).getByTitle('workspace.technology.versionPicker.unknown').textContent).toBe('—');
    expect(within(rows[2]).getByText(`${A}.declared`)).toBeTruthy();
    // The count is of distinct applications.
    expect(screen.getByRole('region', { name: `${A}.title` }).querySelector('h2')?.parentElement?.textContent).toContain('2');
    expect(countApplications(ROWS)).toBe(2);

    fireEvent.click(first.getByText('PAR-DB-01'));
    expect(screen.getByTestId('location').textContent).toBe('/it/applications/erp/overview');
  });

  it('keeps apart two hosted rows that differ only by the server the technology comes through', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const crm = { application_id: 'crm', application_name: 'CRM', environment: 'prod', asset_id: 'vm1', asset_name: 'PAR-VM-01', technology_version_id: 'v6', version_label: '6.0' };
    renderTab([row(crm), row({ ...crm, via_asset_id: 'h1', via_asset_name: 'ESX-01' })]);
    const table = await screen.findByRole('table', { name: `${A}.title` });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
  });

  it('withdraws a declared application and refuses to remove a hosted one', async () => {
    // The row leaves at once, before the server answers.
    mocked.delete.mockReturnValue(new Promise(() => undefined) as never);
    renderTab();
    await screen.findByRole('table', { name: `${A}.title` });
    expect(screen.queryByRole('button', { name: `${A}.remove(name=ERP)` })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${A}.remove(name=CRM)` }));
    expect(mocked.delete).toHaveBeenCalledWith('/technologies/tech-1/applications/crm');
    await waitFor(() => expect(screen.queryByText('APP-7')).toBeNull());
  });

  it('offers one withdrawal per declared application, on its first declared row', async () => {
    renderTab([
      ...ROWS,
      row({ kind: 'declared', link_id: 'd-2', application_id: 'crm', application_name: 'CRM', application_reference: 'APP-7', technology_version_id: 'v19', version_label: '2019' }),
    ]);
    const table = await screen.findByRole('table', { name: `${A}.title` });
    const crmRows = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.textContent?.includes('APP-7')) as HTMLElement[];
    expect(crmRows).toHaveLength(2);
    expect(within(crmRows[0]).getByRole('button', { name: `${A}.remove(name=CRM)` })).toBeTruthy();
    expect(within(crmRows[1]).queryByRole('button', { name: `${A}.remove(name=CRM)` })).toBeNull();
  });

  it('declares the technology on several applications at once, then their version, never offering a declared one', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${A}.title` });
    fireEvent.click(screen.getByText(`${A}.add`));
    await waitFor(() => picker().getByText('HR'));
    expect(picker().queryByText('CRM')).toBeNull();
    const confirm = picker().getByRole('button', { name: `${A}.addCount(count=0)` }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(picker().getByText('HR'));
    fireEvent.click(picker().getByText('Web shop'));
    // A second click unticks; a third ticks again.
    fireEvent.click(picker().getByText('HR'));
    fireEvent.click(picker().getByText('HR'));
    fireEvent.click(picker().getByRole('button', { name: `${A}.addCount(count=2)` }));
    // The version comes next, in the picker of the other link writes; nothing is saved before it.
    await waitFor(() => picker().getByRole('combobox', { name: 'workspace.technology.versionPicker.search' }));
    expect(mocked.post).not.toHaveBeenCalled();
    fireEvent.click(picker().getByText('2022'));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tech-1/applications', { application_ids: ['web', 'hr'], technology_version_id: 'v22' }));
    await waitFor(() => expect(document.querySelector('.MuiPopover-paper')).toBeNull());
  });

  it('declares applications at an unknown version, or at a label the server creates', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${A}.title` });
    const addHr = async () => {
      fireEvent.click(screen.getByText(`${A}.add`));
      await waitFor(() => picker().getByText('HR'));
      fireEvent.click(picker().getByText('HR'));
      fireEvent.click(picker().getByRole('button', { name: `${A}.addCount(count=1)` }));
      await waitFor(() => picker().getByRole('combobox', { name: 'workspace.technology.versionPicker.search' }));
    };
    await addHr();
    fireEvent.click(picker().getByText('workspace.technology.versionPicker.unknown'));
    await waitFor(() => expect(mocked.post).toHaveBeenLastCalledWith('/technologies/tech-1/applications', { application_ids: ['hr'], technology_version_id: null }));
    await waitFor(() => expect(document.querySelector('.MuiPopover-paper')).toBeNull());

    await addHr();
    const input = picker().getByRole('combobox', { name: 'workspace.technology.versionPicker.search' });
    fireEvent.change(input, { target: { value: '2025' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocked.post).toHaveBeenLastCalledWith('/technologies/tech-1/applications', { application_ids: ['hr'], version_label: '2025' }));
  });

  it('says why the server refused an add', async () => {
    mocked.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'One or more applications not found.' } } });
    renderTab();
    await screen.findByRole('table', { name: `${A}.title` });
    fireEvent.click(screen.getByText(`${A}.add`));
    await waitFor(() => picker().getByText('HR'));
    fireEvent.click(picker().getByText('HR'));
    fireEvent.click(picker().getByRole('button', { name: `${A}.addCount(count=1)` }));
    await waitFor(() => picker().getByText('2019'));
    fireEvent.click(picker().getByText('2019'));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    expect(mocked.post).toHaveBeenCalledWith('/technologies/tech-1/applications', { application_ids: ['hr'], technology_version_id: 'v19' });
  });

  it('changes the version of a declaration in place, and of no hosted row', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${A}.title` });
    expect(screen.queryByRole('button', { name: `${A}.changeVersion(name=ERP)` })).toBeNull();
    const button = screen.getByRole('button', { name: `${A}.changeVersion(name=CRM)` });
    // The control takes the whole cell: a click beside a short label ("—") must not open the application.
    expect(getComputedStyle(button).display).toBe('block');
    expect(getComputedStyle(button).width).toBe('100%');
    fireEvent.click(button);
    fireEvent.click(picker().getByText('2022'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/technologies/tech-1/application-links/d-1', { technology_version_id: 'v22' }));
  });

  it('exports the rows as CSV or Excel in the screen language', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${A}.title` });
    const region = screen.getByRole('region', { name: `${A}.title` });
    const button = within(region).getByRole('button', { name: 'common:export.button' });
    const titleRow = region.querySelector('h2')?.parentElement as HTMLElement;
    // Next to the title: after the count, before Add.
    expect(titleRow.contains(button)).toBe(true);
    expect(within(titleRow).getByText('2').compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(within(region).getByRole('button', { name: `${A}.add` })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportCsv' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(mocked.get).toHaveBeenCalledWith('/technologies/tech-1/applications/export', { params: { language: 'fr', format: 'csv' }, responseType: 'blob' });
    expect(download.mock.calls[0][1]).toBe('TEC-3_applications.csv');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportXlsx' }));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/technologies/tech-1/applications/export', { params: { language: 'fr', format: 'xlsx' }, responseType: 'blob' }));
  });

  it('shows no export when the section has no row', async () => {
    renderTab([]);
    const region = await screen.findByRole('region', { name: `${A}.title` });
    expect(await within(region).findByText(`${A}.empty`)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'common:export.button' })).toBeNull();
  });

  it('says in one line that the applications cannot be read', async () => {
    renderTab(null);
    expect(await screen.findByText(`${A}.noAccess`)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(`${A}.add`)).toBeNull();
    expect(screen.queryByText('common:export.button')).toBeNull();
  });

  it('shows no writing control to a reader', async () => {
    renderTab(ROWS, false);
    await screen.findByRole('table', { name: `${A}.title` });
    expect(screen.queryByText(`${A}.add`)).toBeNull();
    expect(screen.queryByRole('button', { name: /applications\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /changeVersion/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: `${A}.title` })).getByRole('button', { name: 'common:export.button' })).toBeTruthy();
  });

  describe('popover anchor', () => {
    const innerWidth = window.innerWidth;
    let restoreWidth: () => void = () => undefined;

    beforeEach(() => {
      window.innerWidth = 1280;
      restoreWidth = stubPopoverPaperWidth();
    });

    afterEach(() => {
      window.innerWidth = innerWidth;
      restoreWidth();
    });

    it('keeps the version picker right-aligned on a row', async () => {
      renderTab();
      const button = await screen.findByRole('button', { name: `${A}.changeVersion(name=CRM)` });
      placeAnchor(button, { left: 900, top: 200, width: 32, height: 32 });
      fireEvent.click(button);
      expect(picker().getByText('2022')).toBeTruthy();
      expectAnchoredRight(932, 300);
    });
  });
});
