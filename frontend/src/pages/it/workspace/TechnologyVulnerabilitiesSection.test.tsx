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
import { filterModelFromSearch } from '../VulnerabilitiesPage';

vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const navigate = vi.hoisted(() => vi.fn());
const features = vi.hoisted(() => ({ vulnerabilityFeed: true }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<any>()), useNavigate: () => navigate }));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

const version = (over: Partial<TechnologyVulnerabilityVersion>): TechnologyVulnerabilityVersion => ({
  version_id: 'v-1', label: '10.1', alerts: true, installed: true, servers: 4,
  open: { critical: 2, high: 0, medium: 1, low: 0, none: 0, unknown: 0 }, total: 5, ...over,
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
    version({ version_id: 'v-2', label: '9.0', alerts: false, servers: 1, open: { critical: 0, high: 1, medium: 0, low: 0, none: 0, unknown: 0 }, total: 1 }),
    version({ version_id: null, label: null, alerts: true, servers: 0, open: { critical: 0, high: 0, medium: 0, low: 0, none: 0, unknown: 0 }, total: 2 }),
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

  it('summarizes the versions, with the CVE to review by severity in fixed columns and a link to the page', async () => {
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    expect(getMock).toHaveBeenCalledWith('/technologies/tech-1/vulnerabilities/summary');
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).textContent).toMatch(/^Vulnerabilities3/);
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent))
      .toEqual(['Version', 'Servers', 'Critical', 'High', 'Medium', 'Low', 'Not rated', 'Total', '']);
    const rows = within(table).getAllByRole('row').slice(1);
    // A zero is a tertiary dot; Total counts every state.
    expect(rows.map((row) => row.textContent)).toEqual([
      '10.142·1··5See',
      '9.0Excluded from alerts1·1···1See',
      'Version not recorded (potentially concerned)0·····2See',
    ]);
    // Every number column is right-aligned, its figures in tabular numbers.
    const cells = Array.from(rows[0].querySelectorAll('td'));
    expect(cells.slice(1, 8).every((td) => td.classList.contains('r'))).toBe(true);
    expect(getComputedStyle(cells[7].firstElementChild as HTMLElement).fontWeight).toBe('500');
    expect(getComputedStyle(cells[1].firstElementChild as HTMLElement).fontVariantNumeric).toBe('tabular-nums');
    // Critical in orange (dark mode), the same color as the Vulnerabilities page; Medium stays neutral.
    expect(getComputedStyle(cells[2].firstElementChild as HTMLElement).color).toBe('rgb(240, 168, 48)');
    expect(getComputedStyle(cells[4].firstElementChild as HTMLElement).color).not.toBe('rgb(240, 168, 48)');
    expect(getComputedStyle(cells[3].firstElementChild as HTMLElement).color).toBe('rgb(129, 136, 149)');
    // Each severity header carries its dot, and a hint that it counts the CVE to review.
    const critical = within(table).getByRole('columnheader', { name: 'Critical' });
    expect(critical.querySelector('[data-severity="critical"]')).toBeTruthy();
    fireEvent.mouseOver(critical.querySelector('[data-severity]') as HTMLElement);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Critical: CVE still to review. Total counts every state.');
    const links = within(table).getAllByRole('link', { name: 'See' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/it/vulnerabilities?technology=TEC-7&version=10.1&alerts=all',
      '/it/vulnerabilities?technology=TEC-7&version=9.0&alerts=all',
      // Every CVE of the unknown version is reviewed: the page opens on every state.
      '/it/vulnerabilities?technology=TEC-7&version=none&alerts=all&state=all',
    ]);
    expect(screen.getByRole('link', { name: 'See everything on the Vulnerabilities page' }).getAttribute('href'))
      .toBe('/it/vulnerabilities?technology=TEC-7&alerts=all&state=all');
    expect(screen.queryByTestId('vulnerabilities-not-installed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Change' })).toBeNull();
  });

  it('counts a CVE rated None with Low, and one with no severity yet as Not rated', async () => {
    getMock.mockResolvedValue({
      data: summary({
        versions: [version({ open: { critical: 0, high: 1, medium: 0, low: 1, none: 1, unknown: 2 }, total: 5 })],
      }),
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    const row = within(table).getAllByRole('row')[1];
    expect(row.textContent).toBe('10.14·1·225See');
  });

  it('opens See on every state when the only CVE to review has no severity yet, or on To review', async () => {
    getMock.mockResolvedValue({
      data: summary({
        versions: [
          version({ open: { critical: 0, high: 0, medium: 0, low: 0, none: 0, unknown: 1 }, total: 3 }),
          version({ version_id: 'v-2', label: '9.0', open: { critical: 0, high: 0, medium: 0, low: 0, none: 0, unknown: 0 }, total: 3 }),
        ],
      }),
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    expect(within(table).getAllByRole('link', { name: 'See' }).map((link) => link.getAttribute('href'))).toEqual([
      '/it/vulnerabilities?technology=TEC-7&version=10.1&alerts=all',
      '/it/vulnerabilities?technology=TEC-7&version=9.0&alerts=all&state=all',
    ]);
    // The page reads `state`: absent is To review, `all` drops the state filter.
    const [toReview, every] = within(table).getAllByRole('link', { name: 'See' }).map((link) => link.getAttribute('href')!.split('?')[1]);
    expect(filterModelFromSearch(`?${toReview}`).state).toEqual({ filterType: 'set', values: ['to_review'] });
    expect(filterModelFromSearch(`?${every}`).state).toBeUndefined();
    const all = screen.getByRole('link', { name: 'See everything on the Vulnerabilities page' }).getAttribute('href')!.split('?')[1];
    expect(filterModelFromSearch(`?${all}`).state).toBeUndefined();
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

  it('matches the technology again for a member, from the title line', async () => {
    postMock.mockResolvedValue({ data: { ok: true, added: 2, updated: 0, removed: 1, unmatched: 0 } } as any);
    renderSection(true);
    await screen.findByRole('table', { name: 'Vulnerabilities' });
    const titleLine = screen.getByRole('heading', { name: 'Vulnerabilities' }).parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(titleLine).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/technologies/tech-1/vulnerabilities/rematch'));
    expect((await within(titleLine).findByRole('status')).textContent).toBe('Matched again: 2 new, 1 removed.');
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

  it('says the search could not be completed when the product collection failed', async () => {
    getMock.mockResolvedValue({
      data: summary({ collecting: false, products: [{ product: 'a:apache:tomcat', status: 'failed' }], versions: [], cves: 0 }),
    } as any);
    renderSection(true);
    expect((await screen.findByTestId('technology-vulnerabilities-failed')).textContent).toBe('The search for vulnerabilities could not be completed.');
    expect(screen.queryByText('No known vulnerability concerns this technology.')).toBeNull();
    expect(screen.queryByText('Searching for vulnerabilities…')).toBeNull();
  });

  it('keeps searching when one product is still pending and another has failed', async () => {
    getMock.mockResolvedValue({
      data: summary({
        collecting: true,
        products: [{ product: 'a:apache:tomcat', status: 'pending' }, { product: 'a:apache:httpd', status: 'failed' }],
        versions: [],
        cves: 0,
      }),
    } as any);
    renderSection(true);
    expect(await screen.findByText('Searching for vulnerabilities…')).toBeTruthy();
    expect(screen.queryByTestId('technology-vulnerabilities-failed')).toBeNull();
  });

  it('says in one line that nothing concerns the technology', async () => {
    getMock.mockResolvedValue({ data: summary({ versions: [], cves: 0 }) } as any);
    renderSection(true);
    expect(await screen.findByText('No known vulnerability concerns this technology.')).toBeTruthy();
  });

  it('shows dots and no See for an installed version with no vulnerability', async () => {
    getMock.mockResolvedValue({
      data: summary({
        cves: 3,
        versions: [version({
          version_id: 'v-empty', label: '8.0', servers: 2,
          open: { critical: 0, high: 0, medium: 0, low: 0, none: 0, unknown: 0 }, total: 0,
        })],
      }),
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    const row = within(table).getAllByRole('row')[1];
    expect(row.textContent).toBe('8.02·····0');
    expect(within(row).queryByRole('link', { name: 'See' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Vulnerabilities' }).textContent).toMatch(/^Vulnerabilities3/);
    expect(screen.queryByTestId('vulnerabilities-not-installed')).toBeNull();
  });

  it('names the versions that are not installed in one line under the table', async () => {
    getMock.mockResolvedValue({
      data: summary({
        cves: 4,
        versions_excluded: 1,
        versions: [
          version({}),
          version({ version_id: 'v-11', label: '11.0', installed: false, servers: 0, total: 0 }),
          version({ version_id: 'v-2019', label: '8.5', alerts: false, installed: false, servers: 0, total: 0 }),
          version({ version_id: null, label: null, installed: false, servers: 0, total: 0 }),
        ],
      }),
    } as any);
    renderSection(false);
    const table = await screen.findByRole('table', { name: 'Vulnerabilities' });
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['10.142·1··5See']);
    const line = screen.getByTestId('vulnerabilities-not-installed');
    expect(line.textContent).toBe('Not installed: 11.0, 8.5, Version not recorded (potentially concerned)');
    // Under the table, before the link to the page.
    const all = screen.getByRole('link', { name: 'See everything on the Vulnerabilities page' });
    expect(Boolean(table.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(line.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    fireEvent.mouseOver(line);
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'KANAP only looks for vulnerabilities of versions installed on a server or declared by an application.',
    );
  });

  it('shows the line alone when no version is installed', async () => {
    getMock.mockResolvedValue({
      data: summary({ cves: 1, versions: [version({ version_id: 'v-2025', label: '2025', installed: false, total: 1 })] }),
    } as any);
    renderSection(false, '/it/technologies/TEC-7/compliance', 'light');
    expect((await screen.findByTestId('vulnerabilities-not-installed')).textContent).toBe('Not installed: 2025');
    expect(screen.queryByRole('table', { name: 'Vulnerabilities' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'See' })).toBeNull();
  });

  it('names the versions that are not installed in every language', () => {
    type Section = { notInstalledList_one: string; notInstalledList_other: string; notInstalledHint: string };
    const section = (tree: unknown) => (tree as { pages: { vulnerabilities: { section: Section } } }).pages.vulnerabilities.section;
    expect(section(en)).toMatchObject({
      notInstalledList_other: 'Not installed: {{versions}}',
      notInstalledHint: 'KANAP only looks for vulnerabilities of versions installed on a server or declared by an application.',
    });
    expect(section(fr)).toMatchObject({
      notInstalledList_one: 'Non installée : {{versions}}',
      notInstalledList_other: 'Non installées : {{versions}}',
      notInstalledHint: 'KANAP ne recherche les vulnérabilités que des versions installées sur un serveur ou déclarées par une application.',
    });
    expect(section(de)).toMatchObject({
      notInstalledList_other: 'Nicht installiert: {{versions}}',
      notInstalledHint: 'KANAP sucht nur nach Schwachstellen von Versionen, die auf einem Server installiert oder von einer Anwendung deklariert sind.',
    });
    expect(section(es)).toMatchObject({
      notInstalledList_other: 'No instaladas: {{versions}}',
      notInstalledHint: 'KANAP solo busca vulnerabilidades de las versiones instaladas en un servidor o declaradas por una aplicación.',
    });
  });
});
