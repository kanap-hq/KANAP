import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import ConnectionEndpointPicker from './ConnectionEndpointPicker';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

const apiGet = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => ({ entities: [] as Array<{ code: string; label: string }> }));
vi.mock('../../../api', () => ({ default: { get: apiGet } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ settings: { entities: settings.entities }, labelFor: (_field: string, code: string) => code }),
}));

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

function renderPicker(
  value = { asset_id: null as string | null, entity_code: null as string | null },
  initialAsset: ServerOption | null = null,
  onChange = vi.fn(),
  label = 'Destination',
) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ConnectionEndpointPicker
        label={label}
        value={value}
        initialAsset={initialAsset}
        onChange={onChange}
      />
    </ThemeProvider>,
  );
}

describe('ConnectionEndpointPicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiGet.mockReset();
    settings.entities = [];
  });

  it('shows the cluster mark and the members of a cluster in the list', async () => {
    apiGet.mockResolvedValue({ data: { items: [CLUSTER] } });
    renderPicker();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /PAR-SQL-CL01/ });
    expect(option.querySelector('[role="img"][aria-label="Cluster"]')).not.toBeNull();
    expect(option.textContent).toContain('PAR-SQL-01, PAR-SQL-02');
  });

  it('carries the cluster mark in the field of a chosen cluster', async () => {
    apiGet.mockResolvedValue({ data: { items: [] } });
    renderPicker({ asset_id: CLUSTER.id, entity_code: null }, CLUSTER);
    const input = await screen.findByDisplayValue('AST-10 · PAR-SQL-CL01');
    expect(input).toHaveAccessibleName('Destination');
    expect(screen.getByRole('img', { name: 'Cluster' })).toBeInTheDocument();
  });

  it('names the server combobox after its label, not after the placeholder', async () => {
    apiGet.mockResolvedValue({ data: { items: [] } });
    renderPicker({ asset_id: null, entity_code: null }, null, vi.fn(), 'Source');
    const input = screen.getByRole('combobox', { name: 'Source' });
    expect(input).toHaveAttribute('placeholder', 'e.g., AST-12 or hostname');
    expect(screen.getByText('Source')).toBeInTheDocument();
  });

  it('names the entity select after its label', () => {
    settings.entities = [{ code: 'hq', label: 'Headquarters' }];
    renderPicker({ asset_id: null, entity_code: 'hq' }, null, vi.fn(), 'Source');
    expect(screen.getByRole('combobox', { name: 'Source' })).toHaveTextContent('Headquarters');
  });

  it('hands the chosen option to onChange', async () => {
    const onChange = vi.fn();
    apiGet.mockResolvedValue({ data: { items: [CLUSTER] } });
    renderPicker({ asset_id: null, entity_code: null }, null, onChange);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /PAR-SQL-CL01/ }));
    expect(onChange).toHaveBeenCalledWith({ asset_id: CLUSTER.id, entity_code: null }, CLUSTER);
  });
});
