import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import AssetConnectionsSection, { type ServerConnectionRow } from './AssetConnectionsSection';

const apiGet = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);
vi.mock('../../../api', () => ({ default: { get: apiGet } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (_field: string, code: string) => code }),
}));

const CLUSTER = { id: 'cl-1', name: 'PAR-SQL-CL01' };

const row = (overrides: Partial<ServerConnectionRow> = {}): ServerConnectionRow => ({
  id: 'c-1',
  connection_reference: 'CONN-1',
  name: 'App to DB',
  topology: 'server_to_server',
  lifecycle: 'active',
  protocol_labels: ['HTTPS'],
  source_label: 'APP-01',
  destination_label: 'DB-01',
  asset_roles: [],
  inherited: false,
  via_clusters: [],
  servers: [],
  ...overrides,
});

function renderSection(rows: ServerConnectionRow[], fail = false) {
  if (fail) apiGet.mockRejectedValue({});
  else apiGet.mockResolvedValue({ data: { items: rows } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <AssetConnectionsSection assetId="asset-1" />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const clusterRole = (extra: Record<string, unknown> = {}) => ({
  part: 'server' as const,
  hop_order: null,
  inherited: true,
  via_clusters: [CLUSTER],
  ...extra,
});

describe('AssetConnectionsSection', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('names the cluster an inherited connection goes through, with a link to it', async () => {
    renderSection([row({
      asset_roles: [clusterRole()],
      inherited: true,
      via_clusters: [CLUSTER],
    })]);
    const link = await screen.findByRole('link', { name: 'PAR-SQL-CL01' });
    expect(link.getAttribute('href')).toBe('/it/assets/cl-1/overview');
    expect(link.closest('td')?.textContent).toContain('components.clusterAssignment.via');
  });

  it('says the hop an asset carries', async () => {
    renderSection([row({
      asset_roles: [{ part: 'hop', hop_order: 2, inherited: false }],
    })]);
    expect(await screen.findByText('workspace.connection.path.hop')).toBeInTheDocument();
  });

  it('says both the hop and the inherited cluster', async () => {
    renderSection([row({
      asset_roles: [clusterRole({ part: 'hop', hop_order: 2 })],
      inherited: true,
      via_clusters: [CLUSTER],
    })]);
    const nameCell = (await screen.findByText('App to DB')).closest('td')!;
    expect(nameCell.textContent).toContain('workspace.connection.path.hop');
    expect(nameCell.textContent).toContain('components.clusterAssignment.via');
    expect(nameCell.textContent).toContain('PAR-SQL-CL01');
  });

  it('names the cluster of an inherited hop next to the hops the asset carries itself', async () => {
    renderSection([row({
      asset_roles: [
        { part: 'hop', hop_order: 1, inherited: true, via_clusters: [CLUSTER] },
        { part: 'hop', hop_order: 2, inherited: false, via_clusters: [] },
      ],
      inherited: false,
      via_clusters: [CLUSTER],
    })]);
    const nameCell = (await screen.findByText('App to DB')).closest('td')!;
    expect(nameCell.textContent).toBe(
      'App to DBworkspace.connection.path.hop · components.clusterAssignment.via PAR-SQL-CL01, workspace.connection.path.hop',
    );
  });

  it('lists the servers of a multi-server connection and marks a cluster, without an empty dash', async () => {
    renderSection([row({
      topology: 'multi_server',
      source_label: null,
      destination_label: null,
      servers: [
        { id: 'srv-1', name: 'PAR-SQL-01', is_cluster: false },
        { id: 'cl-1', name: 'PAR-SQL-CL01', is_cluster: true },
      ],
    })]);
    const line = (await screen.findByText('CONN-1')).closest('tr')!;
    expect(line.textContent).toContain('PAR-SQL-01');
    expect(line.textContent).toContain('PAR-SQL-CL01');
    expect(line.querySelector('[role="img"][aria-label="pages.assets.columns.cluster"]')).not.toBeNull();
    expect(screen.queryByText('-')).toBeNull();
  });

  it('adds no second line to a connection the asset carries directly', async () => {
    renderSection([row({
      asset_roles: [{ part: 'source', hop_order: null, inherited: false }],
    })]);
    await screen.findByText('App to DB');
    expect(screen.queryByText('workspace.connection.path.hop')).toBeNull();
    expect(screen.queryByText(/components.clusterAssignment.via/)).toBeNull();
  });

  it('says when the asset has no connection', async () => {
    renderSection([]);
    expect(await screen.findByText('workspace.asset.connections.noConnections')).toBeInTheDocument();
  });

  it('shows the read error', async () => {
    renderSection([], true);
    expect(await screen.findByText('messages.loadConnectionsFailed')).toBeInTheDocument();
  });
});
