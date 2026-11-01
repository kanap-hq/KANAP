import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { createFakeOnboardingServer } from '../../test/fakeOnboardingServer';
import FirstStepsTile from './FirstStepsTile';
import StepHint from './StepHint';

const env = vi.hoisted(() => ({
  summary: (() => Promise.resolve({ data: { items: [] } })) as (config?: unknown, url?: string) => Promise<unknown>,
  server: null as unknown as ReturnType<typeof import('../../test/fakeOnboardingServer').createFakeOnboardingServer>,
}));

vi.mock('../../api', () => ({
  default: {
    get: (url: string, config?: unknown) => (['/budget-lines/summary', '/applications'].includes(url) || url.startsWith('/portfolio/')
      ? env.summary(config, url)
      : env.server.api.get(url)),
    put: (url: string, body?: unknown) => env.server.api.put(url, body),
    post: (url: string, body?: unknown) => env.server.api.post(url, body),
    delete: (url: string) => env.server.api.delete(url),
  },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u1', email: 'ada@example.com' },
    claims: { isGlobalAdmin: true, isPlatformAdmin: false, permissions: {} },
    subscription: { status: 'trialing', is_subscription_healthy: true },
    refreshMe: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: {} } }),
}));

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string | { pathname: string; search?: string; state?: unknown }, node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="*" element={<>{node}<Where /></>} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const done = (key: string) => env.server.state().steps.find((step) => step.key === key)?.done_at;

describe('FirstStepsTile', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('lists the five steps of the path with links to their screens and the progress', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    env.server.db.done.set('budget/example/budget_overview', '2026-11-02T09:20:00.000Z');
    renderAt('/', <FirstStepsTile />);
    expect(await screen.findByText('Your first five steps')).toBeInTheDocument();
    expect(screen.getByText('1/5')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['The overview', 'A report', 'A question for Plaid', 'Your data']);
    expect(links[0]).toHaveAttribute('href', '/ops/budget?step=budget_overview');
    expect(links[2]).toHaveAttribute('href', '/ai?step=budget_plaid');
    expect(screen.getByRole('button', { name: 'A budget line' })).toBeInTheDocument();
  });

  it('opens the largest line of the year for the budget line step, named in its hint', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    let asked: unknown = null;
    env.summary = async (config) => {
      asked = config;
      return { data: { items: [{ id: 'l-7', item_number: 7, product_name: 'Microsoft Enterprise' }] } };
    };
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'A budget line' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/ops/budget/BL-7?step=budget_line'));
    expect((asked as { params: { limit: number; sort: string } }).params).toMatchObject({ limit: 1, sort: expect.stringMatching(/:DESC$/) });
  });

  it('opens the first of the most critical applications for the application step', async () => {
    env.server = createFakeOnboardingServer({ angle: 'cartography', mode: 'example' });
    let asked: { url?: string; config?: unknown } = {};
    env.summary = async (config, url) => {
      asked = { url, config };
      return { data: { items: [{ id: 'app-1', name: 'SAP S/4HANA' }] } };
    };
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'An application record' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/it/applications/app-1?step=map_application'));
    expect(asked.url).toBe('/applications');
    expect((asked.config as { params: unknown }).params).toEqual({ limit: 1, sort: 'criticality:DESC' });
  });

  it('opens the list for the budget line step when there is no line', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    env.summary = async () => ({ data: { items: [] } });
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'A budget line' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/ops/budget?step=budget_line'));
  });

  it('ends on inviting a colleague with your own data', async () => {
    env.server = createFakeOnboardingServer({ angle: 'cartography', mode: 'own_data' });
    renderAt('/', <FirstStepsTile />);
    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Your applications', 'Your technologies', 'Your servers', 'What KANAP found', 'A colleague',
    ]);
    expect(links[4]).toHaveAttribute('href', '/admin/users?step=own_invite');
  });

  it('marks a step done and not done from its mark', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'own_data' });
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as done: Your project' }));
    await waitFor(() => expect(screen.getByText('1/5')).toBeInTheDocument());
    expect(done('own_projects')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as not done: Your project' }));
    await waitFor(() => expect(screen.getByText('0/5')).toBeInTheDocument());
    expect(done('own_projects')).toBeFalsy();
  });

  it('hides itself for this user', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide the first steps' }));
    await waitFor(() => expect(screen.queryByText('Your first five steps')).not.toBeInTheDocument());
    expect(env.server.db.dismissedAt).not.toBeNull();
  });

  it('offers the two other paths once the five are done', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    for (const key of ['budget_overview', 'budget_line', 'budget_report', 'budget_plaid', 'budget_import']) {
      env.server.db.done.set(`budget/example/${key}`, '2026-11-02T09:20:00.000Z');
    }
    renderAt('/', <FirstStepsTile />);
    expect(await screen.findByText('IT budget path complete!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'IT budget' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'IT landscape map' }));
    await waitFor(() => expect(screen.getByText('0/5')).toBeInTheDocument());
    expect(env.server.db.angle).toBe('cartography');
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('The application list');
  });

  it('starts a finished path again by undoing its five steps', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    for (const key of ['budget_overview', 'budget_line', 'budget_report', 'budget_plaid', 'budget_import']) {
      env.server.db.done.set(`budget/example/${key}`, '2026-11-02T09:20:00.000Z');
    }
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restart this path' }));
    await waitFor(() => expect(screen.getByText('0/5')).toBeInTheDocument());
    expect(env.server.state().completed).toBe(false);
    expect(screen.getByRole('link', { name: 'The overview' })).toBeInTheDocument();
  });

  it('shows nothing without a path', async () => {
    env.server = createFakeOnboardingServer({ mode: 'example' });
    renderAt('/', <FirstStepsTile />);
    await waitFor(() => expect(env.server.calls.length).toBe(1));
    expect(screen.queryByText('Your first five steps')).not.toBeInTheDocument();
  });
});

describe('StepHint', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  const page = (
    <main>
      <h5 className="MuiTypography-h5">Budget lines</h5>
      <StepHint />
    </main>
  );

  it('points at the page title, says what to look at and marks the step done on the example', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderAt('/ops/budget?step=budget_overview', page);
    const hint = await screen.findByRole('dialog', { name: 'The overview' });
    expect(hint).toHaveTextContent('Here are the budget lines, sorted by budget for the current year.');
    await waitFor(() => expect(done('budget_overview')).toBeTruthy());
    fireEvent.click(within(hint).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/ops\/budget$/);
  });

  it('names the line its step opened and points at its tabs', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderAt({ pathname: '/ops/budget/BL-7', search: '?step=budget_line', state: { onboardingRecord: 'BL-7 Microsoft Enterprise' } }, (
      <main>
        <h5 className="MuiTypography-h5">Microsoft Enterprise</h5>
        <div role="tablist" aria-label="tabs" data-testid="tabs" />
        <StepHint />
      </main>
    ));
    const hint = await screen.findByRole('dialog', { name: 'A budget line' });
    expect(hint).toHaveTextContent('You are in the record of BL-7 Microsoft Enterprise. Explore the tabs.');
  });

  it('points at the Export button of the list for the data step', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderAt('/ops/budget?step=budget_import', (
      <main>
        <h5 className="MuiTypography-h5">Budget lines</h5>
        <button type="button">Export</button>
        <StepHint />
      </main>
    ));
    const hint = await screen.findByRole('dialog', { name: 'Your data' });
    expect(hint).toHaveTextContent('Try the export to get the data as csv or xlsx.');
  });

  it('names no record in the application step: its sentence speaks of an application record', async () => {
    env.server = createFakeOnboardingServer({ angle: 'cartography', mode: 'example' });
    renderAt({ pathname: '/it/applications/app-1', search: '?step=map_application', state: { onboardingRecord: 'SAP S/4HANA' } }, (
      <main>
        <h5 className="MuiTypography-h5">SAP S/4HANA</h5>
        <div role="tablist" aria-label="tabs" />
        <StepHint />
      </main>
    ));
    const hint = await screen.findByRole('dialog', { name: 'An application record' });
    expect(hint).toHaveTextContent('Here is an application record. Explore the properties panel and the tabs');
  });

  it('waits for "Done" with your own data, and gives the hint of the angle', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    renderAt('/admin/users?step=own_invite', page);
    const hint = await screen.findByRole('dialog', { name: 'A colleague' });
    expect(hint).toHaveTextContent('Use the Authentication menu to set up SSO');
    expect(done('own_invite')).toBeFalsy();
    fireEvent.click(within(hint).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(done('own_invite')).toBeTruthy();
  });

  it('ignores a step that is not in the current path', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderAt('/it/applications?step=map_application', page);
    await waitFor(() => expect(env.server.calls.length).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(env.server.calls.filter((call) => call.method === 'post')).toEqual([]);
  });

  it('lists the portfolio path: a request, its project, the tasks, the reports, your data', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'example' });
    renderAt('/', <FirstStepsTile />);
    const links = await screen.findAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Tasks', '/portfolio/tasks?step=portfolio_tasks'],
      ['The reports', '/portfolio/reports?step=portfolio_time'],
      ['Your data', '/portfolio/projects?step=portfolio_import'],
    ]);
    expect(screen.getByRole('button', { name: 'A request and its score' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The project born from the request' })).toBeInTheDocument();
  });

  it('opens the best-scored request on its scoring tab', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'example' });
    const asked: Array<{ url?: string; config?: unknown }> = [];
    env.summary = async (config, url) => {
      asked.push({ url, config });
      return { data: { items: [{ id: 'r-3', item_number: 3, name: 'Cave Climate Digital Twin' }] } };
    };
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'A request and its score' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portfolio/requests/REQ-3/scoring?step=portfolio_request'));
    expect(asked[0]).toMatchObject({ url: '/portfolio/requests', config: { params: { limit: 1, sort: 'priority_score:DESC' } } });
  });

  it('opens the project resulting from the best-scored converted request', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'example' });
    const asked: Array<{ url?: string; config?: unknown }> = [];
    env.summary = async (config, url) => {
      asked.push({ url, config });
      if (url === '/portfolio/requests') return { data: { items: [{ id: 'r-5', item_number: 5, name: 'Converted' }] } };
      if (url === '/portfolio/requests/r-5/relations') return { data: { resulting_projects: [{ id: 'p-9', item_number: 9, name: 'Born project' }] } };
      return { data: { items: [] } };
    };
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'The project born from the request' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portfolio/projects/PRJ-9/summary?step=portfolio_project'));
    const filters = JSON.parse((asked[0].config as { params: { filters: string } }).params.filters);
    expect(filters).toEqual({ status: { filterType: 'set', values: ['converted'] } });
  });

  it('opens the best-scored project when no request was converted', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'example' });
    env.summary = async (_config, url) => (url === '/portfolio/projects'
      ? { data: { items: [{ id: 'p-4', item_number: 4, name: 'Zero Trust Fromage' }] } }
      : { data: { items: [] } });
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'The project born from the request' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portfolio/projects/PRJ-4/summary?step=portfolio_project'));
  });
});
