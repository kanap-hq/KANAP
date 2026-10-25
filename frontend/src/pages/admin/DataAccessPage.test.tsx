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
const auth = vi.hoisted(() => ({ limited: false }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: () => true,
    profile: { id: 'me' },
    dataAccess: { mode: auth.limited ? 'limited' : 'all', nodes: [] },
  }),
}));
vi.mock('../../api', () => ({ default: { get, post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../ForbiddenPage', () => ({ default: () => <div>forbidden</div> }));
vi.mock('../../components/dataAccess/DataAccessDialog', () => ({
  default: (props: { open: boolean; personName: string }) => (props.open ? <div>dialog {props.personName}</div> : null),
}));
vi.mock('../../components/dataAccess/DataAccessNodeFilterDialog', () => ({
  default: (props: { open: boolean; onPick: (node: unknown) => void }) => (props.open ? (
    <button
      type="button"
      onClick={() => props.onPick({ type: 'cost_center', id: 'cc-1', name: 'Infrastructure', code: 'INF', kind: 'cost_center' })}
    >
      pick node
    </button>
  ) : null),
}));

import DataAccessPage from './DataAccessPage';

const OVERVIEW = {
  available: true,
  missing: [],
  persons: [
    {
      id: 'u-1',
      name: 'Marta Ruiz',
      roles: ['Budget member'],
      nodes: [
        { type: 'company', id: 'co-1', name: 'Alpha Spain', access: 'edit' },
        { type: 'cost_center', id: 'cc-1', name: 'Infrastructure', code: 'INF', kind: 'group', access: 'read' },
      ],
      updated_at: '2026-11-12T10:00:00.000Z',
      updated_by_name: 'Claire Dubois',
    },
  ],
  counts: { limited_persons: 1, lines_without_company: 3 },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <DataAccessPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.limited = false;
  get.mockResolvedValue({ data: OVERVIEW });
});

describe('DataAccessPage', () => {
  it('lists the limited people, their roles, nodes and last change, and the counters', async () => {
    renderPage();
    expect(await screen.findByText('Marta Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Budget member')).toBeInTheDocument();
    expect(screen.getByText('Alpha Spain')).toBeInTheDocument();
    expect(screen.getByText(/Infrastructure \(INF\)/)).toBeInTheDocument();
    expect(screen.getByText(/Claire Dubois/)).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.counters.limited|{"value":"1"}')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /admin:dataAccess.counters.withoutCompany/ });
    expect(link.getAttribute('href')).toContain('/ops/budget?filters=');
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain('"values":[null]');
  });

  it('shows Everything for an all node and None for a limited person without node', async () => {
    get.mockResolvedValue({
      data: {
        ...OVERVIEW,
        persons: [
          {
            id: 'u-all',
            name: 'Claire Dubois',
            roles: ['Budget member'],
            nodes: [{ type: 'all', id: null, name: null, access: 'edit' }],
            updated_at: null,
            updated_by_name: null,
          },
          {
            id: 'u-none',
            name: 'Nina Petit',
            roles: ['Budget member'],
            nodes: [],
            updated_at: null,
            updated_by_name: null,
          },
        ],
      },
    });
    renderPage();
    expect(await screen.findByText('admin:dataAccess.types.everything')).toBeInTheDocument();
    expect(screen.getByText('admin:dataAccess.none')).toBeInTheDocument();
    expect(screen.queryByText('admin:dataAccess.limited')).toBeNull();
  });

  it('keeps the headers on one line and left-aligns the person name', async () => {
    renderPage();
    await screen.findByText('Marta Ruiz');
    for (const label of [
      'admin:dataAccess.columns.person',
      'admin:dataAccess.columns.roles',
      'admin:dataAccess.columns.nodes',
      'admin:dataAccess.columns.lastChange',
    ]) {
      expect(getComputedStyle(screen.getByRole('columnheader', { name: label })).whiteSpace).toBe('nowrap');
    }
    expect(getComputedStyle(screen.getByRole('columnheader', { name: 'admin:dataAccess.columns.person' })).minWidth)
      .toBe('180px');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Marta Ruiz' })).justifyContent).toBe('flex-start');
  });

  it('opens the data access dialog from a row', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Marta Ruiz' }));
    expect(await screen.findByText('dialog Marta Ruiz')).toBeInTheDocument();
  });

  it('filters on a node through the server', async () => {
    renderPage();
    await screen.findByText('Marta Ruiz');
    fireEvent.click(screen.getByLabelText('admin:dataAccess.filters.node'));
    fireEvent.click(await screen.findByRole('button', { name: 'pick node' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/data-access', {
      params: { node_type: 'cost_center', node_id: 'cc-1' },
    }));
  });

  it('searches a name after the debounce and passes it to the server', async () => {
    renderPage();
    await screen.findByText('Marta Ruiz');
    fireEvent.change(screen.getByLabelText('admin:dataAccess.filters.name'), { target: { value: 'Mar' } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/data-access', { params: { q: 'Mar' } }));
  });

  it('shows the unavailable banner with what is missing', async () => {
    get.mockResolvedValue({
      data: { ...OVERVIEW, available: false, missing: ['role', 'policies'] },
    });
    renderPage();
    expect(await screen.findByText('admin:dataAccess.unavailable')).toBeInTheDocument();
    const missing = screen.getByText(/^admin:dataAccess.missing/);
    expect(missing).toHaveTextContent('missingParts.role');
    expect(missing).toHaveTextContent('missingParts.policies');
    expect(screen.getByRole('link', { name: 'admin:dataAccess.guide' })).toHaveAttribute(
      'href',
      expect.stringContaining('data-access'),
    );
  });

  it('shows nothing to a limited person', async () => {
    auth.limited = true;
    renderPage();
    expect(await screen.findByText('forbidden')).toBeInTheDocument();
    expect(screen.queryByText('Marta Ruiz')).toBeNull();
  });
});
