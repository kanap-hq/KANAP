import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import dePortfolio from '../../locales/de/portfolio.json';
import enPortfolio from '../../locales/en/portfolio.json';
import esPortfolio from '../../locales/es/portfolio.json';
import frPortfolio from '../../locales/fr/portfolio.json';
import SettingsPage from './SettingsPage';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));

vi.mock('../../api', () => ({ default: api }));
vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    const values = options ? Object.entries(options).filter(([name]) => name !== 'defaultValue') : [];
    return values.length ? `${key} ${JSON.stringify(Object.fromEntries(values))}` : key;
  };
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, name: string, extra: Record<string, unknown> = {}) => ({ id: id(n), name, is_active: true, is_system: false, display_order: n, ...extra });

const DATA: Record<string, unknown> = {
  '/portfolio/criteria': [],
  '/portfolio/settings': {},
  '/portfolio/skills': { items: [], grouped: {} },
  '/portfolio/phase-templates': [],
  '/portfolio/classification/all': {
    sources: [item(1, 'Board'), item(2, 'Built in', { is_system: true })],
    categories: [{ ...item(3, 'Growth'), streams: [{ ...item(4, 'Sales'), category_id: id(3) }] }],
    taskTypes: [item(5, 'Review')],
  },
  '/portfolio/teams': [item(6, 'Apps', { member_count: 2 }), item(7, 'Spare', { member_count: 0 })],
  '/portfolio/employment-types': [item(8, 'Contractor', { usage_count: 3 }), item(9, 'Intern', { usage_count: 0 })],
};

function renderPage() {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <KanapDialogProvider>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </KanapDialogProvider>
    </ThemeProvider>,
  );
}

/** The trash of the row that shows `name` (its last button), once the tab is open. */
async function trashOf(tab: string, name: string) {
  fireEvent.click(await screen.findByRole('tab', { name: tab }));
  // A stream shows once its category is open.
  if (name === 'Sales') fireEvent.click(await screen.findByText('Growth'));
  const label = await screen.findByText(name);
  const buttons = within(label.closest('.MuiStack-root') as HTMLElement).getAllByRole('button');
  return buttons[buttons.length - 1];
}

const refusal = (n: number, name: string, code: string, usages: Array<{ type: string; total: number }>) =>
  ({ data: { refused: [{ id: id(n), name, code, usages }] } });

describe('portfolio SettingsPage deletes', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.get.mockImplementation(async (url: string) => ({ data: DATA[url] }));
    api.delete.mockResolvedValue({ data: {} });
  });

  it.each([
    ['settings.tabs.classification', 'Board', 1, '/portfolio/classification/sources', 'RECORD_USED_BY'],
    ['settings.tabs.classification', 'Built in', 2, '/portfolio/classification/sources', 'BUILT_IN_RECORD'],
    ['settings.tabs.classification', 'Growth', 3, '/portfolio/classification/categories', 'RECORD_USED_BY'],
    ['settings.tabs.classification', 'Sales', 4, '/portfolio/classification/streams', 'RECORD_USED_BY'],
    ['settings.tabs.classification', 'Review', 5, '/portfolio/classification/task-types', 'RECORD_USED_BY'],
    ['settings.tabs.teams', 'Apps', 6, '/portfolio/teams', 'TEAM_NOT_EMPTY'],
    ['settings.tabs.employmentTypes', 'Contractor', 8, '/portfolio/employment-types', 'RECORD_USED_BY'],
  ])('in %s, asks before deleting %s, and a refused one says why with Close only', async (tab, name, n, base, code) => {
    api.post.mockResolvedValue(refusal(n, name, code, [{ type: 'requests', total: 1 }]));
    renderPage();
    const trash = await trashOf(tab, name);
    expect(trash).not.toBeDisabled();
    fireEvent.click(trash);
    const dialog = await screen.findByRole('dialog');
    expect(api.post).toHaveBeenCalledWith(`${base}/delete-check`, { ids: [id(n)] });
    expect(dialog).toHaveTextContent(`common:delete.recordTitle {"name":"${name}"}`);
    expect(dialog).toHaveTextContent(`errors:${code}`);
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['buttons.close']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['settings.tabs.classification', 'Board', 1, '/portfolio/classification/sources'],
    ['settings.tabs.teams', 'Spare', 7, '/portfolio/teams'],
    ['settings.tabs.employmentTypes', 'Intern', 9, '/portfolio/employment-types'],
  ])('in %s, confirms the delete of %s by its name, then deletes it', async (tab, name, n, base) => {
    api.post.mockResolvedValue({ data: { refused: [] } });
    renderPage();
    fireEvent.click(await trashOf(tab, name));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(`common:delete.recordTitle {"name":"${name}"}`);
    expect(dialog).not.toHaveTextContent('systemDialogs.confirmTitle');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${base}/${id(n)}`));
  });
});

const EMPTY_LINES: Array<[string, Record<string, string>]> = [
  ['settings.skills.empty', {
    en: 'No skills yet.',
    fr: 'Aucune compétence pour le moment.',
    de: 'Noch keine Kompetenzen.',
    es: 'Aún no hay competencias.',
  }],
  ['settings.teams.empty', {
    en: 'No teams yet.',
    fr: 'Aucune équipe pour le moment.',
    de: 'Noch keine Teams.',
    es: 'Aún no hay equipos.',
  }],
  ['workspace.project.effort.states.noTimeLogged', {
    en: 'No time logged yet.',
    fr: 'Aucun temps enregistré pour le moment.',
    de: 'Noch keine Zeit erfasst.',
    es: 'Aún no se ha registrado tiempo.',
  }],
  ['workspace.project.timeline.states.noMilestones', {
    en: 'No milestones yet.',
    fr: 'Aucun jalon pour le moment.',
    de: 'Noch keine Meilensteine.',
    es: 'Aún no hay hitos.',
  }],
  ['contributors.states.empty', {
    en: 'No contributors yet.',
    fr: 'Aucun contributeur pour le moment.',
    de: 'Noch keine Mitwirkenden.',
    es: 'Aún no hay colaboradores.',
  }],
];

const portfolios = { en: enPortfolio, fr: frPortfolio, de: dePortfolio, es: esPortfolio };

function readLocale(root: unknown, path: string): unknown {
  return path.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), root);
}

describe('portfolio SettingsPage empty skills and teams', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.get.mockImplementation(async (url: string) => ({
      data: url === '/portfolio/teams' ? [] : DATA[url],
    }));
  });

  it('shows one tertiary line and no info alert', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'settings.tabs.skills' }));
    expect(await screen.findByText('settings.skills.empty')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.teams' }));
    expect(await screen.findByText('settings.teams.empty')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the five empty states to one short line in each language', () => {
    for (const [path, expected] of EMPTY_LINES) {
      for (const [lang, sentence] of Object.entries(expected)) {
        expect(readLocale(portfolios[lang as keyof typeof portfolios], path), `${lang} ${path}`).toBe(sentence);
      }
    }
  });
});
