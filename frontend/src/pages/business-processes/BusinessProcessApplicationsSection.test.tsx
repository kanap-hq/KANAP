import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import BusinessProcessApplicationsSection from './BusinessProcessApplicationsSection';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const auth = { manager: true };
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => auth.manager }) }));
const catalog = { data: { businessCriticalityLevels: [{ code: 'business_critical', label: 'Business critical' }] } };
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => catalog }));

const mocked = vi.mocked(api);
const TITLE = 'businessProcesses.applications.title';

type Row = { id: string; name: string; reference: string | null; criticality: string | null; lifecycle: string | null; it_owner_names: string[] };
const ERP: Row = { id: 'app-1', name: 'SAP ERP', reference: 'APP-12', criticality: 'business_critical', lifecycle: 'active', it_owner_names: ['Marc Petit', 'Claire Dubois'] };

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSection(items: Row[] | null) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/business-processes/bp-1/applications') return { data: { items } } as never;
    if (url === '/applications') return { data: { items: [{ id: 'app-1', name: 'SAP ERP', sequential_id: 'APP-12' }, { id: 'app-2', name: 'Salesforce', sequential_id: 'APP-3' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/master-data/business-processes/bp-1/overview']}>
          <Routes>
            <Route path="*" element={<><BusinessProcessApplicationsSection id="bp-1" /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.delete.mockReset();
  auth.manager = true;
});

describe('BusinessProcessApplicationsSection', () => {
  it('lists the applications with reference, criticality and IT owners, and opens one', async () => {
    renderSection([ERP]);
    const table = await screen.findByRole('table', { name: TITLE });
    expect(within(table).getByText('APP-12')).toBeTruthy();
    expect(within(table).getByText('Business critical')).toBeTruthy();
    expect(within(table).getByText('Marc Petit, Claire Dubois')).toBeTruthy();
    fireEvent.click(within(table).getByText('SAP ERP'));
    expect(screen.getByTestId('location').textContent).toBe('/it/applications/app-1/overview');
  });

  it('adds an application from a search, without the linked ones', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderSection([ERP]);
    await screen.findByRole('table', { name: TITLE });
    fireEvent.click(screen.getByText('businessProcesses.applications.add'));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/applications', expect.objectContaining({ params: { page: 1, limit: 30, sort: 'name:ASC' } })));
    const option = await screen.findByRole('option', { name: /Salesforce/ });
    expect(screen.queryByRole('option', { name: /SAP ERP/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/business-processes/bp-1/applications', { application_id: 'app-2' }));
  });

  it('removes an application at once and brings it back when the server refuses', async () => {
    let reject: (e: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, r) => { reject = r; }) as never);
    renderSection([ERP]);
    fireEvent.click(await screen.findByRole('button', { name: 'businessProcesses.applications.remove(name=SAP ERP)' }));
    expect(mocked.delete).toHaveBeenCalledWith('/business-processes/bp-1/applications/app-1');
    await waitFor(() => expect(screen.queryByText('SAP ERP')).toBeNull());
    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('SAP ERP')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows one line when nothing is linked, and readers get no actions', async () => {
    auth.manager = false;
    renderSection([]);
    expect(await screen.findByText('businessProcesses.applications.empty')).toBeTruthy();
    expect(screen.queryByText('businessProcesses.applications.add')).toBeNull();
  });

  it('is absent for a user who cannot read applications', async () => {
    renderSection(null);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/business-processes/bp-1/applications'));
    await waitFor(() => expect(screen.queryByRole('region', { name: TITLE })).toBeNull());
    expect(screen.queryByText('businessProcesses.applications.empty')).toBeNull();
  });
});
