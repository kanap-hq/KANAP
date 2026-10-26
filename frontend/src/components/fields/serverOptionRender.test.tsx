import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { renderServerOption, type ServerOption } from './serverOptionRender';

const option = (overrides: Partial<ServerOption> = {}): ServerOption => ({
  id: 'srv-1',
  name: 'PAR-SQL-01',
  environment: 'prod',
  kind: 'vm',
  provider: 'vmware',
  ...overrides,
});

function renderOption(value: ServerOption, config: { noMembers: string; showReference?: boolean }) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ul>{renderServerOption({} as React.HTMLAttributes<HTMLLIElement>, value, config)}</ul>
    </ThemeProvider>,
  );
}

describe('renderServerOption', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows a cluster with its mark and its members', () => {
    renderOption(option({ is_cluster: true, member_names: ['PAR-SQL-02', 'PAR-SQL-03'] }), { noMembers: 'No members declared' });
    expect(screen.getByText('PAR-SQL-01')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cluster' })).toBeInTheDocument();
    expect(screen.getByText('PAR-SQL-02, PAR-SQL-03')).toBeInTheDocument();
  });

  it('says that a cluster has no declared member', () => {
    renderOption(option({ is_cluster: true, member_names: [] }), { noMembers: 'No members declared' });
    expect(screen.getByText('No members declared')).toBeInTheDocument();
  });

  it('leaves a server without the cluster mark', () => {
    renderOption(option({ member_names: ['PAR-SQL-02'] }), { noMembers: 'No members declared' });
    expect(screen.getByText('PAR-SQL-01')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Cluster' })).toBeNull();
    expect(screen.queryByText('PAR-SQL-02')).toBeNull();
  });

  it('prefixes the reference when asked', () => {
    renderOption(option({ asset_reference: 'AST-71' }), { noMembers: 'No members declared', showReference: true });
    expect(screen.getByText('AST-71 · PAR-SQL-01')).toBeInTheDocument();
  });

  it('keeps the name alone without the reference', () => {
    renderOption(option({ asset_reference: 'AST-71' }), { noMembers: 'No members declared' });
    expect(screen.getByText('PAR-SQL-01')).toBeInTheDocument();
    expect(screen.queryByText(/AST-71/)).toBeNull();
  });
});
