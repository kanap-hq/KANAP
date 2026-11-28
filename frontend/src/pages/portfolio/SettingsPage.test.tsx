import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import SettingsPage from './SettingsPage';
import { SETTINGS_TABS } from './settings/tabs';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));
const rights = vi.hoisted(() => ({ admin: true }));

vi.mock('../../api', () => ({ default: api }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => level !== 'admin' || rights.admin }),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const DATA: Record<string, unknown> = {
  '/portfolio/criteria': [{ id: id(1), name: 'Impact', enabled: true, inverted: false, weight: 1, display_order: 0, values: [] }],
  '/portfolio/settings': { mandatory_bypass_enabled: false },
  '/portfolio/skills': { items: [], grouped: {} },
  '/portfolio/phase-templates': [{ id: id(2), name: 'Standard', is_system: false, sequence: 0, items: [] }],
  '/portfolio/classification/all': { sources: [], categories: [], taskTypes: [] },
  '/portfolio/teams': [],
  '/portfolio/employment-types': [{ id: id(3), name: 'Contractor', is_active: true, display_order: 0, is_system: false, usage_count: 0 }],
};

function Address() {
  const location = useLocation();
  const type = useNavigationType();
  return <div data-testid="address">{`${location.pathname} ${type}`}</div>;
}

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/portfolio/settings" element={<SettingsPage />} />
              <Route path="/portfolio/settings/:tab" element={<SettingsPage />} />
            </Routes>
            <Address />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const address = () => screen.getByTestId('address').textContent;
const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;
const loaded = () => api.get.mock.calls.map(([url]) => url).sort();
/** The buttons of the title row: those outside the tabs and their content. */
const headerButtons = () => within(screen.getByRole('heading', { name: 'settings.title' }).parentElement!.parentElement!)
  .queryAllByRole('button').map((button) => button.textContent);

describe('portfolio SettingsPage address', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.get.mockImplementation(async (url: string) => ({ data: DATA[url] }));
    rights.admin = true;
  });

  it('keeps the six tabs in screen order with their slugs', () => {
    expect(SETTINGS_TABS.map((tab) => tab.slug)).toEqual(['criteria', 'skills', 'phase-templates', 'classification', 'teams', 'contract-types']);
  });

  it.each(['/portfolio/settings', '/portfolio/settings/xyz'])('opens the criteria on %s, in place of the address', async (path) => {
    renderAt(path);
    expect(await screen.findByText('Impact')).toBeInTheDocument();
    expect(address()).toBe('/portfolio/settings/criteria REPLACE');
    expect(selectedTab()).toBe('settings.tabs.scoringCriteria');
  });

  it('opens the tab its address names, and loads only its lists', async () => {
    renderAt('/portfolio/settings/teams');
    expect(await screen.findByText('settings.teams.empty')).toBeInTheDocument();
    expect(selectedTab()).toBe('settings.tabs.teams');
    expect(loaded()).toEqual(['/portfolio/teams']);
  });

  it('puts the tab chosen in the address, in place of the previous one', async () => {
    renderAt('/portfolio/settings/criteria');
    await screen.findByText('Impact');
    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.phaseTemplates' }));
    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(address()).toBe('/portfolio/settings/phase-templates REPLACE');
    expect(screen.queryByText('Impact')).toBeNull();
  });

  it('shows a refused list in its own tab, and the other tabs still work', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/teams') throw { response: { status: 403, data: { message: 'Forbidden resource' } } };
      return { data: DATA[url] };
    });
    renderAt('/portfolio/settings/teams');
    expect(await screen.findByRole('alert')).toHaveTextContent('errors:forbidden');

    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.employmentTypes' }));
    expect(await screen.findByText('Contractor')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(address()).toBe('/portfolio/settings/contract-types REPLACE');
  });

  it.each([
    ['criteria', 'Impact', ['settings.actions.addCriterion']],
    ['skills', 'settings.skills.empty', ['settings.actions.seedDefaults', 'settings.actions.addSkill']],
    ['phase-templates', 'Standard', ['settings.actions.addTemplate']],
    ['classification', 'settings.classification.empty.sources', []],
    ['teams', 'settings.teams.empty', ['settings.actions.seedDefaults', 'settings.actions.addTeam']],
    ['contract-types', 'Contractor', ['settings.actions.addEmploymentType']],
  ])('shows the buttons of the %s tab in the title row', async (slug, shown, buttons) => {
    renderAt(`/portfolio/settings/${slug}`);
    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(headerButtons()).toEqual(buttons);
  });

  it('shows a reader no button in the title row and no edit in the tab', async () => {
    rights.admin = false;
    renderAt('/portfolio/settings/contract-types');
    expect(await screen.findByText('Contractor')).toBeInTheDocument();
    expect(headerButtons()).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
