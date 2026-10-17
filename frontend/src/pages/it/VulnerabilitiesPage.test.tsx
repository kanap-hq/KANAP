import '../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import VulnerabilitiesPage from './VulnerabilitiesPage';
import type { VulnerabilityDetail, VulnerabilityItem } from './vulnerabilities/vulnerabilityTypes';

vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const auth = vi.hoisted(() => ({ level: 'member' as 'reader' | 'member' | 'none' }));
const RANK: Record<string, number> = { none: 0, reader: 1, member: 2, admin: 3 };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => RANK[auth.level] >= RANK[level] }),
}));
const features = vi.hoisted(() => ({ vulnerabilityFeed: true }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('../ForbiddenPage', () => ({ default: () => <div>Forbidden</div> }));

const getMock = vi.mocked(api.get);
const patchMock = vi.mocked(api.patch);
const CVE = 'CVE-2026-1001';

const VERSION_980 = {
  id: 'row-1', technology_version_id: 'v-980', version_label: '9.0.80', potential: false, match_basis: 'version_in_range',
  matching: true, state: 'to_review' as const, note: null, state_changed_at: null, state_changed_by_name: null,
};
const VERSION_UNKNOWN = {
  ...VERSION_980, id: 'row-2', technology_version_id: null, version_label: null, potential: true, match_basis: 'version_unknown',
};
const ITEM: VulnerabilityItem = {
  cve_id: CVE,
  summary: 'Remote code execution in the connector',
  cvss_score: 9.8,
  severity: 'critical',
  cvss_version: '3.1',
  published_at: '2026-09-30T00:00:00.000Z',
  technologies: [{ technology_id: 'tech-1', reference: 'TEC-1', name: 'Tomcat', editor: 'Apache', versions: [VERSION_980, VERSION_UNKNOWN] }],
  servers: 2,
  applications: null,
};
const DETAIL: VulnerabilityDetail = {
  ...ITEM,
  cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
  reference_urls: ['https://example.com/advisory'],
  servers_list: [
    { asset_id: 'a-1', name: 'SRV-WEB-01', reference: null, technology_id: 'tech-1', technology_name: 'Tomcat', version_label: '9.0.80', via_asset_name: null },
    { asset_id: 'a-2', name: 'VM-APP-02', reference: null, technology_id: 'tech-1', technology_name: 'Tomcat', version_label: null, via_asset_name: 'ESX-01' },
  ],
  applications_list: null,
};

function route(items: VulnerabilityItem[] = [ITEM], detail: VulnerabilityDetail = DETAIL) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/vulnerabilities') return { data: { items, total: items.length, limit: 100, offset: 0 } } as any;
    if (url === `/vulnerabilities/${CVE}`) return { data: detail } as any;
    if (url === '/technologies/filter-values') return { data: { editor: ['Apache', 'Oracle'] } } as any;
    if (url === '/technologies') return { data: { items: [{ id: 'tech-1', reference: 'TEC-1', name: 'Tomcat' }] } } as any;
    throw new Error(`unexpected ${url}`);
  });
}

function renderPage(path = '/it/vulnerabilities') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}><VulnerabilitiesPage /></MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const listParams = () => getMock.mock.calls.filter(([url]) => url === '/vulnerabilities').map(([, config]) => (config as any).params);
const lastListParams = () => listParams()[listParams().length - 1];

describe('VulnerabilitiesPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    auth.level = 'member';
    features.vulnerabilityFeed = true;
    route();
  });

  it('shows nothing and reads nothing while the vulnerability feed is off', () => {
    features.vulnerabilityFeed = false;
    const { container } = renderPage();
    expect(container.textContent).toBe('');
    expect(getMock).not.toHaveBeenCalled();
  });

  it('refuses a user without the infrastructure read right', () => {
    auth.level = 'none';
    renderPage();
    expect(screen.getByText('Forbidden')).toBeTruthy();
  });

  it('lists what is to review by default, critical in orange', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    expect(listParams()[0]).toEqual({ state: 'to_review', limit: 100 });
    const row = within(table).getByText(CVE).closest('tr')!;
    expect(row.textContent).toContain('Critical9.8');
    expect(row.textContent).toContain('TEC-1 Tomcat 9.0.80, Version not recorded (potentially concerned)');
    expect(row.textContent).toContain('To review');
    const severity = row.querySelector('[data-severity="critical"]') as HTMLElement;
    expect(getComputedStyle(severity).color).toBe('rgb(180, 83, 9)');
    // Without the right to read the applications, the column is left out.
    expect(within(table).queryByRole('columnheader', { name: 'Applications' })).toBeNull();
  });

  it('filters by severity, by technology from the URL, and by every state', async () => {
    renderPage('/it/vulnerabilities?technology=TEC-1');
    await screen.findByRole('table', { name: 'Vulnerabilities' });
    expect(listParams()[0]).toEqual({ state: 'to_review', technology: 'TEC-1', limit: 100 });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Severity' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Critical' }));
    await waitFor(() => expect(lastListParams()).toEqual({ severity: 'critical', state: 'to_review', technology: 'TEC-1', limit: 100 }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'State' }));
    fireEvent.click(await screen.findByRole('option', { name: 'All' }));
    await waitFor(() => expect(lastListParams()).toEqual({ severity: 'critical', technology: 'TEC-1', limit: 100 }));
  });

  it('says what to do when nothing is to review', async () => {
    route([]);
    renderPage();
    expect((await screen.findByTestId('vulnerabilities-empty')).textContent).toContain('CPE identifiers');
  });

  it('opens a CVE: its servers with the way through, and one line for hidden applications', async () => {
    renderPage();
    fireEvent.click(await screen.findByText(CVE));
    const detail = await screen.findByTestId('vulnerability-detail');
    expect(getMock).toHaveBeenCalledWith(`/vulnerabilities/${CVE}`);
    expect(detail.textContent).toContain('CVSS:3.1/AV:N');
    expect(within(detail).getByRole('link', { name: 'SRV-WEB-01' }).getAttribute('href')).toBe('/it/assets/a-1');
    expect(detail.textContent).toContain('VM-APP-02 · Tomcat Version not recorded (potentially concerned) · through ESX-01');
    expect(detail.textContent).toContain('The applications are hidden');
  });

  it('changes the state of one version for a member', async () => {
    patchMock.mockResolvedValue({ data: { ok: true } } as any);
    renderPage();
    fireEvent.click(await screen.findByText(CVE));
    await screen.findByTestId('vulnerability-detail');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'State of 9.0.80' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Handled' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith(`/technologies/tech-1/vulnerabilities/${CVE}`, { state: 'handled', technology_version_id: 'v-980' }));
    const note = screen.getByRole('textbox', { name: 'Note on Version not recorded (potentially concerned)' });
    fireEvent.change(note, { target: { value: 'Not exposed' } });
    fireEvent.blur(note);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith(`/technologies/tech-1/vulnerabilities/${CVE}`, { note: 'Not exposed', technology_version_id: null }));
  });

  it('shows the states without controls to a reader', async () => {
    auth.level = 'reader';
    renderPage();
    fireEvent.click(await screen.findByText(CVE));
    await screen.findByTestId('vulnerability-detail');
    expect(screen.queryByRole('combobox', { name: 'State of 9.0.80' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Note on/ })).toBeNull();
  });
});
