import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import AllSettingsPage, { normalizeSearchText } from './AllSettingsPage';

type Person = {
  perms: Record<string, string>;
  administrator?: boolean;
  platformAdmin?: boolean;
  limited?: boolean;
};

const state = vi.hoisted(() => ({
  person: { perms: {} } as { perms: Record<string, string>; administrator?: boolean; platformAdmin?: boolean; limited?: boolean },
  mode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  platformHost: false,
  aiAvailable: true,
}));

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 };
// Same reserved levels as `auth/dataAccess.ts` for a limited person.
const RESERVED_WRITES = new Set(['companies', 'departments', 'cost_centers', 'accounts', 'business_processes', 'analytics', 'budget_ops', 'users', 'ai_settings']);

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    claims: {
      isGlobalAdmin: !!state.person.administrator,
      isPlatformAdmin: !!state.person.platformAdmin,
      isBillingAdmin: !!state.person.administrator,
      permissions: state.person.perms,
    },
    dataAccess: state.person.limited ? { available: true, mode: 'limited', nodes: [], modules: [] } : null,
    hasLevel: (resource: string, level: string) => {
      if (state.person.administrator || state.person.platformAdmin) return true;
      if (state.person.limited && (resource === 'ai_agents' || (RESERVED_WRITES.has(resource) && level !== 'reader'))) return false;
      const held = state.person.perms[resource];
      return !!held && RANK[held] >= RANK[level];
    },
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: state.platformHost }) }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: {
      deploymentMode: state.mode,
      features: state.mode === 'single-tenant'
        ? { billing: false, sso: false, aiSettings: true, aiChat: true, aiMcp: true, sampleData: false }
        : { billing: true, sso: true, aiSettings: true, aiChat: true, aiMcp: true, sampleData: true },
    },
    isSingleTenant: state.mode === 'single-tenant',
  }),
}));
vi.mock('../../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({
    isLoading: false,
    data: {
      surfaces: { settings: { available: state.aiAvailable && (!!state.person.administrator || state.person.perms.ai_settings === 'admin') } },
      instance_features: { ai_settings: state.aiAvailable },
    },
  }),
}));

function renderPage() {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <AllSettingsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/** Group headings, then the page names of one group. */
const groupNames = () => screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
const linksOf = (group: string) => within(screen.getByRole('region', { name: group })).getAllByRole('link').map((link) => link.textContent);
const hrefOf = (name: string) => screen.getByRole('link', { name }).getAttribute('href');

function as(person: Person, options: { mode?: 'multi-tenant' | 'single-tenant'; platformHost?: boolean } = {}) {
  state.person = person;
  state.mode = options.mode ?? 'multi-tenant';
  state.platformHost = options.platformHost ?? false;
}

describe('AllSettingsPage', () => {
  beforeEach(async () => {
    state.aiAvailable = true;
    await act(async () => { await i18n.changeLanguage('en'); });
  });
  afterEach(() => cleanup());

  it('lists everything an Administrator opens in the cloud, without installation or platform pages', () => {
    as({ perms: {}, administrator: true });
    renderPage();
    // The title of an Administration page, without the grey mention beside it.
    expect(screen.getByRole('heading', { name: 'All settings' }).parentElement).toHaveTextContent(/^All settings$/);
    expect(groupNames()).toEqual(['My account', 'AI agents', 'Portfolio', 'IT landscape', 'Knowledge', 'Budget management', 'Administration']);
    expect(linksOf('My account')).toEqual(['Profile', 'Notifications', 'Appearance', 'Connected apps', 'About', 'Customize the home page']);
    expect(linksOf('Administration')).toEqual([
      'Users', 'Roles', 'Data access', 'Audit log', 'Billing', 'Authentication', 'Branding', 'Sample data',
      'AI models', 'Kad', 'Usage & costs', 'Integrations',
    ]);
    expect(linksOf('IT landscape')).toEqual(['IT landscape settings', 'Netbox']);
    // The link opens the page, and the tab when it is in the address.
    expect(hrefOf('Netbox')).toBe('/it/settings?tab=netbox');
    expect(hrefOf('Notifications')).toBe('/settings/notifications');
    expect(hrefOf('Currencies')).toBe('/ops/operations/currency');
    // A grey menu path beside the name.
    expect(screen.getByRole('link', { name: 'Currencies' }).parentElement).toHaveTextContent('Budget management › Administration');
  });

  it('shows the installation pages to the Administrator on site, and neither billing nor sample data', () => {
    as({ perms: {}, administrator: true }, { mode: 'single-tenant' });
    renderPage();
    expect(groupNames()).toEqual(['My account', 'AI agents', 'Portfolio', 'IT landscape', 'Knowledge', 'Budget management', 'Administration', 'Installation']);
    expect(linksOf('Installation')).toEqual(['Scheduled tasks']);
    const administration = linksOf('Administration');
    expect(administration).not.toContain('Billing');
    expect(administration).not.toContain('Sample data');
    expect(administration).not.toContain('Authentication');
  });

  it('shows a budget administrator the budget settings alone', () => {
    as({ perms: { budget: 'admin', budget_ops: 'admin' } });
    renderPage();
    expect(groupNames()).toEqual(['My account', 'Budget management']);
    expect(linksOf('Budget management')).toEqual([
      'Administration', 'Currencies', 'Budget columns', 'Default allocation method', 'Freeze / unfreeze data',
      'Copy budget columns', 'Clear a budget column', 'Freeze master data', 'Copy yearly metrics',
    ]);
    expect(linksOf('My account')).not.toContain('Connected apps');
  });

  it('shows a reader of budget administration the two budget settings pages, and no operation', () => {
    as({ perms: { budget: 'reader', budget_ops: 'reader' } });
    renderPage();
    expect(groupNames()).toEqual(['My account', 'Budget management']);
    expect(linksOf('Budget management')).toEqual(['Administration', 'Budget columns', 'Default allocation method']);
  });

  it('shows an IT landscape reader the lists, which open read only, and not Netbox', () => {
    as({ perms: { applications: 'reader', infrastructure: 'reader', locations: 'reader', settings: 'reader' } });
    renderPage();
    expect(groupNames()).toEqual(['My account', 'IT landscape']);
    expect(linksOf('IT landscape')).toEqual(['IT landscape settings']);
  });

  it('shows a person with limited data access none of the budget settings', () => {
    as({ perms: { budget: 'admin', budget_ops: 'admin', contracts: 'admin' }, limited: true });
    renderPage();
    expect(groupNames()).toEqual(['My account']);
  });

  it('shows a business contributor their account and the knowledge libraries', () => {
    as({ perms: { tasks: 'member', portfolio_requests: 'contributor', knowledge: 'reader' } });
    renderPage();
    expect(groupNames()).toEqual(['My account', 'Knowledge']);
    expect(linksOf('Knowledge')).toEqual(['Manage library']);
  });

  it('shows the platform administrator the platform pages, and scheduled tasks under Installation as the menu does', () => {
    as({ perms: {}, platformAdmin: true }, { platformHost: true });
    renderPage();
    expect(groupNames()).toEqual(['Installation', 'Platform']);
    expect(linksOf('Installation')).toEqual(['Scheduled tasks']);
    expect(hrefOf('Scheduled tasks')).toBe('/admin/installation/scheduled-tasks');
    expect(linksOf('Platform')).toEqual(['Tenants', 'Trials', 'CoA templates', 'Standard accounts', 'Platform AI', 'Ops dashboard']);
  });

  it('shows an Administrator of the platform workspace no installation page on the platform host', () => {
    as({ perms: {}, administrator: true }, { platformHost: true });
    renderPage();
    expect(groupNames()).toEqual([]);
    expect(screen.getByText('No settings page is open to you here.')).toBeInTheDocument();
  });

  it('shows a limited Administrator on site no Installation group', () => {
    as({ perms: {}, administrator: true, limited: true }, { mode: 'single-tenant' });
    renderPage();
    expect(groupNames()).not.toContain('Installation');
    expect(linksOf('Administration')).not.toContain('Data access');
  });

  it('shows an agents reader the shared context profiles, which open read only', () => {
    as({ perms: { ai_agents: 'reader' } });
    renderPage();
    expect(groupNames()).toEqual(['My account', 'AI agents']);
    expect(linksOf('AI agents')).toEqual(['Shared context']);
    expect(hrefOf('Shared context')).toBe('/agents/shared-context');
  });

  it('finds a page by the name of one of its settings', () => {
    as({ perms: {}, administrator: true });
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), { target: { value: 'Reporting  CURRENCY' } });
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Currencies']);
  });

  it('finds the integrations page by the name of each connection card', () => {
    as({ perms: {}, administrator: true });
    renderPage();
    const search = screen.getByRole('textbox', { name: 'Search settings' });
    for (const value of ['PRTG', 'GLPI']) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getAllByRole('link').map((link) => link.textContent), value).toEqual(['Integrations']);
    }
    fireEvent.change(search, { target: { value: 'Netbox inventory' } });
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Integrations']);
  });

  it('searches in the language of the person, without accents', async () => {
    await act(async () => { await i18n.changeLanguage('fr'); });
    as({ perms: {}, administrator: true });
    renderPage();
    const search = screen.getByRole('textbox', { name: 'Rechercher un paramètre' });
    fireEvent.change(search, { target: { value: 'devise de reporting' } });
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Devises']);
    fireEvent.change(search, { target: { value: 'parametres' } });
    expect(screen.getByRole('region', { name: 'Portefeuille' })).toBeInTheDocument();
  });

  it('says in one line that nothing matches', () => {
    as({ perms: {}, administrator: true });
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('No settings match “zzz”.')).toBeInTheDocument();
  });

  it('normalises case, accents and spaces', () => {
    expect(normalizeSearchText('  Paramètres   du PORTEFEUILLE ')).toBe('parametres du portefeuille');
  });
});
