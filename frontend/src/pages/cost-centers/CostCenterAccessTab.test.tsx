import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options ? `${key}|${JSON.stringify(options)}` : key
));
const get = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get, put, post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../components/fields/UserSelect', () => ({
  default: (props: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => props.onChange('u-2')}>pick person</button>
  ),
}));

import CostCenterAccessTab from './CostCenterAccessTab';

const VIEW = {
  direct: [
    { person: { id: 'u-1', name: 'Paul Martin' }, access: 'edit' },
  ],
  inherited: [
    { person: { id: 'u-3', name: 'Rita Bloom' }, via: { type: 'cost_center', id: 'cc-0', code: 'INF', name: 'Infrastructure' }, access: 'read' },
    { person: { id: 'u-4', name: 'Claire Dubois' }, via: { type: 'company', name: 'Alpha France' }, access: 'edit' },
    { person: { id: 'u-5', name: 'Rob Hale' }, via: { type: 'all', name: null }, access: 'read' },
  ],
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <CostCenterAccessTab costCenterId="cc-1" companyId="co-1" />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/cost-centers/cc-1/data-access') return { data: VIEW };
    if (url === '/users/u-2/data-access') return { data: { mode: 'limited', nodes: [] } };
    return { data: {} };
  });
  put.mockResolvedValue({ data: {} });
});

describe('CostCenterAccessTab', () => {
  it('shows direct access and where the inherited access comes from', async () => {
    renderTab();
    expect(await screen.findByText('Paul Martin')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.accessTab.direct')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.accessTab.inherited')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Infrastructure (INF)' })).toHaveAttribute(
      'href',
      '/master-data/cost-centers/cc-0/access',
    );
    expect(screen.getByRole('link', { name: 'Alpha France' })).toHaveAttribute(
      'href',
      '/master-data/companies/co-1/access',
    );
    expect(screen.getByText('admin:dataAccess.types.everything')).toBeInTheDocument();
    // An inherited access has no remove command.
    expect(screen.queryByRole('button', { name: 'admin:dataAccess.accessTab.remove|{"name":"Rita Bloom"}' })).toBeNull();
  });

  it('adds a direct access with edit and removes it through the person’s own access', async () => {
    renderTab();
    await screen.findByText('Paul Martin');
    fireEvent.click(screen.getByRole('button', { name: 'pick person' }));
    fireEvent.mouseDown(screen.getByRole('combobox', {
      name: 'admin:dataAccess.accessLabel|{"name":"admin:dataAccess.person"}',
    }));
    fireEvent.click(screen.getByRole('option', { name: 'admin:dataAccess.access.edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-2/data-access', {
      mode: 'limited',
      nodes: [{ type: 'cost_center', id: 'cc-1', access: 'edit' }],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.remove|{"name":"Paul Martin"}' }));
    await waitFor(() => expect(put).toHaveBeenLastCalledWith('/users/u-1/data-access', {
      mode: 'limited',
      nodes: [],
    }));
  });

  it('shows a refusal inline', async () => {
    put.mockRejectedValueOnce({ response: { status: 409, data: { code: 'DATA_ACCESS_UNAVAILABLE', message: 'No.' } } });
    renderTab();
    await screen.findByText('Paul Martin');
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.remove|{"name":"Paul Martin"}' }));
    expect(await screen.findByText(/errors:DATA_ACCESS_UNAVAILABLE/)).toBeInTheDocument();
  });
});
