import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { createFakeOnboardingServer } from '../../test/fakeOnboardingServer';
import FirstStepsTile from './FirstStepsTile';
import StepHint, { STEP_OBJECT_POLL_MS } from './StepHint';
import { writeActiveStep } from './activeStep';
import { ONBOARDING_QUERY_KEY } from './useOnboarding';
import { AGENT_NAME } from '../../config/product';

const env = vi.hoisted(() => ({
  summary: (() => Promise.resolve({ data: { items: [] } })) as (config?: unknown, url?: string) => Promise<unknown>,
  server: null as unknown as ReturnType<typeof import('../../test/fakeOnboardingServer').createFakeOnboardingServer>,
  discoveryCallUrl: '',
}));

vi.mock('../../api', () => ({
  default: {
    get: (url: string, config?: unknown) => (['/budget-lines/summary', '/onboarding/showcase-application'].includes(url) || url.startsWith('/portfolio/')
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
    subscription: { status: 'trialing', is_subscription_healthy: true, trial_days_remaining: 9 },
    refreshMe: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { deploymentMode: 'multi-tenant', features: {}, discoveryCall: { url: env.discoveryCallUrl, fallbackEmail: '' } },
  }),
}));

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

/** A link of the page under test: opens `to` inside the app. */
function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>{`go ${to}`}</button>;
}

function renderAt(
  path: string | { pathname: string; search?: string; state?: unknown },
  node: React.ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  theme = createAppTheme('light'),
) {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={theme}>
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
    expect(links.map((link) => link.textContent)).toEqual(['The overview', 'A report', `A question for ${AGENT_NAME}`, 'Your data']);
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

  it('opens the application the server chooses for the application step', async () => {
    env.server = createFakeOnboardingServer({ angle: 'cartography', mode: 'example' });
    let asked: { url?: string; config?: unknown } = {};
    env.summary = async (config, url) => {
      asked = { url, config };
      return { data: { item: { id: 'app-1', name: 'SAP S/4HANA' } } };
    };
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'An application record' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/it/applications/app-1?step=map_application'));
    expect(asked.url).toBe('/onboarding/showcase-application');
  });

  it('opens the list for the application step when the server chooses no application', async () => {
    env.server = createFakeOnboardingServer({ angle: 'cartography', mode: 'example' });
    env.summary = async () => ({ data: { item: null } });
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: 'An application record' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/it/applications?step=map_application'));
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
      'Your locations', 'Your applications', 'Your technologies', 'Your assets', 'A colleague',
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

  it('reads the steps again when it shows, so that a step done by its object on another screen is ticked', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The state read before the contract was created, still fresh in the cache.
    client.setQueryData(ONBOARDING_QUERY_KEY, env.server.state());
    env.server.db.objects.add('own_contract');
    renderAt('/', <FirstStepsTile />, client);
    await waitFor(() => expect(screen.getByText('1/5')).toBeInTheDocument());
    expect(done('own_contract')).toBeTruthy();
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
    expect(screen.queryByText('Restart this path')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'IT landscape map' }));
    await waitFor(() => expect(screen.getByText('0/5')).toBeInTheDocument());
    expect(env.server.db.angle).toBe('cartography');
    expect(screen.getAllByRole('link')[0]).toHaveTextContent('The application list');
  });

  it('offers a discovery call at the end of a path during the trial, when a booking page is set', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    for (const key of ['budget_overview', 'budget_line', 'budget_report', 'budget_plaid', 'budget_import']) {
      env.server.db.done.set(`budget/example/${key}`, '2026-11-02T09:20:00.000Z');
    }
    const first = renderAt('/', <FirstStepsTile />);
    await screen.findByText('IT budget path complete!');
    expect(screen.queryByRole('link', { name: 'Book a discovery call' })).not.toBeInTheDocument();
    first.unmount();

    env.discoveryCallUrl = 'https://cal.example/discovery';
    try {
      renderAt('/', <FirstStepsTile />);
      const book = await screen.findByRole('link', { name: 'Book a discovery call' });
      expect(book).toHaveAttribute('href', 'https://cal.example/discovery');
      expect(book).toHaveAttribute('target', '_blank');
    } finally {
      env.discoveryCallUrl = '';
    }
  });

  it('changes the path from its header', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderAt('/', <FirstStepsTile />);
    await screen.findByText('0/5');
    fireEvent.click(screen.getByRole('button', { name: 'Change path' }));
    fireEvent.click(await screen.findByRole('button', { name: 'The IT landscape map' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Explore with the complete example' }));
    await waitFor(() => expect(env.server.db.angle).toBe('cartography'));
    await waitFor(() => expect(screen.getAllByRole('link')[0]).toHaveTextContent('The application list'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves the path to the administrators once it is chosen', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example', administrator: false });
    renderAt('/', <FirstStepsTile />);
    await screen.findByText('0/5');
    expect(screen.queryByRole('button', { name: 'Change path' })).not.toBeInTheDocument();
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
    writeActiveStep(null);
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

  it('stands in the bottom-right corner of the window, apart from the title it outlines', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderAt('/ops/budget?step=budget_overview', page);
    const hint = await screen.findByRole('dialog', { name: 'The overview' });
    expect(hint).toHaveStyle({ position: 'fixed', right: '16px', bottom: '16px' });
    expect(hint.closest('[data-popper-placement]')).toBeNull();
    expect(screen.getByTestId('step-hint-outline')).toBeInTheDocument();
  });

  it('draws the hint and its outline in the colour of the theme, with a shadow, in dark mode too', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    const dark = createAppTheme('dark');
    renderAt('/ops/budget?step=budget_overview', page, undefined, dark);
    const hint = await screen.findByRole('dialog', { name: 'The overview' });
    // The hint stands apart from its element: the same ring as the outline ties the two together.
    expect(hint).toHaveStyle({ border: `1px solid ${dark.palette.primary.main}`, boxShadow: dark.shadows[3] });
    expect(screen.getByTestId('step-hint-outline')).toHaveStyle({ outline: `2px solid ${dark.palette.primary.main.toLowerCase()}` });
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

  it('points at the tab row of a record opened from its list, which the bubble would hide under the title', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    const box = { top: 240, left: 260, width: 900, height: 40, x: 260, y: 240, right: 1160, bottom: 280 };
    renderAt('/ops/contracts/new/overview?step=own_contract', (
      <main>
        <h5 className="MuiTypography-h5">New contract</h5>
        <div role="tablist" aria-label="tabs" data-testid="tabs" />
        <StepHint />
      </main>
    ));
    screen.getByTestId('tabs').getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
    await screen.findByRole('dialog', { name: 'A linked contract' });
    await waitFor(() => expect(screen.getByTestId('step-hint-outline').style.top).toBe('236px'));
    expect(screen.getByTestId('step-hint-outline').style.left).toBe('254px');
  });

  it('points at the title of its list, tabs or not', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    const box = { top: 60, left: 236, width: 200, height: 32, x: 236, y: 60, right: 436, bottom: 92 };
    renderAt('/ops/reports/top-opex?step=own_report', (
      <main>
        <h5 className="MuiTypography-h5" data-testid="title">Top lines</h5>
        <div role="tablist" aria-label="tabs" />
        <StepHint />
      </main>
    ));
    screen.getByTestId('title').getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByTestId('step-hint-outline').style.top).toBe('56px'));
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

  it('waits for "Done" with your own data on a step that creates nothing, then opens the next step', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    renderAt('/master-data/companies?step=own_company', page);
    const hint = await screen.findByRole('dialog', { name: 'Your company' });
    expect(done('own_company')).toBeFalsy();
    fireEvent.click(within(hint).getByRole('button', { name: 'Done' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next step' }));
    expect(done('own_company')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/ops/budget?step=own_budget_lines'));
    expect(await screen.findByRole('dialog', { name: 'Your budget lines' })).toHaveTextContent('click Import first to download the example file');
  });

  it('stays with its step on every screen, outlining its element on the screen of its step only, until it is closed', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    renderAt('/master-data/companies?step=own_company', (
      <>
        {page}
        <Go to="/master-data/companies/C-1/overview" />
        <Go to="/master-data/companies" />
        <Go to="/ops/contracts" />
      </>
    ));
    await screen.findByRole('dialog', { name: 'Your company' });
    fireEvent.click(screen.getByRole('button', { name: 'go /master-data/companies/C-1/overview' }));
    expect(await screen.findByRole('dialog', { name: 'Your company' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'go /ops/contracts' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/ops\/contracts$/));
    await waitFor(() => expect(screen.queryByTestId('step-hint-outline')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Your company' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'go /master-data/companies' }));
    await waitFor(() => expect(screen.getByTestId('step-hint-outline')).toBeInTheDocument());
    const hint = screen.getByRole('dialog', { name: 'Your company' });
    fireEvent.click(within(hint).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'go /master-data/companies/C-1/overview' }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays on the screens its step leads to: a technology and the vulnerabilities from the end of support', async () => {
    env.server = createFakeOnboardingServer({ angle: 'cartography', mode: 'example' });
    renderAt('/it/technologies/end-of-support?step=map_technologies', (
      <>
        {page}
        <Go to="/it/technologies/tech-1" />
        <Go to="/it/vulnerabilities" />
      </>
    ));
    await screen.findByRole('dialog', { name: 'Technologies, end of support and vulnerabilities' });
    fireEvent.click(screen.getByRole('button', { name: 'go /it/technologies/tech-1' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/it\/technologies\/tech-1$/));
    expect(screen.getByRole('dialog', { name: 'Technologies, end of support and vulnerabilities' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'go /it/vulnerabilities' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/it\/vulnerabilities$/));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByRole('dialog', { name: 'Technologies, end of support and vulnerabilities' })).toBeInTheDocument();
  });

  it('stays on the project a request of its step was converted into', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'own_data' });
    renderAt('/portfolio/requests?step=own_request', (
      <>
        {page}
        <Go to="/portfolio/requests/REQ-1/summary" />
        <Go to="/portfolio/projects/PRJ-1/summary" />
      </>
    ));
    await screen.findByRole('dialog', { name: 'Your first request' });
    fireEvent.click(screen.getByRole('button', { name: 'go /portfolio/requests/REQ-1/summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'go /portfolio/projects/PRJ-1/summary' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/portfolio\/projects\/PRJ-1\/summary$/));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByRole('dialog', { name: 'Your first request' })).toBeInTheDocument();
  });

  it('says « étape » in French, the title of the first steps aside', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    env.server.db.done.set('budget/own_data/own_company', '2026-11-02T09:20:00.000Z');
    await i18n.changeLanguage('fr');
    try {
      renderAt('/master-data/companies?step=own_company', <>{page}<FirstStepsTile /></>);
      const hint = await screen.findByRole('dialog', { name: 'Votre société' });
      expect(within(hint).getByRole('button', { name: 'Étape suivante' })).toBeInTheDocument();
      expect(await screen.findByText('Vos cinq premiers pas')).toBeInTheDocument();
      const firstSteps = i18n.getResource('fr', 'common', 'onboarding.firstSteps') as Record<string, unknown>;
      const { title: _title, hide: _hide, showAgain: _showAgain, ...rest } = firstSteps;
      // Outside the name of the first steps, « pas » is only ever a negation.
      expect(JSON.stringify(rest)).not.toMatch(/\b(le|un|du|ce|des|cinq|chaque) pas\b/i);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('turns to the next step once the object of its step exists', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
      renderAt('/ops/contracts?step=own_contract', page);
      await screen.findByRole('dialog', { name: 'A linked contract' });
      expect(screen.queryByRole('button', { name: 'Next step' })).not.toBeInTheDocument();
      env.server.db.objects.add('own_contract');
      await act(async () => { vi.advanceTimersByTime(STEP_OBJECT_POLL_MS + 100); });
      expect(await screen.findByRole('button', { name: 'Next step' })).toBeInTheDocument();
      expect(done('own_contract')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the path on the home page', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    for (const key of ['budget_overview', 'budget_line', 'budget_report', 'budget_plaid']) {
      env.server.db.done.set(`budget/example/${key}`, '2026-11-02T09:20:00.000Z');
    }
    renderAt('/ops/budget?step=budget_import', page);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves a step that creates an object to that object, and gives the hint of the angle', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'own_data' });
    renderAt('/admin/users?step=own_invite', page);
    const hint = await screen.findByRole('dialog', { name: 'A colleague' });
    expect(hint).toHaveTextContent('Use the Authentication menu to set up SSO');
    expect(within(hint).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    fireEvent.click(within(hint).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(done('own_invite')).toBeFalsy();
  });

  it('describes project availability on your own contributor profile, without a team', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'own_data' });
    renderAt('/portfolio/contributors/me?step=own_invite', page);
    const hint = await screen.findByRole('dialog', { name: 'Your contributor profile' });
    expect(hint).toHaveTextContent('Here is your contributor profile. Set your project availability.');
    expect(hint.textContent).not.toMatch(/team/i);

    const expected: Record<string, string> = {
      fr: 'Voici votre fiche contributeur. Indiquez votre disponibilité projet.',
      de: 'Hier ist Ihr Mitwirkendenprofil. Geben Sie Ihre Projektverfügbarkeit an.',
      es: 'Este es su perfil de colaborador. Indique su disponibilidad para proyectos.',
    };
    for (const [lng, text] of Object.entries(expected)) {
      await i18n.changeLanguage(lng);
      expect(i18n.t('onboarding.firstSteps.steps.own_invite.hint.portfolio')).toBe(text);
      expect(i18n.t('onboarding.firstSteps.steps.own_invite.hint.portfolio')).not.toMatch(/équipe|Team|equipo/i);
    }
    await i18n.changeLanguage('en');
  });

  it('follows its element when the screen replaces it, rises above it in its corner and stays without it', async () => {
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    // The composer at the bottom of a 1024 x 768 window, under the corner of the hint.
    const box = { top: 668, left: 200, width: 800, height: 40, x: 200, y: 668, right: 1000, bottom: 708 };
    const rect = vi.spyOn(HTMLTextAreaElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ ...box, toJSON: () => box } as DOMRect);
    function Plaid() {
      const [stage, setStage] = React.useState<'consent' | 'composer' | 'none'>('consent');
      return (
        <main>
          <button type="button" onClick={() => setStage('composer')}>Accept</button>
          <button type="button" onClick={() => setStage('none')}>Leave</button>
          {stage === 'consent' ? <div data-plaid-composer>Turn Plaid on</div> : null}
          {stage === 'composer' ? <textarea aria-label="Message" /> : null}
          <StepHint />
        </main>
      );
    }
    try {
      renderAt('/ai?step=budget_plaid', <Plaid />);
      const hint = await screen.findByRole('dialog', { name: `A question for ${AGENT_NAME}` });
      // The acceptance box is away from the corner: the hint stays in it.
      expect(hint.style.bottom).toBe('16px');
      const bubble = { top: 0, left: 0, width: 360, height: 120, x: 0, y: 0, right: 360, bottom: 120 };
      hint.getBoundingClientRect = () => ({ ...bubble, toJSON: () => bubble }) as DOMRect;

      // Accepting replaces the acceptance box by the composer: the outline moves to the composer,
      // and the hint rises above it so as not to cover it (768 - 668 + 12).
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
      await waitFor(() => expect(screen.getByTestId('step-hint-outline').style.top).toBe('664px'));
      expect(screen.getByTestId('step-hint-outline').style.left).toBe('194px');
      await waitFor(() => expect(screen.getByRole('dialog', { name: `A question for ${AGENT_NAME}` }).style.bottom).toBe('112px'));

      // Without its element on the screen, the hint stays in its corner, with no outline.
      fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
      await waitFor(() => expect(screen.queryByTestId('step-hint-outline')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('dialog', { name: `A question for ${AGENT_NAME}` }).style.bottom).toBe('16px'));
    } finally {
      rect.mockRestore();
    }
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

  it('opens your project on its Relations tab for its budget, and your contributor profile last', async () => {
    env.server = createFakeOnboardingServer({ angle: 'portfolio', mode: 'own_data' });
    env.summary = async (_config, url) => (url === '/portfolio/projects'
      ? { data: { items: [{ id: 'p-1', item_number: 1, name: 'My project' }] } }
      : { data: { items: [] } });
    renderAt('/', <FirstStepsTile />);
    fireEvent.click(await screen.findByRole('button', { name: "The project's budget" }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/portfolio/projects/PRJ-1/relations?step=own_project_budget'));
    cleanup();
    renderAt('/', <FirstStepsTile />);
    expect(await screen.findByRole('link', { name: 'Your contributor profile' })).toHaveAttribute('href', '/portfolio/contributors/me?step=own_invite');
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
