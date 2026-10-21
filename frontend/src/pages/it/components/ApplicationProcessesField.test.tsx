import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import ApplicationProcessesField from './ApplicationProcessesField';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => (opts?.name ? `${key}(${opts.name})` : key),
  i18n: { language: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const auth = { levels: {} as Record<string, string> };
const RANK: Record<string, number> = { reader: 1, contributor: 2, manager: 3, admin: 4 };
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => (RANK[auth.levels[resource] ?? ''] ?? 0) >= RANK[level] }),
}));
const picker = { options: [{ id: 'bp-1', name: 'Order to cash' }, { id: 'bp-2', name: 'Procure to pay' }] };
vi.mock('../../../hooks/useLookupPicker', () => ({
  useLookupPicker: () => ({ options: picker.options, searching: false, loading: false, autocomplete: {} }),
}));

const mocked = vi.mocked(api);

function relations(processes: Array<{ id: string; name: string; status: string | null; owner_name: string | null }> | null) {
  return {
    year: 2026, budget_column: { key: 'planned', label: 'Budget' }, budget_lines: [], contracts: [], projects: [], requests: [], tasks: [],
    technologies: [], deployment_servers: [], processes, incidents: [], suggestions: [], also: { assets: 0, interfaces: 0, documents: 0 },
  };
}

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderField(processes: Parameters<typeof relations>[0], canManage = true) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') return { data: relations(processes) } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/applications/app-1/overview']}>
          <Routes>
            <Route path="*" element={<><ApplicationProcessesField applicationId="app-1" canManage={canManage} onChange={onChange} /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onChange };
}

const PROCESSES = [
  { id: 'bp-1', name: 'Order to cash', status: 'enabled', owner_name: 'Claire Dubois' },
  { id: 'bp-3', name: 'Record to report', status: 'disabled', owner_name: null },
];

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.delete.mockReset();
  auth.levels = { applications: 'manager', business_processes: 'manager' };
});

describe('ApplicationProcessesField', () => {
  it('lists the processes by name, each leading to its page, a disabled one faded', async () => {
    renderField(PROCESSES);
    fireEvent.click(await screen.findByText('Order to cash'));
    expect(screen.getByTestId('location').textContent).toBe('/master-data/business-processes/bp-1/overview');
    expect(screen.getByText('Record to report')).toBeTruthy();
    expect(screen.getByText('workspace.application.ownership.businessProcesses')).toBeTruthy();
  });

  it('adds a process found by the server search, without the linked ones, and saves it at once', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    const { onChange } = renderField(PROCESSES);
    await screen.findByText('Order to cash');
    const input = screen.getByRole('combobox', { name: 'workspace.application.ownership.businessProcesses' });
    fireEvent.mouseDown(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const option = await screen.findByRole('option', { name: 'Procure to pay' });
    expect(screen.queryByRole('option', { name: 'Order to cash' })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/processes', { id: 'bp-2' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('removes a process at once from its hover action', async () => {
    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    const { onChange } = renderField(PROCESSES);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(Order to cash)' }));
    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-1/relations/processes/bp-1');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('is read-only without the right to manage business processes or applications', async () => {
    auth.levels = { applications: 'manager', business_processes: 'reader' };
    renderField(PROCESSES);
    await screen.findByText('Order to cash');
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('is read-only for a reader of applications', async () => {
    renderField(PROCESSES, false);
    await screen.findByText('Order to cash');
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('is absent without the read of business processes', async () => {
    auth.levels = { applications: 'manager' };
    renderField(PROCESSES);
    expect(screen.queryByText('workspace.application.ownership.businessProcesses')).toBeNull();
    expect(mocked.get).not.toHaveBeenCalled();
  });
});
