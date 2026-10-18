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

function renderSection(canEdit: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('dark')}>
      <QueryClientProvider client={client}>
        <MemoryRouter><TechnologyVulnerabilitiesSection technologyId="tech-1" canEdit={canEdit} /></MemoryRouter>
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
    expect(navigate).toHaveBeenCalledWith('/it/vulnerabilities?technology=TEC-7&version=9.0.80&state=all&q=CVE-2026-1001');
    fireEvent.click(rows[2]);
    expect(navigate).toHaveBeenLastCalledWith('/it/vulnerabilities?technology=TEC-7&version=none&state=all&q=CVE-2026-1002');
    expect(screen.queryByRole('button', { name: 'Match again' })).toBeNull();
  });

  it('matches the technology again for a member', async () => {
    postMock.mockResolvedValue({ data: { ok: true, added: 2, updated: 0, removed: 1, unmatched: 0 } } as any);
    renderSection(true);
    await screen.findByRole('table', { name: 'Vulnerabilities' });
    fireEvent.click(screen.getByRole('button', { name: 'Match again' }));
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
