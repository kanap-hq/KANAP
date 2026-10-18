import '../../i18n';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page on the real grid (AG Grid under jsdom): its own selection column, alone, ticked by a
// click on the box or beside it, and by Space on the cell or on the header.
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { vulnerabilityFeed: true } } }) }));
vi.mock('../../config/ThemeContext', async (original) => ({ ...(await original() as any), useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));

import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import { flushAgGridTimers } from '../../test/agGridTimers';
import { stubOffsetParent } from '../../test/jsdomOffsetParent';
import VulnerabilitiesPage from './VulnerabilitiesPage';

const get = vi.mocked(api.get);
const ROW = {
  id: 'row-1', cve_id: 'CVE-2026-1001', summary: 'Flaw', cvss_score: 9.8, severity: 'critical', cvss_version: '3.1',
  published_at: '2026-09-30T00:00:00.000Z', technology: { id: 'tech-1', reference: 'TEC-1', name: 'Tomcat' }, editor: 'Apache',
  version: '9.0.80', technology_version_id: 'v-1', potential: false, state: 'to_review', note: null, servers: 1, applications: null,
};

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
const banner = () => screen.queryByTestId('vulnerabilities-selection')?.textContent ?? null;

describe('VulnerabilitiesPage on the real grid', () => {
  beforeEach(() => {
    stubOffsetParent();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
    get.mockReset();
    get.mockImplementation(async (url: string) => (url === '/vulnerabilities'
      ? { data: { items: [ROW], total: 3, cves: 2, page: 1, limit: 50 } }
      : { data: {} }) as any);
  });
  afterEach(async () => {
    cleanup();
    await flushAgGridTimers();
    vi.unstubAllGlobals();
  });

  it('has one box column, its own, ticked by click and by Space', async () => {
    const { container } = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/it/vulnerabilities']}><VulnerabilitiesPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
    const headers = Array.from(container.querySelectorAll('.ag-header-row-column .ag-header-cell')).map((cell) => cell.getAttribute('col-id'));
    expect(headers[0]).toBe('select');
    expect(headers).not.toContain('ag-Grid-ControlsColumn');
    expect(container.querySelector('.ag-row [col-id="ag-Grid-ControlsColumn"]')).toBeNull();
    // The total row, under the CVE column (never in the box column).
    const total = container.querySelector('.ag-floating-bottom [col-id="cve_id"]') as HTMLElement;
    expect(total.textContent).toBe('Total: 3 rows (2 CVE)');
    // It spans the row, whatever the width of its column (125 px).
    expect(parseInt(total.style.width, 10)).toBeGreaterThan(500);
    // The box column: the box alone, centred, no padding to cut it.
    const selectCell = container.querySelector('.ag-row:not(.ag-row-pinned) .ag-cell[col-id="select"]') as HTMLElement;
    expect([selectCell.style.padding, selectCell.style.justifyContent, selectCell.style.textOverflow]).toEqual(['0px', 'center', 'clip']);

    // The elements are read again after each step: AG Grid may draw a row again.
    const box = () => screen.getByRole('checkbox', { name: 'Select CVE-2026-1001, Tomcat 9.0.80' }) as HTMLInputElement;
    const cell = () => box().closest('.ag-cell') as HTMLElement;
    // A click on the box: ticked once.
    fireEvent.click(box());
    await settle();
    expect(box().checked).toBe(true);
    expect(banner()).toBe('1 row selected');
    // Space on the focused cell: unticked.
    cell().focus();
    fireEvent.keyDown(cell(), { key: ' ', code: 'Space' });
    await settle();
    expect(box().checked).toBe(false);
    // A click in the cell beside the box: ticked.
    fireEvent.click(cell());
    await settle();
    expect(box().checked).toBe(true);
    // Space on the header: every row of the filter.
    const header = container.querySelector('.ag-header-row-column .ag-header-cell[col-id="select"]') as HTMLElement;
    header.focus();
    fireEvent.keyDown(header, { key: ' ', code: 'Space' });
    await settle();
    expect(banner()).toBe('3 rows selected, whole filter');
    expect(box().checked).toBe(true);
    expect(screen.queryByTestId('vulnerability-detail')).toBeNull();
  }, 20_000);
});
