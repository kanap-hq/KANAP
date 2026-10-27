import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';

const settings = vi.hoisted(() => ({
  data: {
    serverKinds: [{ code: 'physical_server', label: 'Physical Server' }],
    serverProviders: [{ code: 'azure', label: 'Azure' }, { code: 'other', label: 'Other' }],
    hostingTypes: [{ code: 'on_prem', label: 'On-prem' }],
  } as {
    serverKinds: { code: string; label: string }[];
    serverProviders: { code: string; label: string }[];
    hostingTypes: { code: string; label: string }[];
  },
}));

vi.mock('../../hooks/useItOpsSettings', () => ({
  useItOpsSettings: () => ({ data: settings.data }),
  default: () => ({ data: settings.data }),
}));

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

const SHIPPED_SETTINGS = {
  serverKinds: [{ code: 'physical_server', label: 'Physical Server' }],
  serverProviders: [{ code: 'azure', label: 'Azure' }, { code: 'other', label: 'Other' }],
  hostingTypes: [{ code: 'on_prem', label: 'On-prem' }],
};

describe('renderServerOption', () => {
  beforeEach(async () => {
    settings.data = {
      serverKinds: SHIPPED_SETTINGS.serverKinds.map((item) => ({ ...item })),
      serverProviders: SHIPPED_SETTINGS.serverProviders.map((item) => ({ ...item })),
      hostingTypes: SHIPPED_SETTINGS.hostingTypes.map((item) => ({ ...item })),
    };
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

  it('describes a server with catalog labels in French, never the stored codes', async () => {
    await i18n.changeLanguage('fr');
    renderOption(option({ environment: 'PROD', kind: 'physical_server', provider: 'on_prem' }), { noMembers: 'Aucun membre déclaré' });
    const hint = screen.getByText('Prod · Serveur physique · Sur site');
    expect(hint).not.toBeVisible();
    expect(screen.getByText('PAR-SQL-01')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/physical_server|on_prem|\bPROD\b/);
  });

  it('uses the server provider name when the catalog lists the code there', async () => {
    await i18n.changeLanguage('fr');
    renderOption(option({ environment: 'pre_prod', kind: 'physical_server', provider: 'azure' }), { noMembers: 'Aucun membre déclaré' });
    expect(screen.getByText('Pré-prod · Serveur physique · Azure')).toBeInTheDocument();
  });

  it('keeps a server kind the tenant renamed', async () => {
    settings.data = {
      ...settings.data,
      serverKinds: [{ code: 'physical_server', label: 'Bare metal' }],
    };
    await i18n.changeLanguage('fr');
    renderOption(option({ environment: 'prod', kind: 'physical_server', provider: 'on_prem' }), { noMembers: 'Aucun membre déclaré' });
    expect(screen.getByText('Prod · Bare metal · Sur site')).toBeInTheDocument();
  });
});
