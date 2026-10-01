import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import ContributorWorkspacePage from './ContributorWorkspacePage';

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

// Mutable so a case can take a permission away or turn the tenant's SSO on.
// Every member is created once: an identity that changes per render would
// re-create the page's autosave callbacks on every pass.
const auth = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  tenantAuth: null as { sso_provider: string; sso_enabled: boolean } | null,
  denied: new Set<string>(),
  refreshMe: vi.fn(),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => !auth.denied.has(resource),
    profile: auth.profile,
    tenantAuth: auth.tenantAuth,
    refreshMe: auth.refreshMe,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.count !== undefined ? `${key}:${opts.count}` : key),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../components/reports/ChartCard', () => ({ default: () => <div data-testid="chart" /> }));
vi.mock('./components/ContributorTimeLog', () => ({ default: () => <div data-testid="time-log" /> }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: () => <div data-testid="company-select" /> }));

const theme = createAppTheme('light');
const CONTRIBUTOR_ID = '8c744aca-52d4-4404-8079-763c1ea9a2a7';
const CONTRIBUTOR_REF = 'CTR-12';

function contributor(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRIBUTOR_ID,
    item_number: 12,
    user_id: 'user-9',
    user_display_name: 'Antoine KANDEL',
    user_email: 'antoine@example.com',
    job_title: 'Cheese buyer',
    external_auth_provider: null,
    areas_of_expertise: [],
    skills: [{ skill_id: 'skill-1', proficiency: 2 }],
    project_availability: '0.0',
    notes: 'Initial notes',
    team_id: null,
    manager_user_id: null,
    manager_source: null,
    manager_name: null,
    employment_type_id: 'type-1',
    employment_type_name: 'Internal',
    default_source_id: null,
    default_category_id: null,
    default_stream_id: null,
    default_company_id: null,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
  // Same staleTime as lib/queryClient.tsx: a seeded cache entry must not refetch on mount.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/portfolio/contributors/me" element={<ContributorWorkspacePage />} />
              <Route path="/portfolio/contributors/me/:tab" element={<ContributorWorkspacePage />} />
              <Route path="/portfolio/contributors/:id" element={<ContributorWorkspacePage />} />
              <Route path="/portfolio/contributors/:id/:tab" element={<ContributorWorkspacePage />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const MANAGER = { id: 'mgr-cfg', item_number: 7, user_id: 'user-3', user_display_name: 'Grace HOPPER' };

function mockGets(
  selfConfig: unknown | 'missing' = 'missing',
  opts: { subject?: Record<string, unknown>; listItems?: unknown[] } = {},
) {
  const subject = contributor(opts.subject);
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === `/portfolio/team-members/${CONTRIBUTOR_ID}` || url === `/portfolio/team-members/${CONTRIBUTOR_REF}`) return { data: subject };
    if (url === '/portfolio/employment-types') {
      return { data: [
        { id: 'type-1', name: 'Internal', is_active: true },
        { id: 'type-2', name: 'External', is_active: true },
      ] };
    }
    if (url === '/users') {
      return { data: { items: [
        { id: 'user-3', first_name: 'Grace', last_name: 'Hopper' },
        { id: 'user-9', first_name: 'Antoine', last_name: 'Kandel' },
      ] } };
    }
    if (url === '/portfolio/team-members/me') {
      if (selfConfig === 'missing') {
        const error: any = new Error('Not found');
        error.response = { status: 404 };
        throw error;
      }
      return { data: selfConfig };
    }
    if (url.endsWith('/time-stats')) return { data: { userId: 'user-9', averageProjectDays: 0, monthly: [] } };
    if (url === '/portfolio/teams') return { data: [] };
    if (url === '/portfolio/team-members') return { data: { items: opts.listItems ?? [subject] } };
    if (url === '/portfolio/skills') {
      return { data: { items: [
        { id: 'skill-1', category: 'Business applications', name: 'Office suite', enabled: true },
        { id: 'skill-2', category: 'Data', name: 'Data governance', enabled: true },
      ] } };
    }
    if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
    if (url === '/companies') return { data: { items: [] } };
    return { data: null };
  });
}

function jobTitleField() {
  return screen.findByLabelText('portfolio:workspace.contributor.fields.jobTitle') as Promise<HTMLInputElement>;
}

function notesField() {
  return screen.getByPlaceholderText('portfolio:workspace.contributor.placeholders.notes') as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.patch).mockReset();
  auth.profile = { id: 'user-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' };
  auth.tenantAuth = null;
  auth.denied.clear();
  auth.refreshMe.mockClear();
  mockGets();
});

describe('ContributorWorkspacePage autosave', () => {

  it('keeps a zero availability instead of falling back to the default', async () => {
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const hits = await screen.findAllByText('portfolio:workspace.contributor.values.daysPerMonthShort:0');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('an edit made while a save is in flight survives that save', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    vi.mocked(api.patch)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ data: { id: CONTRIBUTOR_ID } });

    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await waitFor(() => notesField());
    fireEvent.change(field, { target: { value: 'first' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(api.patch).toHaveBeenLastCalledWith(`/portfolio/team-members/${CONTRIBUTOR_REF}`, { notes: 'first' });

    // Second edit while the first PATCH is still pending.
    fireEvent.change(notesField(), { target: { value: 'first second' } });
    await act(async () => { resolveFirst({ data: contributor({ notes: 'first' }) }); });

    expect(notesField().value).toBe('first second');
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(api.patch).toHaveBeenLastCalledWith(`/portfolio/team-members/${CONTRIBUTOR_REF}`, { notes: 'first second' });
    expect(notesField().value).toBe('first second');
  });

  it('a failed save shows the error, rolls the cache back and blocks the tab change', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('boom'));
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await waitFor(() => notesField());
    const getCallsBefore = vi.mocked(api.get).mock.calls.filter(([url]) => url === `/portfolio/team-members/${CONTRIBUTOR_REF}`).length;

    fireEvent.change(field, { target: { value: 'will fail' } });
    fireEvent.click(screen.getByRole('tab', { name: 'portfolio:workspace.contributor.tabs.skills' }));

    await screen.findByRole('alert');
    expect(screen.getByTestId('location').textContent).toBe(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    await waitFor(() => {
      const refetches = vi.mocked(api.get).mock.calls.filter(([url]) => url === `/portfolio/team-members/${CONTRIBUTOR_REF}`).length;
      expect(refetches).toBeGreaterThan(getCallsBefore);
    });
    await waitFor(() => expect(notesField().value).toBe('Initial notes'));
  });

  it('creates the self-service config on the first save and adopts its id', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'new-config' } });
    renderAt('/portfolio/contributors/me');
    const field = await waitFor(() => notesField());
    fireEvent.change(field, { target: { value: 'hello' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/portfolio/team-members/me', { notes: 'hello' }), { timeout: 2000 });
    await waitFor(() => {
      expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/portfolio/team-members/new-config/time-stats')).toBe(true);
    });
  });

  it('redirects legacy /defaults links to the general tab', async () => {
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}/defaults`);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/portfolio/contributors/${CONTRIBUTOR_REF}`));
  });

  it('rewrites a legacy UUID URL to the CTR reference, keeping the tab', async () => {
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_ID}/skills`);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/portfolio/contributors/${CONTRIBUTOR_REF}/skills`));
    // The record loaded by UUID is reused under the reference key: no second fetch.
    const fetches = vi.mocked(api.get).mock.calls.filter(([url]) => url === `/portfolio/team-members/${CONTRIBUTOR_REF}`).length;
    expect(fetches).toBe(0);
    expect(screen.getAllByText(CONTRIBUTOR_REF).length).toBeGreaterThan(0);
  });

  it('adds a skill with the chosen level from the header dialog', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { id: CONTRIBUTOR_ID } });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}/skills`);
    fireEvent.click(await screen.findByRole('button', { name: 'portfolio:workspace.contributor.actions.addSkill' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Data' } });
    fireEvent.click(await screen.findByText('Data governance'));
    fireEvent.click(within(dialog).getAllByRole('radio')[3]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.add' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/portfolio/team-members/${CONTRIBUTOR_REF}`, {
      skills: [{ skill_id: 'skill-1', proficiency: 2 }, { skill_id: 'skill-2', proficiency: 4 }],
    }), { timeout: 2000 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Data governance')).toBeTruthy();
  });
});

describe('ContributorWorkspacePage manager and employment type', () => {
  beforeEach(() => {
    vi.mocked(api.patch).mockResolvedValue({ data: { id: CONTRIBUTOR_ID } });
  });

  const openEmploymentTypeSelect = async () => {
    fireEvent.mouseDown(await screen.findByText('Internal'));
    return within(await screen.findByRole('listbox'));
  };

  const managerField = () => screen.findByPlaceholderText('portfolio:workspace.contributor.values.noManager') as Promise<HTMLInputElement>;

  it('saves the manager picked in the drawer, excluding the contributor themselves', async () => {
    mockGets();
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await managerField();
    fireEvent.mouseDown(field);
    fireEvent.change(field, { target: { value: 'a' } });

    const options = within(await screen.findByRole('listbox'));
    await waitFor(() => expect(options.queryByText('Grace Hopper')).toBeTruthy());
    // user-9 is the contributor under edit: nobody manages themselves.
    expect(options.queryByText('Antoine Kandel')).toBeNull();

    fireEvent.click(options.getByText('Grace Hopper'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/portfolio/team-members/${CONTRIBUTOR_REF}`,
      { manager_user_id: 'user-3' },
    ), { timeout: 2000 });
  });

  it('clears the manager as an explicit null', async () => {
    mockGets('missing', { subject: { manager_user_id: 'user-3', manager_source: 'manual', manager_name: 'Grace HOPPER' } });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await managerField();
    await waitFor(() => expect(field.value).toBe('Grace Hopper'));
    fireEvent.click(screen.getByLabelText('Clear'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/portfolio/team-members/${CONTRIBUTOR_REF}`,
      { manager_user_id: null },
    ), { timeout: 2000 });
  });

  it('shows an Entra manager read-only, with no picker', async () => {
    mockGets('missing', { subject: { manager_user_id: 'user-3', manager_source: 'entra', manager_name: 'Grace HOPPER' } });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    expect(await screen.findByText('portfolio:workspace.contributor.values.fromEntra')).toBeTruthy();
    expect(screen.queryByPlaceholderText('portfolio:workspace.contributor.values.noManager')).toBeNull();
  });

  it('keeps an orphaned Entra manager editable', async () => {
    // The account was deleted: the foreign key nulled the id, the source stayed.
    mockGets('missing', { subject: { manager_user_id: null, manager_source: 'entra' } });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    expect(await managerField()).toBeTruthy();
    expect(screen.queryByText('portfolio:workspace.contributor.values.fromEntra')).toBeNull();
  });

  it('saves the employment type', async () => {
    mockGets();
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    fireEvent.click((await openEmploymentTypeSelect()).getByText('External'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/portfolio/team-members/${CONTRIBUTOR_REF}`,
      { employment_type_id: 'type-2' },
    ), { timeout: 2000 });
  });

  it('offers no empty choice for the contract type', async () => {
    mockGets();
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const options = await openEmploymentTypeSelect();
    expect(options.getAllByRole('option').map((o) => o.textContent)).toEqual(['Internal', 'External']);
  });

  it('saves the job title on blur, and only when it changed', async () => {
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await jobTitleField();
    // eslint-disable-next-line no-console
    await waitFor(() => expect(field.value).toBe('Cheese buyer'));

    // A blur with nothing typed must cost nothing: the write goes to `users`
    // and would leave an audit row per visit.
    fireEvent.blur(field);
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  Head of cheese  ' } });
    fireEvent.blur(field);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/portfolio/team-members/${CONTRIBUTOR_REF}`,
      { job_title: 'Head of cheese' },
    ), { timeout: 2000 });
  });

  it('sends an emptied job title as an explicit null', async () => {
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await jobTitleField();
    await waitFor(() => expect(field.value).toBe('Cheese buyer'));
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/portfolio/team-members/${CONTRIBUTOR_REF}`,
      { job_title: null },
    ), { timeout: 2000 });
  });

  it('locks the job title on an Entra account and says where it comes from', async () => {
    auth.tenantAuth = { sso_provider: 'entra', sso_enabled: true };
    mockGets('missing', { subject: { external_auth_provider: 'entra' } });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);

    const field = await jobTitleField();
    expect(field.readOnly).toBe(true);
    expect(await screen.findByText('portfolio:workspace.contributor.values.fromEntra')).toBeTruthy();

    fireEvent.change(field, { target: { value: 'Typed by hand' } });
    fireEvent.blur(field);
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('leaves an Entra account editable once the tenant no longer signs in through it', async () => {
    // Nothing syncs the column any more, so the value is ours again.
    auth.tenantAuth = { sso_provider: 'entra', sso_enabled: false };
    mockGets('missing', { subject: { external_auth_provider: 'entra' } });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    expect((await jobTitleField()).readOnly).toBe(false);
  });

  it('shows someone else\'s job title read-only without users:admin', async () => {
    auth.denied.add('users');
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await jobTitleField();
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe('Cheese buyer');
    // Not an Entra lock: nothing claims the directory owns it.
    expect(screen.queryByText('portfolio:workspace.contributor.values.fromEntra')).toBeNull();
  });

  it('lets a contributor edit their own job title without users:admin', async () => {
    auth.denied.add('users');
    auth.profile = { id: 'user-9', first_name: 'Antoine', last_name: 'Kandel' };
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await jobTitleField();
    expect(field.readOnly).toBe(false);

    fireEvent.change(field, { target: { value: 'Head of cheese' } });
    fireEvent.blur(field);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/portfolio/team-members/${CONTRIBUTOR_REF}`,
      { job_title: 'Head of cheese' },
    ), { timeout: 2000 });
    // Their own `users` row changed, so the signed-in profile must catch up.
    await waitFor(() => expect(auth.refreshMe).toHaveBeenCalled());
  });

  it('opens the manager from the metadata bar when they are a contributor', async () => {
    mockGets('missing', {
      subject: { manager_user_id: 'user-3', manager_source: 'manual', manager_name: 'Grace HOPPER' },
      listItems: [contributor(), MANAGER],
    });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const link = await screen.findByRole('button', { name: /metadata\.manager Grace HOPPER/ });
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/portfolio/contributors/CTR-7'));
  });

  it('leaves a manager who is not a contributor unlinked', async () => {
    mockGets('missing', { subject: { manager_user_id: 'user-3', manager_source: 'manual', manager_name: 'Grace HOPPER' } });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    await screen.findAllByText('Grace HOPPER');
    expect(screen.queryByRole('button', { name: /metadata\.manager Grace HOPPER/ })).toBeNull();
  });

  it('hides both fields on the self-service route', async () => {
    mockGets(contributor());
    renderAt('/portfolio/contributors/me');
    await waitFor(() => notesField());
    expect(screen.queryByText('portfolio:workspace.contributor.fields.manager')).toBeNull();
    expect(screen.queryByText('portfolio:workspace.contributor.fields.employmentType')).toBeNull();
  });
});

/** An API error as axios rejects it. */
function apiError(status: number, code: string) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code, message: code }, headers: {} } });
}

describe('ContributorWorkspacePage autosave on refused and busy saves', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a conflict is not kept: the stored notes come back and leaving is free', async () => {
    vi.mocked(api.patch).mockRejectedValue(apiError(409, 'parent_gone'));
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await waitFor(() => notesField());
    fireEvent.change(field, { target: { value: 'refused' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(await screen.findByText('errors:parent_gone')).toBeInTheDocument();
    await waitFor(() => expect(notesField().value).toBe('Initial notes'));

    // Nothing kept: the tab change goes through without sending it again.
    fireEvent.click(screen.getByRole('tab', { name: 'portfolio:workspace.contributor.tabs.skills' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/portfolio/contributors/${CONTRIBUTOR_REF}/skills`));
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('a busy save is kept, leaving asks first, and leaving drops it and shows the stored notes again', async () => {
    vi.mocked(api.patch).mockRejectedValue(apiError(503, 'busy'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt(`/portfolio/contributors/${CONTRIBUTOR_REF}`);
    const field = await waitFor(() => notesField());
    fireEvent.change(field, { target: { value: 'kept while busy' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(api.patch).toHaveBeenCalledTimes(4);
    expect(await screen.findByText('errors:notSavedYet')).toBeInTheDocument();
    expect(notesField().value).toBe('kept while busy');

    fireEvent.click(screen.getByRole('tab', { name: 'portfolio:workspace.contributor.tabs.skills' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('common:autosave.leaveMessage')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(5);
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:autosave.leaveConfirm' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/portfolio/contributors/${CONTRIBUTOR_REF}/skills`));

    fireEvent.click(screen.getByRole('tab', { name: 'portfolio:workspace.contributor.tabs.general' }));
    await waitFor(() => expect(notesField().value).toBe('Initial notes'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.patch).toHaveBeenCalledTimes(5);
  });
});
