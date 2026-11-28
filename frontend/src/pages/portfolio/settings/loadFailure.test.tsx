import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import SettingsPage from '../SettingsPage';
import type { SettingsTabSlug } from './tabs';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));

vi.mock('../../../api', () => ({ default: api }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));

/** What each tab reads, empty, and what it shows then: its empty lines and its buttons. */
const TABS: Record<SettingsTabSlug, { data: Record<string, unknown>; empty: string[]; buttons: string[] }> = {
  criteria: {
    data: { '/portfolio/criteria': [], '/portfolio/settings': { mandatory_bypass_enabled: false } },
    empty: ['settings.scoring.empty'],
    buttons: ['settings.actions.addCriterion'],
  },
  skills: {
    data: { '/portfolio/skills': { items: [], grouped: {} } },
    empty: ['settings.skills.empty'],
    buttons: ['settings.actions.seedDefaults', 'settings.actions.addSkill'],
  },
  'phase-templates': {
    data: { '/portfolio/phase-templates': [] },
    empty: ['settings.phaseTemplates.empty'],
    buttons: ['settings.actions.addTemplate'],
  },
  classification: {
    data: { '/portfolio/classification/all': { sources: [], categories: [], taskTypes: [] } },
    empty: [
      'settings.classification.empty.sources',
      'settings.classification.empty.categories',
      'settings.classification.empty.taskTypes',
    ],
    buttons: ['settings.actions.addSource'],
  },
  teams: {
    data: { '/portfolio/teams': [] },
    empty: ['settings.teams.empty'],
    buttons: ['settings.actions.seedDefaults', 'settings.actions.addTeam'],
  },
  'contract-types': {
    data: { '/portfolio/employment-types': [] },
    empty: ['settings.employmentTypes.empty'],
    buttons: ['settings.actions.seedDefaults', 'settings.actions.addEmploymentType'],
  },
};

function renderTab(slug: SettingsTabSlug) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[`/portfolio/settings/${slug}`]}>
            <Routes>
              <Route path="/portfolio/settings/:tab" element={<SettingsPage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const refusal = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data: { message: status === 403 ? 'Forbidden resource' : 'Internal server error' } },
});

describe('portfolio settings tab whose list could not be read', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  for (const slug of Object.keys(TABS) as SettingsTabSlug[]) {
    const tab = TABS[slug];

    for (const status of [403, 500]) {
      it(`${slug}: a ${status} shows the error alone, without empty state or button`, async () => {
        api.get.mockRejectedValue(refusal(status));
        renderTab(slug);

        const alert = await screen.findByRole('alert');
        expect(alert.className).toContain('MuiAlert-standardError');
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(within(alert).queryAllByRole('button')).toHaveLength(0);
        for (const key of tab.empty) expect(screen.queryByText(key)).toBeNull();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      });
    }

    it(`${slug}: a list read empty keeps its empty state and its buttons`, async () => {
      api.get.mockImplementation(async (url: string) => ({ data: tab.data[url] }));
      renderTab(slug);

      for (const key of tab.empty) expect(await screen.findByText(key)).toBeInTheDocument();
      for (const name of tab.buttons) expect(screen.getByRole('button', { name })).toBeInTheDocument();
      expect(document.querySelector('.MuiAlert-standardError')).toBeNull();
    });
  }
});
