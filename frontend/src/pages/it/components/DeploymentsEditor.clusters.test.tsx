import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design/KanapDialogProvider';
import { ApplicationFeedbackProvider } from '../applicationFeedback';
import DeploymentsEditor, { type DeploymentRecord } from './DeploymentsEditor';

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());

vi.mock('../../../api', () => ({
  default: { get: apiGet, post: apiPost, patch: apiPatch, delete: vi.fn() },
}));

vi.mock('../../../hooks/useItOpsEnumOptions', () => {
  const byField = {
    serverRole: [{ code: 'db', label: 'db' }, { code: 'app', label: 'app' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
  };
  return { default: () => ({ byField, labelFor: (_field: string, code: string) => code }) };
});

const deployment: DeploymentRecord = {
  id: 'dep-1',
  application_id: 'app-1',
  environment: 'prod',
  lifecycle: 'active',
  base_url: null,
  sso_enabled: false,
  mfa_supported: false,
  status: 'enabled',
  notes: null,
};

const row = (id: string, serverId: string, name: string, role: string, extra: Record<string, unknown> = {}) => ({
  id,
  app_instance_id: 'dep-1',
  server_id: serverId,
  role,
  since_date: null,
  notes: null,
  inherited: false,
  via_clusters: [],
  members: [],
  asset: { is_cluster: false },
  server: { id: serverId, name, provider: 'on_prem', environment: 'prod' },
  ...extra,
});

/** What the reads answer; each test sets it. */
const wire = {
  rows: [] as unknown[],
  groupable: [] as unknown[],
  picked: { id: 'sql-1', name: 'PAR-SQL-01' } as { id: string; name: string },
  clusters: {} as Record<string, Array<{ id: string; name: string; status?: string }>>,
  members: {} as Record<string, Array<{ id: string; name: string; status?: string }>>,
};

function route(url: string) {
  if (url.endsWith('/deployment-servers')) return { data: { items: wire.rows, groupable: wire.groupable } };
  const clusters = url.match(/^\/assets\/([^/]+)\/clusters$/);
  if (clusters) return { data: { items: wire.clusters[clusters[1]] ?? [] } };
  const members = url.match(/^\/assets\/([^/]+)\/members$/);
  if (members) return { data: { items: wire.members[members[1]] ?? [] } };
  // The server picker reads the asset of the row being edited.
  if (url === '/assets/cl-1') return { data: { id: 'cl-1', name: 'PAR-SQL-CL01', status: 'active', is_cluster: true } };
  if (url === `/assets/${wire.picked.id}`) return { data: { ...wire.picked, status: 'active' } };
  const memberNames = (wire.picked as { is_cluster?: boolean }).is_cluster
    ? { member_names: (wire.members[wire.picked.id] ?? []).map((member) => member.name) }
    : {};
  return { data: { items: [{ ...wire.picked, environment: 'prod', kind: 'vm', provider: 'on_prem', ...memberNames }] } };
}

function renderEditor(readOnly = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <ApplicationFeedbackProvider onError={vi.fn()}>
              <DeploymentsEditor applicationId="app-1" applicationName="CheeseTrack" deployments={[deployment]} onRefresh={vi.fn()} readOnly={readOnly} />
            </ApplicationFeedbackProvider>
          </KanapDialogProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens the "Add server" dialog, picks the server the search proposes, chooses the role and saves. */
async function addPickedServer(role = 'db') {
  fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
  const dialog = await screen.findByRole('dialog');
  const [serverInput] = within(dialog).getAllByRole('combobox');
  fireEvent.mouseDown(serverInput);
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(wire.picked.name) }));
  if (role !== 'db') {
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1] ?? within(dialog).getByRole('button', { name: /db/ }));
    fireEvent.click(await screen.findByRole('option', { name: role }));
  }
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
}

/** Edits the cluster's row, picks the server the search proposes, then saves. */
async function moveClusterRowToPickedServer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit PAR-SQL-CL01' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(wire.picked.name) }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
}

const CL01 = { id: 'cl-1', name: 'PAR-SQL-CL01', status: 'active' };
const SQL1 = { id: 'sql-1', name: 'PAR-SQL-01', status: 'active' };
const SQL2 = { id: 'sql-2', name: 'PAR-SQL-02', status: 'active' };
const SQL3 = { id: 'sql-3', name: 'PAR-SQL-03', status: 'active' };
const SQL4 = { id: 'sql-4', name: 'PAR-SQL-04', status: 'active' };
const SQL5 = { id: 'sql-5', name: 'PAR-SQL-05', status: 'active' };

describe('DeploymentsEditor: clusters', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiPost.mockResolvedValue({ data: { absorbed: [] } });
    wire.rows = [];
    wire.groupable = [];
    wire.picked = { id: 'sql-1', name: 'PAR-SQL-01' };
    wire.clusters = {};
    wire.members = {};
    apiGet.mockImplementation((url: string) => Promise.resolve(route(url)));
  });

  it('shows the members under their cluster, marked as inherited, without actions, then the direct rows', async () => {
    wire.rows = [
      row('a-direct', 'srv-9', 'CAVE-EDGE-01', 'app'),
      row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', {
        asset: { is_cluster: true },
        members: [
          { asset_id: 'sql-1', name: 'PAR-SQL-01', asset_reference: 'AST-1' },
          { asset_id: 'sql-2', name: 'PAR-SQL-02', asset_reference: 'AST-2' },
        ],
      }),
    ];
    const { container } = renderEditor();
    await screen.findByRole('link', { name: 'PAR-SQL-CL01' });
    expect(screen.getByRole('img', { name: 'Cluster' })).toBeTruthy();
    const names = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('a')?.textContent);
    expect(names).toEqual(['PAR-SQL-CL01', 'PAR-SQL-01', 'PAR-SQL-02', 'CAVE-EDGE-01']);
    const inherited = container.querySelectorAll('tr[data-inherited="true"]');
    expect(inherited).toHaveLength(2);
    expect(inherited[0].querySelectorAll('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Remove PAR-SQL-01' })).toBeNull();
  });

  it('asks whether to assign to the cluster, and posts the cluster', async () => {
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2];
    renderEditor();
    await addPickedServer();
    const question = await screen.findByText('Assign to the cluster?');
    const dialog = question.closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByText('PAR-SQL-01 is part of PAR-SQL-CL01. Its 2 members will host CheeseTrack (Prod, db).')).toBeTruthy();
    expect(within(dialog).queryByText(/will be replaced/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to the cluster' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/app-deployments/dep-1/servers', expect.objectContaining({ server_id: 'cl-1', role: 'db' })));
  });

  it('posts the server itself when the answer is "This server only"', async () => {
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2];
    renderEditor();
    await addPickedServer();
    fireEvent.click(await screen.findByRole('button', { name: 'This server only' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/app-deployments/dep-1/servers', expect.objectContaining({ server_id: 'sql-1' })));
  });

  it('posts nothing when the question is cancelled', async () => {
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2];
    renderEditor();
    await addPickedServer();
    const question = await screen.findByText('Assign to the cluster?');
    fireEvent.click(within(question.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Assign to the cluster?')).toBeNull());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('asks to choose the cluster for a member of two clusters', async () => {
    const cl2 = { id: 'cl-2', name: 'PAR-SQL-CL02', status: 'active' };
    wire.clusters['sql-1'] = [CL01, cl2];
    wire.members['cl-1'] = [SQL1, SQL2];
    wire.members['cl-2'] = [SQL1];
    renderEditor();
    await addPickedServer();
    const question = await screen.findByText('Assign to the cluster?');
    const dialog = question.closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByText('PAR-SQL-01 is part of several clusters.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: /PAR-SQL-CL02/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to the cluster' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/app-deployments/dep-1/servers', expect.objectContaining({ server_id: 'cl-2' })));
  });

  it('asks nothing for a server of no cluster', async () => {
    renderEditor();
    await addPickedServer();
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/app-deployments/dep-1/servers', expect.objectContaining({ server_id: 'sql-1' })));
    expect(screen.queryByText('Assign to the cluster?')).toBeNull();
  });

  it('refuses without a question when the cluster already carries this role', async () => {
    wire.rows = [row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true }, members: [{ asset_id: 'sql-1', name: 'PAR-SQL-01' }] })];
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2];
    renderEditor();
    await addPickedServer();
    const alert = await within(await screen.findByRole('dialog')).findByRole('alert');
    expect(alert.textContent).toBe('Already hosted by this server through PAR-SQL-CL01.');
    expect(screen.queryByText('Assign to the cluster?')).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('says which direct assignment the cluster will replace', async () => {
    wire.rows = [row('a-2', 'sql-2', 'PAR-SQL-02', 'db')];
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2];
    renderEditor();
    await addPickedServer();
    expect(await screen.findByText('The direct assignment of PAR-SQL-02 will be replaced.')).toBeTruthy();
  });

  it('proposes a cluster in the server picker, marked and with its members', async () => {
    wire.picked = { id: 'cl-1', name: 'PAR-SQL-CL01', is_cluster: true } as any;
    wire.members['cl-1'] = [SQL1, SQL2];
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
    const option = await screen.findByRole('option');
    expect(await within(option).findByText('PAR-SQL-01, PAR-SQL-02')).toBeTruthy();
    expect(within(option).getByRole('img', { name: 'Cluster' })).toBeTruthy();
    const filters = apiGet.mock.calls.filter(([url]) => url === '/assets').map(([, config]) => config.params.filters);
    expect(filters.every((value) => value === undefined)).toBe(true);
    // The members come with the list, in one read.
    expect(apiGet.mock.calls.filter(([url]) => url === '/assets').every(([, config]) => config.params.include === 'member_names')).toBe(true);
    expect(apiGet).not.toHaveBeenCalledWith('/assets/cl-1/members', expect.anything());
  });

  it('says which direct rows a cluster chosen directly replaces, and posts it on the answer', async () => {
    wire.picked = { id: 'cl-1', name: 'PAR-SQL-CL01', is_cluster: true } as any;
    wire.members['cl-1'] = [SQL1, SQL2];
    wire.rows = [row('a-1', 'sql-1', 'PAR-SQL-01', 'db')];
    renderEditor();
    await addPickedServer();
    const dialog = (await screen.findByText('The direct assignment of PAR-SQL-01 will be replaced.')).closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).queryByRole('button', { name: 'This server only' })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to the cluster' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/app-deployments/dep-1/servers', expect.objectContaining({ server_id: 'cl-1', role: 'db' })));
  });

  it('proposes to group the direct rows on the cluster, after a confirmation', async () => {
    wire.rows = [row('a-1', 'sql-1', 'PAR-SQL-01', 'db'), row('a-2', 'sql-2', 'PAR-SQL-02', 'db')];
    wire.groupable = [{ cluster_id: 'cl-1', cluster_name: 'PAR-SQL-CL01', app_instance_id: 'dep-1', role: 'db', member_ids: ['sql-1', 'sql-2'] }];
    renderEditor();
    expect(await screen.findByText('db on PAR-SQL-01, PAR-SQL-02')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assign to PAR-SQL-CL01' }));
    expect(await screen.findByText('CheeseTrack will stay available as long as one member stands.')).toBeTruthy();
    expect(screen.getByText('Assign to the cluster?')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Assign to the cluster' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/app-deployments/dep-1/servers', { server_id: 'cl-1', role: 'db' }));
    // The list shows the cluster row once it is read again: no notice.
    expect(screen.queryByText('Assigned to the cluster')).toBeNull();
    expect(screen.queryByText('Server added')).toBeNull();
  });

  it('warns which members stop hosting when a cluster row moves onto one of them', async () => {
    wire.rows = [row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true } })];
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2, SQL3];
    apiPatch.mockResolvedValue({ data: {} });
    renderEditor();
    await moveClusterRowToPickedServer();
    expect(await screen.findByText('PAR-SQL-02 and PAR-SQL-03 will no longer host CheeseTrack.')).toBeTruthy();
    expect(screen.getByText('Move the assignment?')).toBeTruthy();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('writes nothing when the move is cancelled', async () => {
    wire.rows = [row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true } })];
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2, SQL3];
    apiPatch.mockResolvedValue({ data: {} });
    renderEditor();
    await moveClusterRowToPickedServer();
    const line = await screen.findByText('PAR-SQL-02 and PAR-SQL-03 will no longer host CheeseTrack.');
    fireEvent.click(within(line.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('PAR-SQL-02 and PAR-SQL-03 will no longer host CheeseTrack.')).toBeNull());
    expect(apiPatch).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('writes the row when the move is confirmed', async () => {
    wire.rows = [row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true } })];
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2, SQL3];
    apiPatch.mockResolvedValue({ data: {} });
    renderEditor();
    await moveClusterRowToPickedServer();
    const line = await screen.findByText('PAR-SQL-02 and PAR-SQL-03 will no longer host CheeseTrack.');
    fireEvent.click(within(line.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'Move anyway' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/app-deployments/dep-1/servers/a-cl', expect.objectContaining({ server_id: 'sql-1', role: 'db' })));
  });

  it('asks nothing when the chosen server is the only member in service', async () => {
    wire.rows = [row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true } })];
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, { id: 'sql-2', name: 'PAR-SQL-02', status: 'retired' }];
    apiPatch.mockResolvedValue({ data: {} });
    renderEditor();
    await moveClusterRowToPickedServer();
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/app-deployments/dep-1/servers/a-cl', expect.objectContaining({ server_id: 'sql-1', role: 'db' })));
    expect(screen.queryByText('Move the assignment?')).toBeNull();
  });

  it('asks nothing when the chosen server is not a member of the cluster', async () => {
    wire.rows = [row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true } })];
    wire.picked = { id: 'sql-9', name: 'PAR-SQL-09' };
    apiPatch.mockResolvedValue({ data: {} });
    renderEditor();
    await moveClusterRowToPickedServer();
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/app-deployments/dep-1/servers/a-cl', expect.objectContaining({ server_id: 'sql-9', role: 'db' })));
    expect(screen.queryByText('Move the assignment?')).toBeNull();
  });

  it('names three other members then counts the rest', async () => {
    wire.rows = [row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true } })];
    wire.clusters['sql-1'] = [CL01];
    wire.members['cl-1'] = [SQL1, SQL2, SQL3, SQL4, SQL5];
    apiPatch.mockResolvedValue({ data: {} });
    renderEditor();
    await moveClusterRowToPickedServer();
    expect(await screen.findByText('PAR-SQL-02, PAR-SQL-03, PAR-SQL-04, and 1 other will no longer host CheeseTrack.')).toBeTruthy();
  });

  it('shows a reader the inherited rows and no group line or button', async () => {
    wire.rows = [
      row('a-1', 'sql-1', 'PAR-SQL-01', 'db'),
      row('a-cl', 'cl-1', 'PAR-SQL-CL01', 'db', { asset: { is_cluster: true }, members: [{ asset_id: 'sql-2', name: 'PAR-SQL-02' }] }),
    ];
    wire.groupable = [{ cluster_id: 'cl-1', cluster_name: 'PAR-SQL-CL01', app_instance_id: 'dep-1', role: 'db', member_ids: ['sql-1', 'sql-2'] }];
    renderEditor(true);
    expect(await screen.findByRole('link', { name: 'PAR-SQL-02' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Assign to/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add server' })).toBeNull();
  });
});
