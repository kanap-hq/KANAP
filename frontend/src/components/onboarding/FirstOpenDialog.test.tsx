import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { createFakeOnboardingServer } from '../../test/fakeOnboardingServer';
import FirstOpenDialog from './FirstOpenDialog';
import OnboardingStatusLine from './OnboardingStatusLine';
import AboutOnboardingLine from './AboutOnboardingLine';

const env = vi.hoisted(() => ({
  server: null as unknown as ReturnType<typeof import('../../test/fakeOnboardingServer').createFakeOnboardingServer>,
  administrator: true,
  trialing: true,
  deploymentMode: 'multi-tenant',
}));

vi.mock('../../api', () => ({
  default: {
    get: (url: string) => env.server.api.get(url),
    put: (url: string, body?: unknown) => env.server.api.put(url, body),
    post: (url: string, body?: unknown) => env.server.api.post(url, body),
    delete: (url: string) => env.server.api.delete(url),
  },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u1', email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace' },
    claims: { isGlobalAdmin: env.administrator, isBillingAdmin: false, isPlatformAdmin: false, permissions: {} },
    subscription: env.trialing ? { status: 'trialing', is_subscription_healthy: true } : { status: 'active', is_subscription_healthy: true },
    refreshMe: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: env.deploymentMode, features: { sampleData: true } } }),
}));

function stubStorage(store: Map<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
}

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const choiceCalls = () => env.server.calls.filter((call) => call.method === 'put').map((call) => call.body);

describe('FirstOpenDialog', () => {
  let store: Map<string, string>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    store = new Map();
    stubStorage(store);
    env.administrator = true;
    env.trialing = true;
    env.deploymentMode = 'multi-tenant';
    env.server = createFakeOnboardingServer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the angle, then the mode, and sends both at the end', async () => {
    renderWith(<FirstOpenDialog />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('What brings you to KANAP?');
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['The IT budget', 'The IT landscape map', 'Projects and requests', 'Just looking']),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'The IT budget' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('How do you want to start?');
    expect(choiceCalls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Explore with the complete example' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(choiceCalls()).toEqual([{ angle: 'budget', mode: 'example' }]);
  });

  it('sends the mode alone after "just looking", and goes back to the angle', async () => {
    renderWith(<FirstOpenDialog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Just looking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('What brings you to KANAP?');
    fireEvent.click(screen.getByRole('button', { name: 'Just looking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start with my own data' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(choiceCalls()).toEqual([{ mode: 'own_data' }]);
  });

  it('stays closed when the user may not choose', async () => {
    env.administrator = false;
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example', administrator: false });
    renderWith(<FirstOpenDialog />);
    await waitFor(() => expect(env.server.calls.length).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays closed outside a running trial and on-premise', async () => {
    env.trialing = false;
    const { unmount } = renderWith(<FirstOpenDialog />);
    await waitFor(() => expect(env.server.calls.length).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    env.trialing = true;
    env.deploymentMode = 'single-tenant';
    env.server = createFakeOnboardingServer();
    renderWith(<FirstOpenDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(env.server.calls).toEqual([]);
  });

  it('opens on the mode for a user who may not change the angle another user chose', async () => {
    env.administrator = false;
    env.server = createFakeOnboardingServer({ angle: 'cartography', administrator: false });
    renderWith(<FirstOpenDialog />);
    expect(await screen.findByRole('dialog')).toHaveTextContent('How do you want to start?');
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Explore with the complete example' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(choiceCalls()).toEqual([{ mode: 'example' }]);
  });

  it('does not offer "start with my own data" to a user who is not an administrator while the example is there', async () => {
    env.administrator = false;
    env.server = createFakeOnboardingServer({ administrator: false, sampleData: { status: 'loaded', step: null } });
    renderWith(<FirstOpenDialog />);
    fireEvent.click(await screen.findByRole('button', { name: 'The IT budget' }));
    expect(screen.getByRole('button', { name: 'Explore with the complete example' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start with my own data/ })).not.toBeInTheDocument();
  });

  it('asks before erasing what was created since the example was loaded, then confirms', async () => {
    env.server = createFakeOnboardingServer({ sampleData: { status: 'loaded', step: null }, createdSinceLoad: 3 });
    renderWith(<FirstOpenDialog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Projects and requests' }));
    fireEvent.click(screen.getByRole('button', { name: /Start with my own data/ }));
    await screen.findByText('Erase the example?');
    const confirm = screen.getByRole('dialog');
    expect(confirm).toHaveTextContent('3 items created since the sample data was loaded will also be erased.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Erase everything' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(choiceCalls()).toEqual([
      { angle: 'portfolio', mode: 'own_data' },
      { angle: 'portfolio', mode: 'own_data', confirm_reset: true },
    ]);
    expect(env.server.db.sampleData.status).toBe('resetting');
  });

  it('stays closed for this user once closed', async () => {
    const { unmount } = renderWith(<FirstOpenDialog />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.get('kanap.onboarding.later.u1')).toBe('1');
    unmount();
    renderWith(<FirstOpenDialog />);
    await waitFor(() => expect(env.server.calls.filter((c) => c.method === 'get').length).toBe(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the refusal of the server in the dialog', async () => {
    env.server.api.put = () => Promise.reject(Object.assign(new Error('x'), { response: { status: 403, data: { code: 'administrator_required' } } }));
    renderWith(<FirstOpenDialog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Just looking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explore with the complete example' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an administrator of this workspace can do this.');
  });
});

describe('OnboardingStatusLine', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    env.administrator = false;
    env.deploymentMode = 'multi-tenant';
  });

  it('says that the sample data is loading', async () => {
    env.server = createFakeOnboardingServer({ administrator: false, sampleData: { status: 'loading', step: 'companies' } });
    renderWith(<OnboardingStatusLine />);
    expect(await screen.findByRole('status')).toHaveTextContent(/^Loading sample data\. .+\.$/);
  });

  it('says that the workspace is being erased', async () => {
    env.server = createFakeOnboardingServer({ administrator: false, sampleData: { status: 'resetting', step: null } });
    renderWith(<OnboardingStatusLine />);
    expect(await screen.findByRole('status')).toHaveTextContent('Erasing the content of the workspace.');
  });

  it('says nothing otherwise', async () => {
    env.server = createFakeOnboardingServer({ administrator: false, sampleData: { status: 'loaded', step: null } });
    renderWith(<OnboardingStatusLine />);
    await waitFor(() => expect(env.server.calls.length).toBe(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('AboutOnboardingLine', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    env.trialing = true;
    env.deploymentMode = 'multi-tenant';
  });

  it('shows the path and lets an administrator change it', async () => {
    env.administrator = true;
    env.server = createFakeOnboardingServer({ angle: 'budget', mode: 'example' });
    renderWith(<AboutOnboardingLine />);
    expect(await screen.findByText(/Path: IT budget · example/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'The IT landscape map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explore with the complete example' }));
    await waitFor(() => expect(screen.getByText(/Path: IT landscape map · example/)).toBeInTheDocument());
    expect(choiceCalls()).toEqual([{ angle: 'cartography' }]);
  });

  it('only shows the path to a user who may not change it', async () => {
    env.administrator = false;
    env.server = createFakeOnboardingServer({ mode: 'example', administrator: false, angle: 'portfolio' });
    renderWith(<AboutOnboardingLine />);
    expect(await screen.findByText('Path: Project portfolio · example')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });
});
