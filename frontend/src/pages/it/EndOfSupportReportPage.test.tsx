import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import { downloadBlob } from '../../utils/downloadBlob';
import EndOfSupportReportPage, { type DeadlineRow, type GapRow } from './EndOfSupportReportPage';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

const auth = vi.hoisted(() => ({ allowed: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => auth.allowed }),
}));
vi.mock('../ForbiddenPage', () => ({ default: () => <div>Forbidden</div> }));
vi.mock('../../utils/downloadBlob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/downloadBlob')>()),
  downloadBlob: vi.fn(),
}));

const getMock = vi.mocked(api.get);

const SQL: DeadlineRow = {
  key: 'technology:v16',
  type: 'technology',
  item_id: 'tech-1',
  item_name: 'SQL Server',
  item_reference: 'TEC-1',
  version: '2016',
  milestone: null,
  date: '2026-07-14',
  state: 'out_of_support',
  server_count: 1,
  servers: [{ id: 'asset-1', name: 'SRV-SQL-01' }],
  application_count: 1,
  applications: [{ id: 'app-1', name: 'ERP', reference: 'APP-3' }],
};
const HARDWARE: DeadlineRow = {
  key: 'hardware:end_of_life:asset-9',
  type: 'hardware',
  item_id: 'asset-9',
  item_name: 'ESX-09',
  item_reference: null,
  version: null,
  milestone: 'end_of_life',
  date: '2027-01-31',
  state: 'upcoming',
  server_count: 1,
  servers: [{ id: 'asset-9', name: 'ESX-09' }],
  application_count: 0,
  applications: [],
};
const GAP: GapRow = {
  key: 'vm_without_host:asset-5',
  gap: 'vm_without_host',
  subject_type: 'asset',
  subject_id: 'asset-5',
  subject_name: 'VM-ORPHAN',
  subject_reference: null,
  related_type: null,
  related_id: null,
  related_name: null,
  version: null,
};

function respond({ applicationsVisible = true } = {}) {
  getMock.mockImplementation(async (url: string, config?: any) => {
    if (url.endsWith('/export')) return { data: new Blob(['a;b']), headers: { 'content-disposition': 'attachment; filename="eos.csv"' } } as any;
    if (url.endsWith('/gaps')) return { data: { applications_visible: applicationsVisible, items: [GAP] } } as any;
    const rows = applicationsVisible ? [SQL, HARDWARE] : [{ ...SQL, application_count: null, applications: null }, { ...HARDWARE, application_count: null, applications: null }];
    return { data: { horizon_months: config?.params?.horizon_months ?? 12, today: '2026-10-16', until: '2027-10-16', applications_visible: applicationsVisible, items: rows } } as any;
  });
}

function renderPage(path = '/it/technologies/end-of-support') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/it/technologies/end-of-support" element={<EndOfSupportReportPage />} />
            <Route path="/it/assets/:id" element={<div>Asset page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('EndOfSupportReportPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    vi.mocked(downloadBlob).mockReset();
    auth.allowed = true;
  });

  it('lists the deadlines with their state, and filters by type', async () => {
    respond();
    renderPage();
    expect(await screen.findByText('SQL Server')).toBeTruthy();
    expect(getMock).toHaveBeenCalledWith('/technologies/reports/end-of-support', { params: { horizon_months: 12 } });
    expect(screen.getByText('Out of support')).toBeTruthy();
    expect(screen.getByText('Ends soon')).toBeTruthy();
    expect(screen.getByText('End of life')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Applications' })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Hardware' }));
    await waitFor(() => expect(screen.queryByText('SQL Server')).toBeNull());
    expect(screen.getByText('ESX-09')).toBeTruthy();
  });

  it('asks the chosen horizon', async () => {
    respond();
    renderPage();
    await screen.findByText('SQL Server');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Horizon' }));
    fireEvent.click(await screen.findByRole('option', { name: '24 months' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/technologies/reports/end-of-support', { params: { horizon_months: 24 } }));
  });

  it('opens a row on what it touches, with links', async () => {
    respond();
    renderPage();
    const row = (await screen.findByText('SQL Server')).closest('tr')!;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const server = screen.getByRole('link', { name: 'SRV-SQL-01' });
    expect(server.getAttribute('href')).toBe('/it/assets/asset-1');
    expect(screen.getByRole('link', { name: /ERP/ }).getAttribute('href')).toBe('/it/applications/app-1');
    expect(screen.getByRole('link', { name: 'Open the technology' }).getAttribute('href')).toBe('/it/technologies/tech-1');
    fireEvent.click(row);
    expect(screen.queryByRole('link', { name: 'SRV-SQL-01' })).toBeNull();
  });

  it('hides the application column without the applications right', async () => {
    respond({ applicationsVisible: false });
    renderPage();
    const row = (await screen.findByText('SQL Server')).closest('tr')!;
    expect(screen.queryByRole('columnheader', { name: 'Applications' })).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('Applications are hidden: you cannot read them.')).toBeTruthy();
  });

  it('lists the missing data and opens the record to complete', async () => {
    respond();
    renderPage();
    await screen.findByText('SQL Server');
    fireEvent.click(screen.getByRole('tab', { name: 'Missing data' }));
    const gap = await screen.findByText('Virtual machine without a host');
    expect(getMock).toHaveBeenCalledWith('/technologies/reports/end-of-support/gaps');
    expect(screen.queryByRole('combobox', { name: 'Horizon' })).toBeNull();
    fireEvent.click(within(gap.closest('tr')!).getByText('VM-ORPHAN'));
    expect(await screen.findByText('Asset page')).toBeTruthy();
  });

  it('exports the list on screen', async () => {
    respond();
    renderPage('/it/technologies/end-of-support?type=hardware&horizon=36');
    await screen.findByText('ESX-09');
    fireEvent.click(screen.getByRole('button', { name: 'Export table as CSV' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'eos.csv'));
    expect(getMock).toHaveBeenCalledWith('/technologies/reports/end-of-support/export', {
      params: { list: 'deadlines', horizon_months: 36, type: 'hardware' },
      responseType: 'blob',
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Missing data' }));
    await screen.findByText('VM-ORPHAN');
    fireEvent.click(screen.getByRole('button', { name: 'Export table as CSV' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/technologies/reports/end-of-support/export', { params: { list: 'gaps' }, responseType: 'blob' }));
  });

  it('refuses a reader without the infrastructure right', () => {
    auth.allowed = false;
    respond();
    renderPage();
    expect(screen.getByText('Forbidden')).toBeTruthy();
    expect(getMock).not.toHaveBeenCalled();
  });
});
