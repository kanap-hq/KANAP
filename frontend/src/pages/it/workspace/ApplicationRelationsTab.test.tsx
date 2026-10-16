import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import ApplicationRelationsTab, { type ApplicationRelationsData } from './ApplicationRelationsTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const auth = { manager: true };
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => auth.manager }) }));
vi.mock('../../../hooks/useBudgetColumns', () => ({ default: () => ({ label: (key: string) => `column:${key}` }) }));
vi.mock('../editors/IncidentRelationsSection', () => ({ default: () => <div data-testid="incidents" /> }));

const mocked = vi.mocked(api);

function relations(overrides: Partial<ApplicationRelationsData> = {}): ApplicationRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'planned', label: 'Budget' },
    budget_lines: [
      { id: 'bl-12', item_number: 12, nature: 'opex', product_name: 'Licences Talend', supplier_name: 'Talend SAS', amount: 48000, currency: 'EUR', status: 'enabled' },
    ],
    contracts: [
      { id: 'ct-1', name: 'Maintenance Talend', supplier_name: 'Talend SAS', end_date: '2027-05-31', yearly_amount: 36000, currency: 'EUR', auto_renewal: true, in_renewal_window: false, status: 'enabled' },
    ],
    projects: [{ id: 'prj-7', item_number: 7, name: 'Migration Talend Cloud', status: 'in_progress', planned_end: '2026-11-30' }],
    requests: [{ id: 'req-23', item_number: 23, name: 'Connecteur Salesforce', status: 'approved', target_delivery_date: '2027-03-31' }],
    tasks: [{ id: 't-118', item_number: 118, title: 'Mettre à jour le connecteur', status: 'in_progress', assignee_name: 'Isabelle Moreau', due_date: '2026-10-24' }],
    suggestions: [
      { type: 'budget_line', id: 'bl-34', item_number: 34, name: 'Formation Talend', via: { kind: 'same_supplier', label: null } },
    ],
    also: { assets: 3, interfaces: 4, documents: 0 },
    ...overrides,
  };
}

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(data: ApplicationRelationsData) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') return { data } as never;
    if (url === '/portfolio/projects') return { data: { items: [{ id: 'prj-9', item_number: 9, name: 'Refonte du datalake' }, { id: 'prj-7', item_number: 7, name: 'Migration Talend Cloud' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  const onRelationsChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/applications/app-1/relations']}>
          <Routes>
            <Route path="*" element={<><ApplicationRelationsTab id="app-1" onRelationsChange={onRelationsChange} /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onRelationsChange };
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.delete.mockReset();
  auth.manager = true;
});

describe('ApplicationRelationsTab', () => {
  it('shows one dense table per section with business references and the facts of each row', async () => {
    renderTab(relations());
    const lines = await screen.findByRole('table', { name: 'workspace.application.relations.sections.budgetLines' });
    expect(within(lines).getByText('BL-12')).toBeTruthy();
    expect(within(lines).getByText('Licences Talend')).toBeTruthy();
    expect(within(lines).getByText('ops:budget.opex')).toBeTruthy();
    expect(within(lines).getByText('48 000')).toBeTruthy();
    expect(within(lines).getByText('column:planned 2026 (EUR)')).toBeTruthy();

    const contracts = screen.getByRole('table', { name: 'workspace.application.relations.sections.contracts' });
    expect(within(contracts).getByText('36 000 EUR')).toBeTruthy();
    expect(within(contracts).getByText('workspace.application.relations.renewal.tacit')).toBeTruthy();

    expect(screen.getByText('PRJ-7')).toBeTruthy();
    expect(screen.getByText('portfolio:statuses.project.in_progress')).toBeTruthy();
    expect(screen.getByText('REQ-23')).toBeTruthy();
    expect(screen.getByText('T-118')).toBeTruthy();
    expect(screen.getByText('Isabelle Moreau')).toBeTruthy();
    expect(screen.getByTestId('incidents')).toBeTruthy();

    // Related elsewhere: assets and interfaces, no zero part.
    expect(screen.getByText('workspace.application.relations.also.assets(count=3)').getAttribute('href')).toBe('/it/applications/app-1/deployments');
    expect(screen.queryByText(/also\.documents/)).toBeNull();
  });

  it('opens the object when a row is clicked', async () => {
    renderTab(relations());
    fireEvent.click(await screen.findByText('Migration Talend Cloud'));
    expect(screen.getByTestId('location').textContent).toBe('/portfolio/projects/PRJ-7');
    fireEvent.click(screen.getByText('Maintenance Talend'));
    expect(screen.getByTestId('location').textContent).toBe('/ops/contracts/ct-1/overview');
  });

  it('hides the sections the user cannot read and the suggestions when there are none', async () => {
    renderTab(relations({ budget_lines: null, contracts: null, suggestions: [] }));
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.budgetLines' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.contracts' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.related' })).toBeNull();
    expect(screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' })).toBeTruthy();
  });

  it('adds a project from a server search, without the linked ones, and saves it at once', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    const { onRelationsChange } = renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));

    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/portfolio/projects', expect.objectContaining({
      params: { page: 1, limit: 30, sort: 'updated_at:DESC' },
    })));
    const option = await screen.findByRole('option', { name: /Refonte du datalake/ });
    expect(screen.queryByRole('option', { name: /Migration Talend Cloud/ })).toBeNull();
    fireEvent.click(option);

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/projects', { id: 'prj-9' }));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('removes a row at once and brings it back with a message when the server refuses', async () => {
    let reject: (e: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, r) => { reject = r; }) as never);
    renderTab(relations());
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Mettre à jour le connecteur)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-1/relations/tasks/t-118');
    await waitFor(() => expect(screen.queryByText('Mettre à jour le connecteur')).toBeNull());

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('Mettre à jour le connecteur')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('links a suggestion to its section', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    const related = await screen.findByRole('region', { name: 'workspace.application.relations.sections.related' });
    expect(within(related).getByText('BL-34')).toBeTruthy();
    expect(within(related).getByText('workspace.application.relations.via.same_supplier(label=)')).toBeTruthy();
    fireEvent.click(within(related).getByRole('button', { name: 'workspace.application.relations.linkNamed(name=Formation Talend)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/budget_lines', { id: 'bl-34' }));
  });

  it('gives readers the tables and the navigation only', async () => {
    auth.manager = false;
    renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
  });
});
