import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { downloadServerExport } from '../../components/csv/serverExport';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import portfolioEn from '../../locales/en/portfolio.json';
import ContributorsPage from './ContributorsPage';

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../components/csv/serverExport', () => ({ downloadServerExport: vi.fn(async () => undefined) }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }),
}));

function resolveKey(key: string, opts?: Record<string, unknown>): string | undefined {
  const read = (candidate: string) => candidate
    .split('.')
    .reduce<any>((node, part) => (node == null ? undefined : node[part]), portfolioEn);
  if (opts && typeof opts.count === 'number') {
    const plural = read(`${key}_${opts.count === 1 ? 'one' : 'other'}`);
    if (typeof plural === 'string') return plural;
  }
  return read(key);
}

// `t` must keep a stable identity across renders, as i18next's does: the matrix
// memoizes its export on `t`, and a fresh function each render would feed an
// endless onExportChange -> setState -> re-render cycle that never settles.
const translate = (key: string, opts?: Record<string, unknown>) => {
  const template = resolveKey(key, opts);
  if (typeof template !== 'string') return key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
};
const translation = { t: translate, i18n: { language: 'en', resolvedLanguage: 'en' } };

vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
}));

if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size; },
    },
  });
}

const theme = createAppTheme('light');

const CONTRIBUTORS = [{
  id: 'c-1',
  item_number: 1,
  user_id: 'u-1',
  user_display_name: 'Ada Lovelace',
  user_email: 'ada@example.com',
  areas_of_expertise: [],
  skills: [{ skill_id: 's-aws', proficiency: 4 }],
  project_availability: 5,
  team_id: null,
}];

const SKILLS = [{ id: 's-aws', category: 'Cloud', name: 'AWS', enabled: true }];

const EMPLOYMENT_TYPES = [
  { id: 'type-1', name: 'Internal', is_active: true },
  { id: 'type-2', name: 'External', is_active: true },
  { id: 'type-3', name: 'Freelance', is_active: true },
];

const TEAMS = [{ id: 'team-1', name: 'Infrastructure', description: null, is_active: true, member_count: 2 }];

function contributor(overrides: Record<string, unknown>) {
  return { ...CONTRIBUTORS[0], skills: [{ skill_id: 's-aws', proficiency: 4 }], ...overrides };
}

const MIXED_CONTRIBUTORS = [
  contributor({ id: 'c-1', item_number: 1, user_id: 'u-1', user_display_name: 'Ada Lovelace', employment_type_id: 'type-1', team_id: 'team-1' }),
  contributor({ id: 'c-2', item_number: 2, user_id: 'u-2', user_display_name: 'Bob Stone', employment_type_id: 'type-2', team_id: 'team-1', manager_user_id: 'u-1' }),
  contributor({ id: 'c-3', item_number: 3, user_id: 'u-3', user_display_name: 'Cleo Marsh', employment_type_id: 'type-1', team_id: null, manager_user_id: 'u-2' }),
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        {/* The org chart reports an export failure through the shared dialogs,
            which main.tsx provides above every page. */}
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/portfolio/contributors" element={<ContributorsPage />} />
              <Route path="*" element={<div />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/portfolio/team-members') return { data: { items: CONTRIBUTORS } } as any;
    if (url === '/portfolio/teams') return { data: [] } as any;
    if (url === '/portfolio/employment-types') return { data: EMPLOYMENT_TYPES } as any;
    if (url === '/portfolio/team-members/time-stats') return { data: { stats: {} } } as any;
    if (url === '/portfolio/skills') return { data: { items: SKILLS } } as any;
    return { data: {} } as any;
  });
});

const calledUrls = () => vi.mocked(api.get).mock.calls.map(([url]) => url);

describe('ContributorsPage view switch', () => {
  it('opens on the list and leaves the skills catalogue unfetched', async () => {
    renderAt('/portfolio/contributors');
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByRole('table')).toBeNull();
    expect(calledUrls()).not.toContain('/portfolio/skills');
  });

  it('opens straight on the matrix when the address asks for it', async () => {
    renderAt('/portfolio/contributors?view=matrix');
    await screen.findByRole('table');
    // Contributors hold the columns by default, so the skill is a row header.
    expect(screen.getByRole('rowheader', { name: 'AWS' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Ada Lovelace' })).toBeInTheDocument();
    await waitFor(() => expect(calledUrls()).toContain('/portfolio/skills'));
  });

  it('switches to the matrix from the tab and records it in the address', async () => {
    renderAt('/portfolio/contributors');
    await screen.findByText('Ada Lovelace');

    fireEvent.click(screen.getByRole('tab', { name: 'Skills matrix' }));
    await screen.findByRole('table');
    expect(screen.getByTestId('search').textContent).toBe('?view=matrix');

    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
    // Back to the plain address so the list stays the shareable default.
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('offers Export beside Add contributor, and only on the matrix', async () => {
    renderAt('/portfolio/contributors');
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Skills matrix' }));
    const exportButton = await screen.findByRole('button', { name: 'Export' });
    expect(screen.getByRole('button', { name: /Add contributor/ })).toBeInTheDocument();

    fireEvent.click(exportButton);
    // CSV, then Excel.
    fireEvent.click((await screen.findAllByRole('menuitem'))[1]);
    await waitFor(() => expect(downloadServerExport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadServerExport).mock.calls[0][0]).toMatchObject({ url: '/portfolio/team-members/skills-matrix/export', format: 'xlsx' });
  });

  it('opens straight on the org chart when the address asks for it', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/portfolio/team-members') return { data: { items: MIXED_CONTRIBUTORS } } as any;
      if (url === '/portfolio/teams') return { data: TEAMS } as any;
      if (url === '/portfolio/employment-types') return { data: EMPLOYMENT_TYPES } as any;
      if (url === '/portfolio/team-members/time-stats') return { data: { stats: {} } } as any;
      return { data: {} } as any;
    });

    renderAt('/portfolio/contributors?view=org');
    await screen.findByRole('group', { name: 'Reporting line' });

    // The reporting line crosses teams, so the page filters step aside and the
    // chart's own contract-type pills take over.
    expect(screen.queryByText('All teams')).toBeNull();
    expect(screen.getByRole('button', { name: 'External' })).toBeInTheDocument();
    // Nothing extra is fetched: the chart reads the rows the list already has.
    expect(calledUrls()).not.toContain('/portfolio/skills');
    expect(await screen.findByRole('button', { name: 'Export PNG' })).toBeInTheDocument();
  });

  it('drops the org chart parameters when another view is chosen', async () => {
    renderAt('/portfolio/contributors?view=org&root=CTR-1&hide=External&depth=2&disabled=1');
    await screen.findByRole('tab', { name: 'Org chart' });

    fireEvent.click(screen.getByRole('tab', { name: 'Skills matrix' }));
    await screen.findByRole('table');
    expect(screen.getByTestId('search').textContent).toBe('?view=matrix');
  });

  it('remembers the last view for the next visit without a view in the address', async () => {
    const first = renderAt('/portfolio/contributors');
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('tab', { name: 'Skills matrix' }));
    await screen.findByRole('table');
    first.unmount();

    renderAt('/portfolio/contributors');
    await screen.findByRole('table');
  });
});

describe('ContributorsPage contract type filter', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/portfolio/team-members') return { data: { items: MIXED_CONTRIBUTORS } } as any;
      if (url === '/portfolio/teams') return { data: TEAMS } as any;
      if (url === '/portfolio/employment-types') return { data: EMPLOYMENT_TYPES } as any;
      if (url === '/portfolio/team-members/time-stats') return { data: { stats: {} } } as any;
      if (url === '/portfolio/skills') return { data: { items: SKILLS } } as any;
      return { data: {} } as any;
    });
  });

  const chooseEmploymentType = async (option: string) => {
    fireEvent.mouseDown(await screen.findByText('All contract types'));
    fireEvent.click(within(await screen.findByRole('listbox')).getByText(option));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  };

  const chooseTeam = async (option: string) => {
    fireEvent.mouseDown(await screen.findByText('All teams'));
    fireEvent.click(within(await screen.findByRole('listbox')).getByText(option));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  };

  it('narrows the list to one contract type', async () => {
    renderAt('/portfolio/contributors');
    await screen.findByText('Ada Lovelace');
    await chooseEmploymentType('External');
    expect(screen.getByText('Bob Stone')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    expect(screen.queryByText('Cleo Marsh')).toBeNull();
  });

  it('narrows the matrix through the same filter', async () => {
    renderAt('/portfolio/contributors?view=matrix');
    await screen.findByRole('columnheader', { name: 'Bob Stone' });
    await chooseEmploymentType('Internal');
    expect(screen.getByRole('columnheader', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Bob Stone' })).toBeNull();
  });

  it('composes with the team filter', async () => {
    renderAt('/portfolio/contributors');
    await screen.findByText('Cleo Marsh');
    await chooseTeam('Infrastructure');
    expect(screen.queryByText('Cleo Marsh')).toBeNull();
    await chooseEmploymentType('External');
    expect(screen.getByText('Bob Stone')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('says nothing matches instead of claiming there are no contributors', async () => {
    renderAt('/portfolio/contributors');
    await screen.findByText('Ada Lovelace');
    await chooseEmploymentType('Freelance');
    expect(screen.getByText('No contributor matches the current filters.')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });
});
