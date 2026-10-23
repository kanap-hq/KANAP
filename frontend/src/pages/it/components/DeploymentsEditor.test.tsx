import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design/KanapDialogProvider';
import DeploymentsEditor, { type DeploymentRecord } from './DeploymentsEditor';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('../../../api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: {}, labelFor: () => '' }),
}));

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

function renderEditor(readOnly: boolean) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <KanapDialogProvider>
          <DeploymentsEditor applicationId="app-1" deployments={[deployment]} onRefresh={vi.fn()} readOnly={readOnly} />
        </KanapDialogProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('DeploymentsEditor servers', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      data: {
        items: [
          {
            id: 'asg-1',
            app_instance_id: 'dep-1',
            server_id: 'srv-1',
            role: 'web',
            since_date: null,
            notes: null,
            server: { id: 'srv-1', name: 'CAVE-EDGE-01', provider: 'on_prem', environment: 'prod' },
          },
        ],
      },
    });
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
    const view = (deployments: DeploymentRecord[]) => (
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <KanapDialogProvider>
            <DeploymentsEditor applicationId="app-1" deployments={deployments} onRefresh={vi.fn()} readOnly />
          </KanapDialogProvider>
        </ThemeProvider>
      </MemoryRouter>
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
    apiGet.mockResolvedValue({
      data: { items: [{ id: 'asg-2', app_instance_id: 'dep-1', server_id: 'srv-2', role: 'web', since_date: null, notes: null, server: null }] },
    });
    renderEditor(true);
    await screen.findByText('web');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
