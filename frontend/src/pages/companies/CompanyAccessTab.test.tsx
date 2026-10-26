import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

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
  default: (props: { onChange: (id: string | null, user: { id: string; first_name: string; last_name: string } | null) => void }) => {
    return (
      <button
        type="button"
        onClick={() => props.onChange('u-2', { id: 'u-2', first_name: 'Marta', last_name: 'Ruiz' })}
      >
        pick person
      </button>
    );
  },
}));

import CompanyAccessTab from './CompanyAccessTab';

const VIEW = {
  full: [
    { person: { id: 'u-1', name: 'Paul Martin' }, via: { type: 'company', name: 'Alpha France' }, access: 'edit' },
    { person: { id: 'u-3', name: 'Nina Roy' }, via: { type: 'all', name: null }, access: 'read' },
  ],
  partial: [
    { person: { id: 'u-4', name: 'Marta Ruiz' }, via: { type: 'cost_center', id: 'cc-2', code: 'INF-ES', name: 'Infrastructure Spain' }, access: 'read' },
  ],
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <CompanyAccessTab companyId="co-1" nodeLabel="Alpha France" />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/companies/co-1/data-access') return { data: VIEW };
    if (url === '/users/u-2/data-access') return { data: { mode: 'limited', nodes: [] } };
    return { data: {} };
  });
  put.mockResolvedValue({ data: {} });
});

function pickPerson(access: 'read' | 'edit' = 'read') {
  fireEvent.click(screen.getByRole('button', { name: 'pick person' }));
  if (access === 'edit') {
    fireEvent.mouseDown(screen.getByRole('combobox', {
      name: 'admin:dataAccess.accessLabel|{"name":"admin:dataAccess.person"}',
    }));
    fireEvent.click(screen.getByRole('option', { name: 'admin:dataAccess.access.edit' }));
  }
}

describe('CompanyAccessTab', () => {
  it('shows who sees the whole company and who sees a part of it, with the node that gives it', async () => {
    renderTab();
    expect(await screen.findByText('Paul Martin')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.accessTab.full')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.accessTab.partial')).toBeInTheDocument();
    expect(screen.getByText('Marta Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure Spain (INF-ES)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Infrastructure Spain (INF-ES)' })).toHaveAttribute(
      'href',
      '/master-data/cost-centers/cc-2/access',
    );
    // A person who sees everything has no remove command on the company page.
    expect(screen.queryByRole('button', { name: 'admin:dataAccess.accessTab.remove|{"name":"Nina Roy"}' })).toBeNull();
  });

  it('adds a person to the whole company through the person’s own access', async () => {
    renderTab();
    await screen.findByText('Paul Martin');
    pickPerson('edit');
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-2/data-access', {
      mode: 'limited',
      nodes: [{ type: 'company', id: 'co-1', access: 'edit' }],
    }));
  });

  it('confirms before limiting a person who sees all data, then saves on confirmation', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/companies/co-1/data-access') return { data: VIEW };
      if (url === '/users/u-2/data-access') return { data: { mode: 'all', nodes: [], is_administrator: false } };
      return { data: {} };
    });
    renderTab();
    await screen.findByText('Paul Martin');
    pickPerson('edit');
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(
      'admin:dataAccess.accessTab.confirmLimited|{"name":"Marta Ruiz","node":"Alpha France"}',
    )).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-2/data-access', {
      mode: 'limited',
      nodes: [{ type: 'company', id: 'co-1', access: 'edit' }],
    }));
  });

  it('saves nothing when the all-data confirmation is cancelled', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/companies/co-1/data-access') return { data: VIEW };
      if (url === '/users/u-2/data-access') return { data: { mode: 'all', nodes: [], is_administrator: false } };
      return { data: {} };
    });
    renderTab();
    await screen.findByText('Paul Martin');
    pickPerson();
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(put).not.toHaveBeenCalled();
  });

  it('adds a limited person without confirmation and keeps their nodes', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/companies/co-1/data-access') return { data: VIEW };
      if (url === '/users/u-2/data-access') {
        return {
          data: {
            mode: 'limited',
            nodes: [{ type: 'cost_center', id: 'cc-9', name: 'Infrastructure', access: 'read' }],
            is_administrator: false,
          },
        };
      }
      return { data: {} };
    });
    renderTab();
    await screen.findByText('Paul Martin');
    pickPerson();
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-2/data-access', {
      mode: 'limited',
      nodes: [
        { type: 'cost_center', id: 'cc-9', access: 'read' },
        { type: 'company', id: 'co-1', access: 'read' },
      ],
    }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves an Administrator to the server refusal, with no confirmation', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/companies/co-1/data-access') return { data: VIEW };
      if (url === '/users/u-2/data-access') return { data: { mode: 'all', nodes: [], is_administrator: true } };
      return { data: {} };
    });
    put.mockRejectedValueOnce({ response: { status: 409, data: { code: 'DATA_ACCESS_ADMINISTRATOR', message: 'No.' } } });
    renderTab();
    await screen.findByText('Paul Martin');
    pickPerson();
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.addButton' }));

    expect(await screen.findByText(/errors:DATA_ACCESS_ADMINISTRATOR/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('removes a direct company access through the person’s own access', async () => {
    renderTab();
    await screen.findByText('Paul Martin');
    fireEvent.click(screen.getByRole('button', { name: 'admin:dataAccess.accessTab.remove|{"name":"Paul Martin"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/users/u-1/data-access', {
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
