import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
      {props.nav && (
        <div data-testid="nav">
          <button disabled={!props.nav.hasPrev} onClick={props.nav.onPrev}>{props.nav.previousLabel}</button>
          <span>{`${props.nav.currentIndex} / ${props.nav.totalCount}`}</span>
          <button disabled={!props.nav.hasNext} onClick={props.nav.onNext}>{props.nav.nextLabel}</button>
        </div>
      )}
      <h1>{props.title}</h1>
      <div role="tablist">
        {props.tabs.map((tab: any) => <button key={tab.key} role="tab" disabled={tab.disabled} data-badge={tab.badge ?? ''}>{tab.label}</button>)}
      </div>
      <div>{props.metadata}</div>
      <div>{props.actions}</div>
      <div data-testid="workspace-notices">{props.notices}</div>
      <aside>{props.properties}</aside>
      <main>{props.children}</main>
    </div>
  ),
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: (props: { table: string; recordId: string }) => <div data-testid="record-history">{`${props.table}:${props.recordId}`}</div>,
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
  hosting_type: 'on_prem',
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(entry = '/it/technologies/TEC-3/overview') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/it/technologies/:id/:tab" element={<TechnologyWorkspacePage />} />
              <Route path="/it/technologies/TEC-9/:tab" element={<LocationProbe />} />
              <Route path="/it/technologies" element={<div>list page</div>} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The CPE identifiers sit in the identifiers group, folded when the technology has one. */
async function openIdentifiers() {
  fireEvent.click(await screen.findByRole('button', { name: /workspace\.technology\.identifiers\.title/ }));
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

  it('shows the position in the list and opens the next technology on the same tab, with the list sort and filters', async () => {
    const base = get.getMockImplementation()!;
    get.mockImplementation(async (url: string, config?: any) => {
      if (url === '/technologies/ids') return { data: { ids: ['tech-0', 'tech-1', 'tech-9'], refs: ['TEC-1', 'TEC-3', 'TEC-9'], total: 3 } };
      return base(url, config);
    });
    const filters = JSON.stringify({ family: { filterType: 'set', values: ['database'] } });
    renderPage(`/it/technologies/TEC-3/servers?sort=editor%3ADESC&filters=${encodeURIComponent(filters)}`);

    const nav = await screen.findByTestId('nav');
    expect(within(nav).getByText('2 / 3')).toBeInTheDocument();
    const idsCall = get.mock.calls.find(([url]) => url === '/technologies/ids')!;
    expect(idsCall[1].params).toMatchObject({ sort: 'editor:DESC', filters });
    expect(within(nav).getByRole('button', { name: 'workspace.technology.previous' })).toBeEnabled();

    fireEvent.click(within(nav).getByRole('button', { name: 'workspace.technology.next' }));
    expect(await screen.findByTestId('location')).toHaveTextContent(
      `/it/technologies/TEC-9/servers?sort=editor%3ADESC&filters=${encodeURIComponent(filters)}`,
    );
  });

  it('shows the reference, the name, the ready tabs and the tabs of the next lots disabled', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Microsoft SQL Server' })).toBeTruthy();
    expect(screen.getByTestId('reference').textContent).toBe('TEC-3');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, (tab as HTMLButtonElement).disabled])).toEqual([
      ['workspace.technology.tabs.overview', false],
      ['workspace.technology.tabs.servers', false],
      ['workspace.technology.tabs.applications', false],
      ['workspace.technology.tabs.operations', false],
      ['workspace.technology.tabs.compliance', false],
      ['workspace.technology.tabs.relations', false],
      ['workspace.technology.tabs.history', false],
    ]);
    // The Relations badge counts the rows of the sections the caller sees.
    await waitFor(() => expect(tabs[5].getAttribute('data-badge')).toBe('3'));
    expect(screen.getByTestId('owners-workspace.technology.fields.itOwners').textContent).toBe('Ada Lovelace');
    expect(screen.queryByTestId('owners-workspace.technology.fields.businessOwners')).toBeNull();
    expect(screen.queryByText(/Grace Hopper/)).toBeNull();
  });

  it('renders the technology history on the History tab', async () => {
    renderPage('/it/technologies/TEC-3/history');
    expect(await screen.findByTestId('record-history')).toHaveTextContent('technologies:tech-1');
    expect(screen.getByRole('tab', { name: 'workspace.technology.tabs.history' })).toBeInTheDocument();
  });

  it('counts the distinct servers in service it is installed on and the distinct applications in the tab badges', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/TEC-3') return { data: DETAIL };
      if (url === '/technologies/tech-1/assets') {
        return { data: { items: [
          { kind: 'installed', link_id: 'l-1', asset_id: 'a1', asset_status: 'active' },
          { kind: 'installed', link_id: 'l-2', asset_id: 'a1', asset_status: 'active' },
          { kind: 'installed', link_id: 'l-3', asset_id: 'a2', asset_status: 'retired' },
          { kind: 'carried', link_id: null, asset_id: 'a3', asset_status: 'active' },
          { kind: 'carried', link_id: null, asset_id: 'a1', asset_status: 'active' },
        ] } };
      }
      if (url === '/technologies/tech-1/applications') {
        return { data: { items: [{ kind: 'hosted', application_id: 'erp' }, { kind: 'declared', application_id: 'erp' }, { kind: 'declared', application_id: 'crm' }] } };
      }
      return { data: { items: [], has_more: false } };
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Microsoft SQL Server' });
    // a1 once; neither the retired a2 nor the carried a3.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'workspace.technology.tabs.servers' }).getAttribute('data-badge')).toBe('1'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'workspace.technology.tabs.applications' }).getAttribute('data-badge')).toBe('2'));
    // One read per tab.
    expect(get.mock.calls.filter(([url]) => url === '/technologies/tech-1/assets')).toHaveLength(1);
  });

  it('shows no applications badge when the applications cannot be read', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/technologies/TEC-3') return { data: DETAIL };
      if (url === '/technologies/tech-1/applications') return { data: { technology: {}, items: null } };
      return { data: { items: [], has_more: false } };
    });
    renderPage();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/technologies/tech-1/applications'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'workspace.technology.tabs.servers' }).getAttribute('data-badge')).toBe('0'));
    expect(screen.getByRole('tab', { name: 'workspace.technology.tabs.applications' }).getAttribute('data-badge')).toBe('');
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
    await openIdentifiers();
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

    // Every version asks first. Cancel leaves it; a used version names a different confirm action.
    del.mockResolvedValue({ data: {} });
    const removeButtons = screen.getAllByRole('button', { name: 'workspace.technology.versions.remove' });
    fireEvent.click(removeButtons[0]);
    const unusedDialog = await screen.findByRole('dialog');
    expect(within(unusedDialog).getByText('workspace.technology.versions.deleteUnused')).toBeTruthy();
    fireEvent.click(within(unusedDialog).getByRole('button', { name: 'buttons.cancel' }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(removeButtons[0]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/technologies/tech-1/versions/v2'));
    fireEvent.click(removeButtons[2]);
    const usedDialog = await screen.findByRole('dialog');
    expect(within(usedDialog).getByText('workspace.technology.versions.deleteUsed')).toBeTruthy();
    fireEvent.click(within(usedDialog).getByRole('button', { name: 'workspace.technology.deleteAnyway' }));
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
    await openIdentifiers();
    const field = await screen.findByLabelText('workspace.technology.cpe.add');
    fireEvent.change(field, { target: { value: 'a:vendor:prod+' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByText('workspace.technology.cpe.invalid')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it('accepts the punctuation the NVD escapes in its names', async () => {
    renderPage();
    await openIdentifiers();
    const field = await screen.findByLabelText('workspace.technology.cpe.add');
    fireEvent.change(field, { target: { value: 'a:veeam:veeam_backup_\\&_replication' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/technologies/tech-1', {
      cpe_products: ['a:microsoft:sql_server', 'a:veeam:veeam_backup_\\&_replication'],
    }));
  });

  it('shows no writing control to a reader', async () => {
    auth.level = 'reader';
    renderPage();
    await screen.findByRole('heading', { name: 'Microsoft SQL Server' });
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'workspace.technology.versions.add' })).toBeNull();
    await openIdentifiers();
    expect(screen.queryByLabelText('workspace.technology.cpe.add')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'workspace.technology.versions.edit' })).toEqual([]);
    expect((screen.getByLabelText('workspace.technology.fields.description') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
