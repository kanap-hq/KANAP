import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design/KanapDialogProvider';
import DeploymentsEditor, { type DeploymentRecord } from './DeploymentsEditor';

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());

vi.mock('../../../api', () => ({
  default: { get: apiGet, post: apiPost, patch: apiPatch, delete: vi.fn() },
}));

vi.mock('../../../hooks/useItOpsEnumOptions', () => {
  const byField = {
    serverRole: [{ code: 'app', label: 'Application server' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }, { code: 'deprecated', label: 'Deprecated' }],
  };
  return { default: () => ({ byField, labelFor: () => '' }) };
});

const theme = createAppTheme('light');

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

function withProviders(ui: React.ReactElement, queryClient = new QueryClient()) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <KanapDialogProvider>{ui}</KanapDialogProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderEditor(readOnly: boolean, queryClient?: QueryClient, deployments: DeploymentRecord[] = [deployment]) {
  return render(withProviders(
    <DeploymentsEditor applicationId="app-1" deployments={deployments} onRefresh={vi.fn()} readOnly={readOnly} />,
    queryClient,
  ));
}

const serversPayload = {
  items: [
    {
      id: 'asg-1',
      app_instance_id: 'dep-1',
      server_id: 'srv-1',
      role: 'web',
      since_date: '2026-01-01T00:00:00.000Z',
      notes: null,
      server: { id: 'srv-1', name: 'CAVE-EDGE-01', provider: 'on_prem', environment: 'prod' },
    },
  ],
};

/** Routes the reads: the deployments' servers, then the server picker's search. */
function routeGets(url: string) {
  if (url.endsWith('/deployment-servers')) return Promise.resolve({ data: serversPayload });
  return Promise.resolve({ data: { items: [{ id: 'srv-9', name: 'PAR-ESX-09', environment: 'prod', kind: 'vm', provider: 'on_prem' }] } });
}

describe('DeploymentsEditor servers', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiGet.mockImplementation((url: string) => routeGets(url));
  });

  it.each([false, true])('links the server name to its asset page (read only: %s)', async (readOnly) => {
    renderEditor(readOnly);
    const link = await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    expect(link.getAttribute('href')).toBe('/it/assets/srv-1');
  });

  it('keeps the row actions and opens no dialog on a link click', async () => {
    renderEditor(false);
    const link = await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    fireEvent.click(link);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('button', { name: /CAVE-EDGE-01/ })).toHaveLength(2);
  });

  it('reads the servers of every deployment in one call, and not again when a deployment only changes', async () => {
    const qa: DeploymentRecord = { ...deployment, id: 'dep-2', environment: 'qa' };
    const queryClient = new QueryClient();
    const view = (deployments: DeploymentRecord[]) => withProviders(
      <DeploymentsEditor applicationId="app-1" deployments={deployments} onRefresh={vi.fn()} readOnly />,
      queryClient,
    );
    const { rerender } = render(view([deployment, qa]));
    await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/applications/app-1/deployment-servers');
    rerender(view([{ ...deployment, lifecycle: 'retired' }, { ...qa }]));
    await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('shows a dash for a row without a server', async () => {
    apiGet.mockImplementation(() => Promise.resolve({
      data: { items: [{ id: 'asg-2', app_instance_id: 'dep-1', server_id: 'srv-2', role: 'web', since_date: null, notes: null, server: null }] },
    }));
    renderEditor(true);
    await screen.findByText('web');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('addresses the server page by its reference when it has one', async () => {
    apiGet.mockImplementation(() => Promise.resolve({
      data: { items: [{ ...serversPayload.items[0], server: { ...serversPayload.items[0].server, asset_reference: 'AST-7' } }] },
    }));
    renderEditor(true);
    const link = await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    expect(link.getAttribute('href')).toBe('/it/assets/AST-7/overview');
  });

  it('shows the date since without a leading zero', async () => {
    renderEditor(true);
    await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    expect(screen.getByText('1 Jan 2026')).toBeTruthy();
  });

  it('lists the deployments in the one environment order and shows their notes', async () => {
    const deployments: DeploymentRecord[] = [
      { ...deployment, id: 'dep-d', environment: 'dev' },
      { ...deployment, id: 'dep-q', environment: 'qa', notes: 'Kept for the audit' },
      { ...deployment, id: 'dep-p', environment: 'prod' },
    ];
    renderEditor(true, undefined, deployments);
    await screen.findByText('Kept for the audit');
    const names = screen.getAllByText(/^(Prod|QA|Dev)$/).map((node) => node.textContent);
    expect(names).toEqual(['Prod', 'QA', 'Dev']);
  });

  it('keeps the row buttons visible when one of them has the focus', async () => {
    const { container } = renderEditor(false);
    await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    const hidden = container.querySelector('.hover-actions') as HTMLElement;
    const css = Array.from(document.querySelectorAll('style')).map((node) => node.textContent).join('');
    expect(hidden).toBeTruthy();
    expect(css).toMatch(/tr:focus-within \.hover-actions/);
  });

  it('shows the refusal of a server in the dialog, which stays open', async () => {
    apiPost.mockRejectedValue({ response: { status: 400, data: { code: 'assignment_duplicate', message: 'Asset already assigned with this role' } } });
    renderEditor(false);
    await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    const dialog = await screen.findByRole('dialog');
    const [serverInput] = within(dialog).getAllByRole('combobox');
    fireEvent.mouseDown(serverInput);
    fireEvent.click(await screen.findByText('PAR-ESX-09'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const alert = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(alert.textContent).toContain('already has this role');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('reads the technologies, the vulnerabilities and the counters again after a server change or a lifecycle change', async () => {
    apiPost.mockResolvedValue({ data: {} });
    apiPatch.mockResolvedValue({ data: {} });
    const queryClient = new QueryClient();
    for (const key of [
      ['application-relations', 'app-1'],
      ['vulnerabilities', 'application', 'app-1'],
      ['application-workspace-relations-count', 'app-1'],
    ]) queryClient.setQueryData(key, { stale: false });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderEditor(false, queryClient);
    await screen.findByRole('link', { name: 'CAVE-EDGE-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove CAVE-EDGE-01' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    for (const key of [
      ['application-relations', 'app-1'],
      ['vulnerabilities', 'application', 'app-1'],
      ['application-workspace-relations-count', 'app-1'],
    ]) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
