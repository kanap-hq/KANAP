import '../../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { createAppTheme } from '../../../config/ThemeContext';
import TechnologyVulnerabilitiesSection, { type TechnologyVulnerabilityRow } from './TechnologyVulnerabilitiesSection';

vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const navigate = vi.hoisted(() => vi.fn());
const features = vi.hoisted(() => ({ vulnerabilityFeed: true }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<any>()), useNavigate: () => navigate }));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

const row = (over: Partial<TechnologyVulnerabilityRow>): TechnologyVulnerabilityRow => ({
  id: 'row-1', cve_id: 'CVE-2026-1001', summary: 'Flaw', cvss_score: 9.8, severity: 'critical',
  technology_version_id: 'v-1', version_label: '9.0.80', potential: false, match_basis: 'version_in_range', matching: true,
  state: 'to_review', note: null, state_changed_at: null, state_changed_by_name: null, ...over,
});

function renderSection(canEdit: boolean, path = '/it/technologies/TEC-7/compliance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('dark')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}><TechnologyVulnerabilitiesSection technologyId="tech-1" canEdit={canEdit} /></MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('TechnologyVulnerabilitiesSection', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    navigate.mockReset();
    features.vulnerabilityFeed = true;
    getMock.mockResolvedValue({
      data: {
        technology: { id: 'tech-1', name: 'Tomcat', reference: 'TEC-7' },
        items: [
          row({}),
          row({ id: 'row-3', technology_version_id: 'v-2', version_label: '10.1.5' }),
          row({ id: 'row-2', cve_id: 'CVE-2026-1002', severity: 'medium', cvss_score: 5.3, technology_version_id: null, version_label: null, potential: true, state: 'handled' }),
        ],
      },
    } as any);
  });

  it('lists the CVE of the technology with their severity, version and state', async () => {
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    expect(getMock).toHaveBeenCalledWith('/technologies/tech-1/vulnerabilities');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).textContent).toMatch(/^Vulnerabilities2/);
    expect(rows[0].textContent).toBe('CVE-2026-1001Critical9.89.0.80To review');
    expect(rows[2].textContent).toBe('CVE-2026-1002Medium5.3Version not recorded (potentially concerned)Handled');
    // Critical in orange (dark mode), medium neutral.
    expect(getComputedStyle(rows[0].querySelector('[data-severity="critical"]') as HTMLElement).color).toBe('rgb(240, 168, 48)');
    fireEvent.click(rows[0]);
    expect(navigate).toHaveBeenCalledWith('/it/vulnerabilities?technology=TEC-7&version=9.0.80&state=all&alerts=all&q=CVE-2026-1001');
    fireEvent.click(rows[2]);
    expect(navigate).toHaveBeenLastCalledWith('/it/vulnerabilities?technology=TEC-7&version=none&state=all&alerts=all&q=CVE-2026-1002');
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Change' })).toBeNull();
  });

  it('says the technology is excluded from alerts when no version stays included', async () => {
    getMock.mockResolvedValue({
      data: { technology: { id: 'tech-1', reference: 'TEC-7' }, technology_alerts: false, versions_included: 0, versions_excluded: 2, items: [row({})] },
    } as any);
    renderSection(true, '/it/technologies/TEC-7/compliance?q=tom&sort=name');
    expect(await screen.findByText('Excluded from alerts')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change' }).getAttribute('href')).toBe('/it/technologies/TEC-7/overview?q=tom&sort=name#technology-versions');
  });

  it('gives a reader the line without the link to the settings', async () => {
    getMock.mockResolvedValue({
      data: { technology: { id: 'tech-1', reference: 'TEC-7' }, technology_alerts: false, versions_included: 0, versions_excluded: 2, items: [row({})] },
    } as any);
    renderSection(false);
    expect(await screen.findByText('Excluded from alerts')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Change' })).toBeNull();
  });

  it('names the versions that stay included when the technology is excluded', async () => {
    getMock.mockResolvedValue({
      data: { technology: { id: 'tech-1', reference: 'TEC-7' }, technology_alerts: false, versions_included: 2, versions_excluded: 3, items: [row({})] },
    } as any);
    renderSection(true);
    expect(await screen.findByText('Excluded from alerts, except 2 versions')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change' })).toBeTruthy();
  });

  it('names the versions excluded when the technology stays included', async () => {
    getMock.mockResolvedValue({
      data: { technology: { id: 'tech-1', reference: 'TEC-7' }, technology_alerts: true, versions_included: 4, versions_excluded: 1, items: [row({ alerts: false })] },
    } as any);
    renderSection(true);
    expect(await screen.findByText('1 version excluded from alerts')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change' })).toBeTruthy();
  });

  it('dims a row that does not raise an alert', async () => {
    getMock.mockResolvedValue({
      data: {
        technology: { id: 'tech-1', reference: 'TEC-7' },
        technology_alerts: true,
        versions_excluded: 0,
        items: [row({ alerts: true }), row({ id: 'row-quiet', cve_id: 'CVE-2026-1009', alerts: false, version_label: '8.5' })],
      },
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    const body = within(table).getAllByRole('row').slice(1);
    const versionCell = (rowEl: HTMLElement) => rowEl.querySelectorAll('td')[2];
    expect(getComputedStyle(versionCell(body[1])).color).toBe('rgb(129, 136, 149)');
    expect(getComputedStyle(versionCell(body[0])).color).not.toBe('rgb(129, 136, 149)');
    expect(versionCell(body[1]).textContent).toBe('8.5Excluded from alerts');
    expect(versionCell(body[0]).textContent).toBe('9.0.80');
  });

  it('tells a row that no longer matches from a row out of the alerts', async () => {
    getMock.mockResolvedValue({
      data: {
        technology: { id: 'tech-1', reference: 'TEC-7' },
        technology_alerts: true,
        versions_excluded: 1,
        items: [
          row({ id: 'row-old', matching: false, alerts: true, version_label: '9.0.70' }),
          row({ id: 'row-quiet', cve_id: 'CVE-2026-1009', alerts: false, version_label: '8.5' }),
        ],
      },
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    const [old, quiet] = within(table).getAllByRole('row').slice(1).map((rowEl) => rowEl.querySelectorAll('td')[2]);
    expect(old.textContent).toBe('9.0.70No longer matches');
    expect(quiet.textContent).toBe('8.5Excluded from alerts');
  });

  it('matches the technology again for a member', async () => {
    postMock.mockResolvedValue({ data: { ok: true, added: 2, updated: 0, removed: 1, unmatched: 0 } } as any);
    renderSection(true);
    await screen.findByRole('table', { name: 'Vulnerabilities' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/technologies/tech-1/vulnerabilities/rematch'));
    expect((await screen.findByRole('status')).textContent).toBe('Matched again: 2 new, 1 removed.');
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('renders nothing and reads nothing while the feed is off', () => {
    features.vulnerabilityFeed = false;
    const { container } = renderSection(true);
    expect(container.textContent).toBe('');
    expect(getMock).not.toHaveBeenCalled();
  });

  it('says in one line that the search is under way while a product is being collected', async () => {
    getMock.mockResolvedValue({
      data: { technology: { id: 'tech-1', reference: 'TEC-7' }, products: [{ product: 'a:apache:tomcat', status: 'pending' }], items: [] },
    } as any);
    renderSection(true);
    expect(await screen.findByText('Searching for vulnerabilities…')).toBeTruthy();
    expect(screen.queryByText('No known vulnerability concerns this technology.')).toBeNull();
  });

  it('says in one line that nothing concerns the technology', async () => {
    getMock.mockResolvedValue({ data: { technology: { id: 'tech-1', reference: 'TEC-7' }, items: [] } } as any);
    renderSection(true);
    expect(await screen.findByText('No known vulnerability concerns this technology.')).toBeTruthy();
  });
});
