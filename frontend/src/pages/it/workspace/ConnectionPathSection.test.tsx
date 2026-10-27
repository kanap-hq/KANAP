import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import ConnectionPathSection, { type ConnectionPathHop } from './ConnectionPathSection';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const enumOptions = vi.hoisted(() => ({
  settings: {
    connectionTypes: [] as Array<{ code: string; label: string }>,
    pathHopFunctions: [] as Array<{ code: string; label: string; deprecated?: boolean }>,
  },
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({ default: () => enumOptions }));

const CLUSTER: ServerOption = {
  id: 'cl-1',
  name: 'PAR-SQL-CL01',
  asset_reference: 'AST-10',
  environment: 'prod',
  kind: 'vm',
  provider: 'vmware',
  is_cluster: true,
  member_names: ['PAR-SQL-01', 'PAR-SQL-02'],
};

const HOP: ConnectionPathHop = {
  id: 'hop-1',
  order_index: 1,
  function_code: null,
  equipment_asset_id: CLUSTER.id,
  equipment_entity_code: null,
  equipment_asset: CLUSTER,
  protocol_codes: [],
  port_override: null,
  notes: null,
};

describe('ConnectionPathSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    enumOptions.settings.pathHopFunctions = [];
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: { items: [] } });
  });

  it('shows the cluster of the endpoints and of a hop, without reading the hop asset again', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ConnectionPathSection
          connectionId="c-1"
          hops={[HOP]}
          canManage={false}
          sourceLabel="PAR-SRC-CL01"
          destinationLabel="PAR-DST-CL01"
          sourceIsCluster
          destinationIsCluster
          onChange={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(await screen.findByDisplayValue('AST-10 · PAR-SQL-CL01')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Cluster' })).toHaveLength(3);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls.some(([url]) => url === `/assets/${CLUSTER.id}`)).toBe(false);
  });

  it('shows the translated suffix on a deprecated hop function', async () => {
    await i18n.changeLanguage('fr');
    enumOptions.settings.pathHopFunctions = [
      { code: 'firewall', label: 'Firewall' },
      { code: 'proxy', label: 'Proxy', deprecated: true },
    ];
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <ConnectionPathSection
          connectionId="c-1"
          hops={[{ ...HOP, function_code: 'proxy' }]}
          canManage
          sourceLabel="PAR-SRC-CL01"
          destinationLabel="PAR-DST-CL01"
          onChange={vi.fn()}
        />
      </ThemeProvider>,
    );

    const hopFunction = screen.getAllByRole('combobox').find((node) => node.textContent?.includes('Proxy'));
    expect(hopFunction).toBeTruthy();
    fireEvent.mouseDown(hopFunction!);
    expect(await screen.findByRole('option', { name: 'Proxy (plus proposé)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Firewall' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: / \(deprecated\)$/ })).toBeNull();
  });
});
