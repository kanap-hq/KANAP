import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import TechnologyWorkspacePage from './TechnologyWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ level: 'admin' }));
const owners = vi.hoisted(() => ({ onChange: {} as Record<string, (ids: string[]) => Promise<void>> }));

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
const RANK: Record<string, number> = { reader: 1, member: 2, admin: 3 };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => RANK[auth.level] >= RANK[level] }),
}));
vi.mock('../../api', () => ({ default: { get, post, patch, delete: del } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: null,
    byField: { technologyFamily: [{ code: 'database', label: 'Database' }], lifecycleStatus: [{ code: 'active', label: 'Active' }] },
    labelFor: (_field: string, code: string) => code ?? '',
  }),
}));
// The shell's layout is covered by its own tests: here it lays its slots out plainly.
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => (
    <div>
      <div data-testid="reference">{props.itemReference}</div>
      <h1>{props.title}</h1>
      <div role="tablist">
        {props.tabs.map((tab: any) => <button key={tab.key} role="tab" disabled={tab.disabled} data-badge={tab.badge ?? undefined}>{tab.label}</button>)}
      </div>
      <div>{props.metadata}</div>
      <div>{props.actions}</div>
      <aside>{props.properties}</aside>
      <main>{props.children}</main>
    </div>
  ),
}));
vi.mock('../../components/fields/TeamMemberMultiSelect', () => ({
  default: (props: any) => {
    owners.onChange[props.label] = props.onChange;
    return <div data-testid={`owners-${props.label}`}>{props.value.map((item: any) => item.user_display_name).join(', ')}</div>;
  },
}));

const DETAIL = {
  id: 'tech-1',
  reference: 'TEC-3',
  name: 'Microsoft SQL Server',
  editor: 'Microsoft',
  family: 'database',
  mode: 'installed',
  lifecycle: 'active',
  description: 'Main database engine',
  notes: null,
  cpe_products: ['a:microsoft:sql_server'],
  replaced_by_id: null,
  replaced_by: null,
  versions: [
    { id: 'v2', label: '2022', cpe_version: null, build_prefixes: [], standard_support_end: '2099-01-11', extended_support_end: null, notes: null, servers: 0, applications: 0 },
    { id: 'v3', label: '2019', cpe_version: null, build_prefixes: [], standard_support_end: '2020-01-01', extended_support_end: '2099-01-01', notes: null, servers: 0, applications: 0 },
    { id: 'v1', label: '2012', cpe_version: null, build_prefixes: [], standard_support_end: '2017-07-11', extended_support_end: '2022-07-12', notes: null, servers: 2, applications: 0 },
  ],
  owners: [
    { user_id: 'u-1', owner_type: 'it', full_name: 'Ada Lovelace' },
    { user_id: 'u-9', owner_type: 'business', full_name: 'Grace Hopper' },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/it/technologies/TEC-3/overview']}>
            <Routes>
              <Route path="/it/technologies/:id/:tab" element={<TechnologyWorkspacePage />} />
              <Route path="/it/technologies" element={<div>list page</div>} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TechnologyWorkspacePage', () => {
  beforeEach(() => {
    auth.level = 'admin';
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    del.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/TEC-3') return { data: DETAIL };
      if (url === '/technologies/tech-1/relations') {
        return { data: { year: 2026, budget_column: { key: 'budget', label: 'Budget' }, budget_lines: null, contracts: [{ id: 'ct-1' }], projects: [], incidents: null, documents: [{ id: 'd-1' }], links: [{ id: 'l-1' }] } };
      }
      return { data: { items: [], has_more: false } };
    });
    patch.mockImplementation(async (_url: string, body: any) => ({ data: { ...DETAIL, ...body } }));
  });

  it('shows the reference, the name, the ready tabs and the tabs of the next lots disabled', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Microsoft SQL Server' })).toBeTruthy();
    expect(screen.getByTestId('reference').textContent).toBe('TEC-3');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, (tab as HTMLButtonElement).disabled])).toEqual([
      ['workspace.technology.tabs.overview', false],
      ['workspace.technology.tabs.servers', true],
      ['workspace.technology.tabs.applications', true],
      ['workspace.technology.tabs.operations', false],
      ['workspace.technology.tabs.compliance', false],
      ['workspace.technology.tabs.relations', false],
    ]);
    // The Relations badge counts the rows of the sections the caller sees.
    await waitFor(() => expect(tabs[5].getAttribute('data-badge')).toBe('3'));
    expect(screen.getByTestId('owners-workspace.technology.fields.itOwners').textContent).toBe('Ada Lovelace');
    expect(screen.queryByTestId('owners-workspace.technology.fields.businessOwners')).toBeNull();
    expect(screen.queryByText(/Grace Hopper/)).toBeNull();
  });

  it('lists the versions in the order of the API with their shared support state', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'workspace.technology.versions.title' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(['2022', '2019', '2012']);
    expect(Array.from(table.querySelectorAll('[data-status]')).map((el) => el.getAttribute('data-status'))).toEqual(['supported', 'extended', 'ended']);
    expect(within(table).getByText('workspace.technology.versions.status.ended')).toBeTruthy();
  });

  it('saves the description when the field loses focus', async () => {
    renderPage();
    const field = await screen.findByLabelText('workspace.technology.fields.description');
    fireEvent.change(field, { target: { value: 'Engine of the finance applications' } });
    fireEvent.blur(field);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/technologies/tech-1', { description: 'Engine of the finance applications' }));
  });

  it('adds a CPE identifier in the part:vendor:product form only', async () => {
    renderPage();
    const field = await screen.findByLabelText('workspace.technology.cpe.add');
    fireEvent.change(field, { target: { value: 'sql server' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByText('workspace.technology.cpe.invalid')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'A:Microsoft:SQL_Server_Express' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/technologies/tech-1', {
      cpe_products: ['a:microsoft:sql_server', 'a:microsoft:sql_server_express'],
    }));
  });

  it('adds, edits and deletes versions in the table', async () => {
    post.mockResolvedValue({ data: {} });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.technology.versions.add' }));
    fireEvent.change(screen.getByLabelText('workspace.technology.versions.label'), { target: { value: '2025' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/technologies/tech-1/versions', { label: '2025', standard_support_end: null, extended_support_end: null }));

    fireEvent.click(screen.getAllByRole('button', { name: 'workspace.technology.versions.edit' })[2]);
    patch.mockResolvedValueOnce({ data: {} });
    fireEvent.change(screen.getByLabelText('workspace.technology.versions.label'), { target: { value: '2012 SP4' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/technologies/tech-1/versions/v1', {
      label: '2012 SP4', standard_support_end: '2017-07-11', extended_support_end: '2022-07-12',
    }));

    // A version that servers name asks first; the one nobody names goes at once.
    del.mockResolvedValue({ data: {} });
    const removeButtons = screen.getAllByRole('button', { name: 'workspace.technology.versions.remove' });
    fireEvent.click(removeButtons[0]);
    await waitFor(() => expect(del).toHaveBeenCalledWith('/technologies/tech-1/versions/v2'));
    fireEvent.click(removeButtons[2]);
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/technologies/tech-1/versions/v1'));
  });

  it('replaces the IT owners', async () => {
    post.mockResolvedValueOnce({ data: [{ user_id: 'u-2', owner_type: 'it', full_name: 'Alan Turing' }] });
    renderPage();
    await screen.findByRole('heading', { name: 'Microsoft SQL Server' });
    await owners.onChange['workspace.technology.fields.itOwners'](['u-2']);
    // The business owners the API holds are kept: the screen writes the IT owners only.
    expect(post).toHaveBeenCalledWith('/technologies/tech-1/owners/bulk-replace', {
      owners: [{ user_id: 'u-9', owner_type: 'business' }, { user_id: 'u-2', owner_type: 'it' }],
    });
    await waitFor(() => expect(screen.getByTestId('owners-workspace.technology.fields.itOwners').textContent).toBe('Alan Turing'));
  });

  it('deletes after a confirmation that counts the usages', async () => {
    post.mockResolvedValueOnce({ data: { refused: [], removes: [{ type: 'assets', total: 2 }] } });
    del.mockResolvedValueOnce({ data: {} });
    renderPage();
    const actions = await screen.findAllByRole('button', { name: 'common:buttons.delete' });
    fireEvent.click(actions[0]);
    expect(await screen.findByText('workspace.technology.deleteMessageWithUsages')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.technology.deleteAnyway' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/technologies/tech-1'));
    expect(post).toHaveBeenCalledWith('/technologies/delete-check', { ids: ['tech-1'] });
    expect(await screen.findByText('list page')).toBeTruthy();
  });

  it('does not offer the delete when its check fails', async () => {
    post.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    renderPage();
    const actions = await screen.findAllByRole('button', { name: 'common:buttons.delete' });
    fireEvent.click(actions[0]);
    expect(await screen.findByText('workspace.technology.messages.deleteCheckFailed')).toBeTruthy();
    expect(screen.queryByText('workspace.technology.deleteMessage')).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it('says when the owners could not be saved', async () => {
    post.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    renderPage();
    await screen.findByRole('heading', { name: 'Microsoft SQL Server' });
    await owners.onChange['workspace.technology.fields.itOwners'](['u-2']);
    expect(await screen.findByText('workspace.technology.messages.saveFailed')).toBeTruthy();
  });

  it('refuses a CPE identifier the server would refuse', async () => {
    renderPage();
    const field = await screen.findByLabelText('workspace.technology.cpe.add');
    fireEvent.change(field, { target: { value: 'a:vendor:prod+' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByText('workspace.technology.cpe.invalid')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows no writing control to a reader', async () => {
    auth.level = 'reader';
    renderPage();
    await screen.findByRole('heading', { name: 'Microsoft SQL Server' });
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'workspace.technology.versions.add' })).toBeNull();
    expect(screen.queryByLabelText('workspace.technology.cpe.add')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'workspace.technology.versions.edit' })).toEqual([]);
    expect((screen.getByLabelText('workspace.technology.fields.description') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
