import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { createAppTheme } from '../../../config/ThemeContext';
import TechnologyComplianceTab from './TechnologyComplianceTab';
import type { TechnologyDetail } from './TechnologyOverviewTab';

const catalog = {
  businessCriticalityLevels: [],
  dataClasses: [],
  cyberCriticalityLevels: [
    { code: 'moderate', label: 'Moderate', description: 'Significant but contained harm', rank: 2 },
    { code: 'critical', label: 'Critical', description: 'Catastrophic consequences', rank: 4 },
  ],
  recoveryWaves: [
    { code: 'foundation', label: 'V0 — Foundation', description: 'Shared prerequisites', order: 0 },
    { code: 'vital', label: 'V1 — Vital activities', description: 'Restore vital activities', order: 1 },
  ],
};
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: catalog }) }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const features = vi.hoisted(() => ({ vulnerabilityFeed: false }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));

const TECHNOLOGY = {
  id: 'tech-1', reference: 'TEC-1', name: 'Active Directory', editor: 'Microsoft', family: 'directory', hosting_type: 'on_prem', lifecycle: 'active',
  description: null, notes: null, cpe_products: [], replaced_by_id: null, replaced_by: null, versions: [], owners: [],
  cyber_criticality: 'critical', recovery_wave: null, rto_minutes: null, rpo_minutes: 60,
} as TechnologyDetail;

function renderTab(canManage = true, technology: TechnologyDetail = TECHNOLOGY) {
  const onPatch = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <TechnologyComplianceTab technology={technology} canManage={canManage} onPatch={onPatch} />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onPatch };
}

describe('TechnologyComplianceTab', () => {
  beforeEach(() => {
    features.vulnerabilityFeed = false;
    vi.mocked(api.get).mockReset();
  });

  it('shows the continuity classification without the business, data and review parts of the application', () => {
    renderTab();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Choose a recovery wave')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Recovery point objective' })).toHaveValue(1);
    expect(screen.queryByText('Business criticality')).not.toBeInTheDocument();
    expect(screen.queryByText('Data confidentiality')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as reviewed' })).not.toBeInTheDocument();
  });

  it('saves the recovery wave and the cyber criticality as soon as they are chosen', () => {
    const { onPatch } = renderTab();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Recovery wave' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('V1 — Vital activities'));
    expect(onPatch).toHaveBeenLastCalledWith({ recovery_wave: 'vital' });

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cyber criticality' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Moderate'));
    expect(onPatch).toHaveBeenLastCalledWith({ cyber_criticality: 'moderate' });
  });

  it('saves the RTO in minutes when the field loses focus', () => {
    const { onPatch } = renderTab();
    const rto = screen.getByRole('spinbutton', { name: 'Recovery time objective' });
    fireEvent.change(rto, { target: { value: '4' } });
    fireEvent.blur(rto);
    expect(onPatch).toHaveBeenLastCalledWith({ rto_minutes: 240 });
  });

  it('is read-only without the right to manage the technology', () => {
    renderTab(false);
    expect(screen.getByRole('combobox', { name: 'Recovery wave' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('spinbutton', { name: 'Recovery time objective' })).toBeDisabled();
  });

  it('shows the vulnerabilities of the technology under the continuity classification', async () => {
    features.vulnerabilityFeed = true;
    vi.mocked(api.get).mockResolvedValue({
      data: {
        technology: { id: 'tech-1', reference: 'TEC-1' },
        items: [{
          id: 'row-1', cve_id: 'CVE-2026-1001', summary: 'Flaw', cvss_score: 9.8, severity: 'critical',
          technology_version_id: 'v-1', version_label: '16', potential: false, match_basis: 'version_in_range', matching: true,
          state: 'to_review', note: null, state_changed_at: null, state_changed_by_name: null,
        }],
      },
    } as never);
    renderTab();
    expect(await screen.findByRole('region', { name: 'Vulnerabilities' })).toBeInTheDocument();
    expect(await screen.findByText('CVE-2026-1001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/technologies/tech-1/vulnerabilities');
  });

  it('hides the vulnerabilities while the feed is off', () => {
    renderTab();
    expect(screen.queryByRole('region', { name: 'Vulnerabilities' })).not.toBeInTheDocument();
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });
});
