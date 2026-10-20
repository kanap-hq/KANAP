import '../../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import { createAppTheme } from '../../../config/ThemeContext';
import en from '../../../locales/en/it.json';
import fr from '../../../locales/fr/it.json';
import de from '../../../locales/de/it.json';
import es from '../../../locales/es/it.json';
import TechnologyVulnerabilitiesSection, { type TechnologyVulnerabilityVersion } from './TechnologyVulnerabilitiesSection';

vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const navigate = vi.hoisted(() => vi.fn());
const features = vi.hoisted(() => ({ vulnerabilityFeed: true }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<any>()), useNavigate: () => navigate }));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

const version = (over: Partial<TechnologyVulnerabilityVersion>): TechnologyVulnerabilityVersion => ({
  version_id: 'v-1', label: '10.1', alerts: true, installed: true, servers: 4,
  open: { critical: 2, high: 0, medium: 1, low: 0, none: 0 }, total: 5, ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  technology: { id: 'tech-1', name: 'Tomcat', reference: 'TEC-7' },
  technology_alerts: true,
  versions_excluded: 1,
  versions_included: 2,
  collecting: false,
  products: [],
  cves: 3,
  versions: [
    version({}),
    version({ version_id: 'v-2', label: '9.0', alerts: false, servers: 1, open: { critical: 0, high: 1, medium: 0, low: 0, none: 0 }, total: 1 }),
    version({ version_id: null, label: null, alerts: true, servers: 0, open: { critical: 0, high: 0, medium: 0, low: 0, none: 0 }, total: 2 }),
  ],
  ...over,
});

function renderSection(canEdit: boolean, path = '/it/technologies/TEC-7/compliance', mode: 'light' | 'dark' = 'dark') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme(mode)}>
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
    getMock.mockResolvedValue({ data: summary() } as any);
  });

  it('summarizes the versions, with the open CVE by severity and a link to the page', async () => {
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    expect(getMock).toHaveBeenCalledWith('/technologies/tech-1/vulnerabilities/summary');
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).textContent).toMatch(/^Vulnerabilities3/);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      '10.14Critical2Medium15See',
      '9.0Excluded from alerts1High11See',
      'Version not recorded (potentially concerned)002See',
    ]);
    expect(within(table).getByRole('columnheader', { name: 'To review' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Total' })).toBeTruthy();
    // Critical in orange (dark mode), the same dot as the Vulnerabilities page.
    expect(getComputedStyle(rows[0].querySelector('[data-severity="critical"]') as HTMLElement).color).toBe('rgb(240, 168, 48)');
    const links = within(table).getAllByRole('link', { name: 'See' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/it/vulnerabilities?technology=TEC-7&version=10.1&alerts=all',
      '/it/vulnerabilities?technology=TEC-7&version=9.0&alerts=all',
      '/it/vulnerabilities?technology=TEC-7&version=none&alerts=all',
    ]);
    expect(screen.getByRole('link', { name: 'See everything on the Vulnerabilities page' }).getAttribute('href'))
      .toBe('/it/vulnerabilities?technology=TEC-7&alerts=all');
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Change' })).toBeNull();
  });

  it('dims a version that stays out of the alerts', async () => {
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    const body = within(table).getAllByRole('row').slice(1);
    const versionCell = (rowEl: HTMLElement) => rowEl.querySelectorAll('td')[0];
    expect(getComputedStyle(versionCell(body[1])).color).toBe('rgb(129, 136, 149)');
    expect(getComputedStyle(versionCell(body[0])).color).not.toBe('rgb(129, 136, 149)');
  });

  it('says the technology is excluded from alerts when no version stays included', async () => {
    getMock.mockResolvedValue({
      data: summary({ technology_alerts: false, versions_included: 0, versions_excluded: 2, versions: [version({ alerts: false })] }),
    } as any);
    renderSection(true, '/it/technologies/TEC-7/compliance?q=tom&sort=name');
    const change = await screen.findByRole('link', { name: 'Change' });
    expect(change.parentElement?.textContent).toContain('Excluded from alerts');
    expect(change.getAttribute('href')).toBe('/it/technologies/TEC-7/overview?q=tom&sort=name#technology-versions');
  });

  it('gives a reader the line without the link to the settings', async () => {
    getMock.mockResolvedValue({
      data: summary({ technology_alerts: false, versions_included: 0, versions_excluded: 2, cves: 1, versions: [version({ alerts: true })] }),
    } as any);
    renderSection(false);
    expect(await screen.findByText('Excluded from alerts')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Change' })).toBeNull();
  });

  it('names the versions that stay included when the technology is excluded', async () => {
    getMock.mockResolvedValue({
      data: summary({ technology_alerts: false, versions_included: 2, versions_excluded: 3 }),
    } as any);
    renderSection(true);
    expect(await screen.findByText('Excluded from alerts, except 2 versions')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change' })).toBeTruthy();
  });

  it('names the versions excluded when the technology stays included', async () => {
    getMock.mockResolvedValue({
      data: summary({ technology_alerts: true, versions_included: 4, versions_excluded: 1 }),
    } as any);
    renderSection(true);
    expect(await screen.findByText('1 version excluded from alerts')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change' })).toBeTruthy();
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
      data: summary({ collecting: true, products: [{ product: 'a:apache:tomcat', status: 'pending' }], versions: [], cves: 0 }),
    } as any);
    renderSection(true);
    expect(await screen.findByText('Searching for vulnerabilities…')).toBeTruthy();
    expect(screen.queryByText('No known vulnerability concerns this technology.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'See everything on the Vulnerabilities page' })).toBeNull();
  });

  it('says in one line that nothing concerns the technology', async () => {
    getMock.mockResolvedValue({ data: summary({ versions: [], cves: 0 }) } as any);
    renderSection(true);
    expect(await screen.findByText('No known vulnerability concerns this technology.')).toBeTruthy();
  });

  it('shows 0 and no See for an installed version with no vulnerability', async () => {
    getMock.mockResolvedValue({
      data: summary({
        cves: 3,
        versions: [version({
          version_id: 'v-empty', label: '8.0', servers: 2,
          open: { critical: 0, high: 0, medium: 0, low: 0, none: 0 }, total: 0,
        })],
      }),
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    const row = within(table).getAllByRole('row')[1];
    expect(row.textContent).toBe('8.0200');
    expect(within(row).queryByRole('link', { name: 'See' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).textContent).toMatch(/^Vulnerabilities3/);
    expect(screen.queryByText('Not installed')).toBeNull();
  });

  it('names a version that is not installed and keeps its alert state', async () => {
    getMock.mockResolvedValue({
      data: summary({
        cves: 4,
        versions_excluded: 1,
        versions: [
          version({
            version_id: 'v-2025', label: '2025', alerts: true, installed: false, servers: 9,
            open: { critical: 3, high: 1, medium: 0, low: 0, none: 0 }, total: 4,
          }),
          version({ version_id: 'v-2019', label: '2019', alerts: false, installed: false, servers: 2, total: 1 }),
        ],
      }),
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      '2025Not installed',
      '2019Excluded from alertsNot installed',
    ]);
    expect(within(table).queryByRole('link', { name: 'See' })).toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Servers' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'To review' })).toBeTruthy();
    const label = within(rows[0]).getByText('Not installed');
    expect(label.closest('td')?.getAttribute('colspan')).toBe('3');
    expect(rows[0].querySelectorAll('td')).toHaveLength(3);
    expect(getComputedStyle(label).color).toBe('rgb(129, 136, 149)');
    expect(getComputedStyle(rows[0].querySelectorAll('td')[0]).color).not.toBe('rgb(129, 136, 149)');
    expect(getComputedStyle(rows[1].querySelectorAll('td')[0]).color).toBe('rgb(129, 136, 149)');
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).textContent).toMatch(/^Vulnerabilities4/);
    expect(screen.getByText('1 version excluded from alerts')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Change' })).toBeNull();
    fireEvent.mouseOver(label);
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'KANAP only looks for vulnerabilities of versions installed on a server or declared by an application.',
    );
  });

  it('shows Not installed in tertiary text in light mode', async () => {
    getMock.mockResolvedValue({
      data: summary({ versions: [version({ version_id: 'v-2025', label: '2025', installed: false })] }),
    } as any);
    renderSection(false, '/it/technologies/TEC-7/compliance', 'light');
    const label = await screen.findByText('Not installed');
    expect(getComputedStyle(label).color).toBe('rgb(108, 116, 130)');
    expect(screen.queryByRole('link', { name: 'See' })).toBeNull();
  });

  it('names a version that is not installed in every language', () => {
    const section = (tree: { pages: { vulnerabilities: { section: { notInstalled: string; notInstalledHint: string } } } }) => tree.pages.vulnerabilities.section;
    expect(section(en)).toMatchObject({
      notInstalled: 'Not installed',
      notInstalledHint: 'KANAP only looks for vulnerabilities of versions installed on a server or declared by an application.',
    });
    expect(section(fr)).toMatchObject({
      notInstalled: 'Non installée',
      notInstalledHint: 'KANAP ne recherche les vulnérabilités que des versions installées sur un serveur ou déclarées par une application.',
    });
    expect(section(de)).toMatchObject({
      notInstalled: 'Nicht installiert',
      notInstalledHint: 'KANAP sucht nur nach Schwachstellen von Versionen, die auf einem Server installiert oder von einer Anwendung deklariert sind.',
    });
    expect(section(es)).toMatchObject({
      notInstalled: 'No instalada',
      notInstalledHint: 'KANAP solo busca vulnerabilidades de las versiones instaladas en un servidor o declaradas por una aplicación.',
    });
  });
});
