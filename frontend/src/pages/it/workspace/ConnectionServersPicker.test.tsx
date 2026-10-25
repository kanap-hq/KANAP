import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import ConnectionServersPicker from './ConnectionServersPicker';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get: apiGet } }));

const SERVER: ServerOption = {
  id: 'srv-1',
  name: 'PAR-SQL-01',
  asset_reference: 'AST-1',
  environment: 'prod',
  kind: 'vm',
  provider: 'vmware',
};

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

function renderPicker(value: ServerOption[], onChange = vi.fn()) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ConnectionServersPicker value={value} onChange={onChange} placeholder="Add a server" />
    </ThemeProvider>,
  );
}

describe('ConnectionServersPicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: { items: [SERVER, CLUSTER] } });
  });

  it('adds a server from the search and removes it from its chip', async () => {
    const onChange = vi.fn();
    const { rerender } = renderPicker([], onChange);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'AST-1 · PAR-SQL-01' }));
    expect(onChange.mock.calls[0][0]).toEqual([SERVER]);

    rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <ConnectionServersPicker value={[SERVER]} onChange={onChange} placeholder="Add a server" />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId('CancelIcon'));
    expect(onChange.mock.calls[1][0]).toEqual([]);
  });

  it('marks the chip of a cluster', () => {
    renderPicker([CLUSTER]);
    expect(screen.getByText('AST-10 · PAR-SQL-CL01')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cluster' })).toBeInTheDocument();
  });

  it('shows a cluster in the list with its members', async () => {
    renderPicker([]);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /PAR-SQL-CL01/ });
    expect(option.textContent).toContain('PAR-SQL-01, PAR-SQL-02');
    expect(option.querySelector('[role="img"][aria-label="Cluster"]')).not.toBeNull();
  });
});
