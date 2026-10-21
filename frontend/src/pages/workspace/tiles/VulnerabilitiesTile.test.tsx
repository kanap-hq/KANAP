import React from 'react';
import '../../../i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VulnerabilitiesTile, { type VulnerabilityHomeSummary } from './VulnerabilitiesTile';
import { createAppTheme } from '../../../config/ThemeContext';
import { api as apiClient } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const SETTINGS = { data: { businessCriticalityLevels: [{ code: 'business_critical', label: 'Critical' }, { code: 'high', label: 'High' }] } };
vi.mock('../../../hooks/useLocalizedItOpsSettings', () => ({ useLocalizedItOpsSettings: () => SETTINGS }));

const EMPTY: VulnerabilityHomeSummary = {
  top_criticality_applications: { criticality: 'business_critical', count: 0 },
  critical_published: { last_7_days: 0, last_30_days: 0 },
  exploited: 0,
  assets_with_severe: 0,
  stale_sources: [],
};

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

function renderTile(mode: 'light' | 'dark' = 'light') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme(mode)}>
        <MemoryRouter initialEntries={['/']}>
          <Where />
          <Routes>
            {/* The tile stays on every path, so each line can be followed in turn. */}
            <Route path="*" element={<VulnerabilitiesTile />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('VulnerabilitiesTile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['light', 'dark'] as const)('shows one line when nothing needs attention (%s)', async (mode) => {
    (apiClient.get as any).mockResolvedValue(EMPTY);
    renderTile(mode);
    expect(await screen.findByText('No critical vulnerability to review.')).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/vulnerabilities/home-summary');
  });

  it('lists only the non-zero lines, each with its link', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...EMPTY,
      top_criticality_applications: { criticality: 'business_critical', count: 3 },
      critical_published: { last_7_days: 0, last_30_days: 2 },
      exploited: 1,
      assets_with_severe: 4,
    });
    renderTile();

    expect(await screen.findByRole('button', { name: '3 Critical applications with a critical or high CVE' })).toBeInTheDocument();
    expect(screen.queryByText(/last 7 days/)).not.toBeInTheDocument();
    expect(screen.queryByText('No critical vulnerability to review.')).not.toBeInTheDocument();

    const cases: Array<[string, string]> = [
      ['3 Critical applications with a critical or high CVE', '/it/applications?vulnerabilities=severe&criticality=business_critical'],
      ['2 critical CVEs published in the last 30 days', '/it/vulnerabilities?published=30d&severity=critical&estate=1'],
      ['1 CVE known to be exploited', '/it/vulnerabilities?exploited=1&estate=1'],
      ['4 assets with a critical or high CVE', '/it/assets?vulnerabilities=severe'],
    ];
    for (const [label, to] of cases) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      // Exact: lines 2 and 3 count the CVE touching the estate, and their page shows the same.
      expect(screen.getByTestId('where').textContent).toBe(to);
    }
  });

  it.each(['light', 'dark'] as const)('titles the tile on the estate and sets the count apart, in the severity colour for critical and exploited lines (%s)', async (mode) => {
    (apiClient.get as any).mockResolvedValue({ ...EMPTY, critical_published: { last_7_days: 0, last_30_days: 2 }, assets_with_severe: 4 });
    renderTile(mode);
    expect(await screen.findByText('Vulnerabilities in your estate')).toBeInTheDocument();
    expect(screen.getByText('CVE to review on technologies in use')).toBeInTheDocument();
    const critical = await screen.findByRole('button', { name: '2 critical CVEs published in the last 30 days' });
    const assets = screen.getByRole('button', { name: '4 assets with a critical or high CVE' });
    const criticalCount = critical.querySelector('[data-count]')!;
    const assetsCount = assets.querySelector('[data-count]')!;
    expect(criticalCount.textContent).toBe('2');
    expect(getComputedStyle(criticalCount).fontVariantNumeric).toBe('tabular-nums');
    // The critical line takes the severity colour; the assets line stays neutral.
    expect(getComputedStyle(criticalCount).color).not.toBe(getComputedStyle(assetsCount).color);
  });

  it('links the 7 days line to the page with its period, severity and the estate filter', async () => {
    (apiClient.get as any).mockResolvedValue({ ...EMPTY, critical_published: { last_7_days: 1, last_30_days: 1 } });
    renderTile();
    fireEvent.click(await screen.findByRole('button', { name: '1 critical CVE published in the last 7 days' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/it/vulnerabilities?published=7d&severity=critical&estate=1');
  });

  it('leaves out the applications line without the applications right', async () => {
    (apiClient.get as any).mockResolvedValue({ ...EMPTY, top_criticality_applications: null, exploited: 2 });
    renderTile();
    expect(await screen.findByRole('button', { name: '2 CVEs known to be exploited' })).toBeInTheDocument();
    expect(screen.queryByText(/applications/)).not.toBeInTheDocument();
  });

  it('warns at the bottom about a source not read for more than 3 days', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...EMPTY,
      stale_sources: [{ source: 'nvd', last_success_at: '2026-10-15T08:00:00Z', days: 5 }],
    });
    renderTile();
    expect(await screen.findByText('The NVD has not been read for 5 days')).toBeInTheDocument();
    // Set apart at the bottom, after the lines.
    expect(screen.getByTestId('vulnerabilities-tile-warnings')).toHaveTextContent('The NVD has not been read for 5 days');
    expect(screen.getByText('No critical vulnerability to review.').compareDocumentPosition(screen.getByTestId('vulnerabilities-tile-warnings')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('No critical vulnerability to review.')).toBeInTheDocument();
  });

  it('opens the vulnerabilities page from View all', async () => {
    (apiClient.get as any).mockResolvedValue(EMPTY);
    renderTile();
    fireEvent.click(await screen.findByRole('button', { name: 'View all' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/it/vulnerabilities');
  });
});

