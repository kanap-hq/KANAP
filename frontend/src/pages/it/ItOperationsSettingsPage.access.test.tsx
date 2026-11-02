import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import ItOperationsSettingsPage from './ItOperationsSettingsPage';
import type { ItOpsSettings } from '../../services/itOpsSettings';

const harness = vi.hoisted(() => ({
  level: 'reader' as 'reader' | 'admin',
}));

const rank: Record<string, number> = { reader: 1, admin: 4 };

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (
      resource === 'settings' && (rank[harness.level] ?? 0) >= (rank[level] ?? 99)
    ),
  }),
}));

const settings = {
  applicationCategories: [{ code: 'analytics', label: 'Analytics', deprecated: false }],
  hostingTypes: [{ code: 'colocation', label: 'Colocation', category: 'on_prem', deprecated: false }],
  serverKinds: [{ code: 'vm', label: 'Virtual machine', is_physical: false, deprecated: false }],
  serverRoles: [{ code: 'app', label: 'Application server', graph_tier: 'center', deprecated: false }],
  entities: [{ code: 'user', label: 'Directory user', graph_tier: 'top', deprecated: false }],
  adminZones: [{ code: 'tier_0', label: 'Tier 0', deprecated: false, admin_group: 'Domain admins', description: 'Identity core' }],
  connectionTypes: [{ code: 'https', label: 'HTTPS', category: 'Web', typicalPorts: '443', deprecated: false }],
  domains: [{ code: 'corp', label: 'Corp', dns_suffix: 'corp.example', deprecated: false, system: false, forest: 'corp.example', account_count: 12, machine_count: 4 }],
  subnets: [{ location_id: 'loc-1', cidr: '10.1.0.0/24', vlan_number: 20, network_zone: 'lan', description: 'Office', deprecated: false }],
  networkSegments: [{ code: 'lan', label: 'LAN', deprecated: false }],
  businessCriticalityLevels: [
    { code: 'critical', label: 'Critical', description: 'At most four hours', rank: 3, maxMtdMinutes: 240 },
    { code: 'high', label: 'High', description: 'Up to one day', rank: 2, maxMtdMinutes: 1440 },
  ],
  cyberCriticalityLevels: [{ code: 'critical', label: 'Critical', description: 'Catastrophic consequences', rank: 4 }],
  dataClasses: [{ code: 'restricted', label: 'Restricted', description: 'Strict disclosure controls', rank: 4 }],
  recoveryWaves: [{ code: 'vital', label: 'Vital', description: 'Restore first', order: 1 }],
  lifecycleStates: [{ code: 'proposed', label: 'Proposed', deprecated: false }],
  lockedCodes: { lifecycleStates: ['proposed'] },
  protectedCodes: {},
} as unknown as ItOpsSettings;

vi.mock('../../hooks/useItOpsSettings', () => ({
  default: () => ({ data: settings, isError: false }),
}));

vi.mock('../../hooks/useLocationOptions', () => ({
  useLocationOptions: () => ({ data: [{ id: 'loc-1', location_reference: 'LOC-1', name: 'HQ' }] }),
}));

vi.mock('../../api', () => ({
  default: { get: vi.fn(async () => ({ data: { total: 0, usage: [] } })), patch: vi.fn(), post: vi.fn() },
}));

vi.mock('./NetboxSyncPage', () => ({
  NetboxSyncPanel: () => <div>netbox panel</div>,
}));

const WRITE_BUTTONS = ['Add item', 'Remove', 'Edit catalog', 'Save changes', 'Add level', 'Move up', 'Move down', 'Drag to reorder', 'Add value'];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/it/settings']}>
            <ItOperationsSettingsPage />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function expandEveryList() {
  const summaries = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-expanded') === 'false');
  expect(summaries.length).toBeGreaterThan(10);
  summaries.forEach((button) => fireEvent.click(button));
}

function fields() {
  return [
    ...screen.queryAllByRole('textbox'),
    ...screen.queryAllByRole('spinbutton'),
    ...screen.queryAllByRole('checkbox'),
    ...screen.queryAllByRole('radio'),
    ...screen.queryAllByRole('combobox'),
  ];
}

/** A field the person cannot change: disabled, read-only, or an aria-disabled picker. */
function isLocked(control: HTMLElement) {
  const input = control as HTMLInputElement;
  return input.disabled === true
    || control.hasAttribute('disabled')
    || input.readOnly === true
    || control.getAttribute('aria-disabled') === 'true';
}

describe('IT settings write access', () => {
  afterEach(() => {
    harness.level = 'reader';
  });

  it('shows every value read-only to a settings reader', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Lists', selected: true })).toBeInTheDocument();
    expect(screen.getByText('Critical, High')).toBeInTheDocument();
    expandEveryList();

    WRITE_BUTTONS.forEach((name) => {
      expect(screen.queryAllByRole('button', { name })).toHaveLength(0);
    });
    expect(screen.queryAllByRole('button', { name: /Translate/ })).toHaveLength(0);

    const controls = fields();
    expect(controls.length).toBeGreaterThan(0);
    controls.forEach((control) => expect(isLocked(control)).toBe(true));
    expect(screen.getByDisplayValue('Analytics')).toBeDisabled();
    expect(screen.getByDisplayValue('Corp')).toBeDisabled();
    expect(screen.getByDisplayValue('10.1.0.0/24')).toBeDisabled();
    expect(screen.getByDisplayValue('Tier 0')).toBeDisabled();
  });

  it('keeps the lists editable for a settings administrator', () => {
    harness.level = 'admin';
    renderPage();
    expect(screen.getByRole('button', { name: 'Edit catalog' })).toBeInTheDocument();
    expect(screen.queryByText('Critical, High')).not.toBeInTheDocument();
    expandEveryList();

    expect(screen.getAllByRole('button', { name: 'Add item' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Drag to reorder' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: 'Save changes' })).toHaveLength(0);

    const controls = fields();
    expect(controls.some((control) => !isLocked(control))).toBe(true);
    expect(screen.getByDisplayValue('Analytics')).toBeEnabled();
    expect(screen.getByDisplayValue('Corp')).toBeEnabled();
    expect(screen.getByDisplayValue('Tier 0')).toBeEnabled();
    expect(screen.getByDisplayValue('Proposed')).toBeDisabled();
  });
});
