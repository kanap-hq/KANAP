import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AboutTab from './AboutTab';
import SettingsPage from './SettingsPage';

// The path line reads the onboarding API: covered by its own test.
vi.mock('../../components/onboarding/AboutOnboardingLine', () => ({ default: () => null }));
vi.mock('react-i18next', async () => {
  const { default: settings } = await import('../../locales/en/settings.json');
  // One stable `t` that renders the English text of settings keys, with interpolation; other keys render as themselves.
  const t = (key: string, options?: Record<string, string>) => {
    const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], settings);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => options?.[name] ?? '');
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

const state = vi.hoisted(() => ({
  deploymentMode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  version: '26.10.1',
  aiMcp: false,
  mcpReader: false,
}));

vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { deploymentMode: state.deploymentMode, features: { aiMcp: state.aiMcp }, version: state.version },
    isLoading: false,
  }),
}));

vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

// The other settings tabs load data of their own; the page test only checks tab selection.
vi.mock('./ProfileTab', () => ({ default: () => <div>profile tab</div> }));
vi.mock('./NotificationsTab', () => ({ default: () => <div>notifications tab</div> }));
vi.mock('./AppearanceTab', () => ({ default: () => <div>appearance tab</div> }));
vi.mock('./ConnectedAppsTab', () => ({ default: () => <div>connected apps tab</div> }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => resource === 'ai_mcp' && state.mcpReader, subscription: null, claims: null }),
}));
vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantName: 'Acme', tenantSlug: 'acme' }),
}));

afterEach(() => {
  state.deploymentMode = 'multi-tenant';
  state.version = '26.10.1';
  state.aiMcp = false;
  state.mcpReader = false;
});

function renderTab() {
  return render(
    <MemoryRouter>
      <AboutTab />
    </MemoryRouter>,
  );
}

describe('AboutTab', () => {
  it('on-premise, shows the version, the deployment and the links', () => {
    state.deploymentMode = 'single-tenant';
    renderTab();

    expect(screen.getByText('About KANAP')).toBeInTheDocument();
    expect(screen.getByText('Version 26.10.1')).toBeInTheDocument();
    expect(screen.getByText('Deployment: on-premise')).toBeInTheDocument();
    const notes = screen.getByRole('link', { name: 'Release notes' });
    expect(notes).toHaveAttribute('href', 'https://github.com/kanap-hq/KANAP/releases/tag/v26.10.1');
    expect(notes).toHaveAttribute('target', '_blank');
    expect(notes).toHaveAttribute('rel', 'noopener');
    const guide = screen.getByRole('link', { name: 'Upgrade guide' });
    expect(guide).toHaveAttribute('href', 'https://doc.kanap.net/on-premise/operations/');
    expect(guide).toHaveAttribute('target', '_blank');
  });

  it('in the cloud, shows the release notes link and no upgrade guide', () => {
    renderTab();

    expect(screen.getByText('Version 26.10.1')).toBeInTheDocument();
    expect(screen.getByText('Deployment: cloud')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Release notes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upgrade guide' })).not.toBeInTheDocument();
  });

  it('while the version is unknown, shows no version line', () => {
    state.version = 'unknown';
    renderTab();

    expect(screen.getByText('About KANAP')).toBeInTheDocument();
    expect(screen.getByText('Deployment: cloud')).toBeInTheDocument();
    expect(screen.queryByText(/Version/)).not.toBeInTheDocument();
  });
});

describe('SettingsPage: About tab', () => {
  it('selects the fourth tab on /settings/about and shows its content', () => {
    render(
      <MemoryRouter initialEntries={['/settings/about']}>
        <Routes>
          <Route path="/settings/:tab" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[3]).toHaveTextContent('About');
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('About KANAP')).toBeInTheDocument();
  });
});

function renderSettings(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:tab" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsPage: Connected apps tab', () => {
  it('shows the tab before About when MCP is on and the user may use it', () => {
    state.aiMcp = true;
    state.mcpReader = true;
    renderSettings('/settings/connected-apps');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs[3]).toHaveTextContent('Connected apps');
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[4]).toHaveTextContent('About');
    expect(screen.getByText('connected apps tab')).toBeInTheDocument();
  });

  it('hides the tab when MCP is off, and its address opens the profile', () => {
    state.mcpReader = true;
    renderSettings('/settings/connected-apps');

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByText('connected apps tab')).not.toBeInTheDocument();
    expect(screen.getByText('profile tab')).toBeInTheDocument();
  });

  it('hides the tab from a user without MCP access', () => {
    state.aiMcp = true;
    renderSettings('/settings/about');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByText('About KANAP')).toBeInTheDocument();
  });
});
