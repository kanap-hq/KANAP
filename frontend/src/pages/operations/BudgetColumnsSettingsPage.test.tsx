import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// Texts come from the real strings so the messages can be read; a test can switch to French.
const lang = vi.hoisted(() => ({ current: 'en' }));
vi.mock('react-i18next', async () => {
  const i18next = (await import('i18next')).default;
  const enOps = (await import('../../locales/en/ops.json')).default;
  const enCommon = (await import('../../locales/en/common.json')).default;
  const frOps = (await import('../../locales/fr/ops.json')).default;
  const frCommon = (await import('../../locales/fr/common.json')).default;
  const real = i18next.createInstance();
  await real.init({
    lng: 'en',
    resources: { en: { ops: enOps, common: enCommon }, fr: { ops: frOps, common: frCommon } },
    ns: ['ops', 'common'], defaultNS: 'ops',
    interpolation: { escapeValue: false },
  });
  const fixed: Record<string, ReturnType<typeof real.getFixedT>> = { en: real.getFixedT('en'), fr: real.getFixedT('fr') };
  const translations = Object.fromEntries(['en', 'fr'].map((lng) => [lng, {
    t: (key: string, options?: unknown) => fixed[lng](key, options as Record<string, unknown>),
    i18n: { language: lng, resolvedLanguage: lng },
  }]));
  return { useTranslation: () => translations[lang.current] };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => resource === 'budget_ops' && level === 'admin' && auth.admin }),
}));
vi.mock('../../components/PageHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));

import api from '../../api';
import BudgetColumnsSettingsPage from './BudgetColumnsSettingsPage';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };
let stored: BudgetColumnsSettings = DEFAULT_BUDGET_COLUMNS;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <BudgetColumnsSettingsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const row = (position: number) => within(screen.getByTestId(`budget-column-row-${position}`));
const save = () => screen.getByRole('button', { name: 'Save' });

/** Waits until the stored setting is on screen (the Name fields are editable). */
async function waitForSetting() {
  await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/budget-columns'));
  await waitFor(() => expect(row(1).getByRole('textbox')).not.toHaveAttribute('readonly'));
}

describe('BudgetColumnsSettingsPage', () => {
  beforeEach(() => {
    lang.current = 'en';
    auth.admin = true;
    stored = DEFAULT_BUDGET_COLUMNS;
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: stored };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it('lists the five columns in the fixed order, with the standard names and the file names', async () => {
    renderPage();
    await waitForSetting();

    const placeholders = [1, 2, 3, 4, 5].map((p) => row(p).getByRole('textbox').getAttribute('placeholder'));
    expect(placeholders).toEqual(['Budget', 'Revision', 'Forecast', 'Actuals', 'Expected landing']);
    expect(row(1).getByText('In files: planned')).toBeInTheDocument();
    expect(row(5).getByText('In files: expected_landing')).toBeInTheDocument();
    // Forecast is hidden by default; every column follows the spread and the lines; Budget is the default.
    expect(row(3).getByRole('checkbox', { name: 'Show Forecast' })).not.toBeChecked();
    expect(row(4).getByRole('checkbox', { name: 'Actuals follows the spread and the lines' })).toBeChecked();
    expect(row(1).getByRole('radio')).toBeChecked();
    expect(save()).toBeDisabled();
  });

  it('explains Default and Follows in info tooltips on their headers, not in lines under the table', async () => {
    renderPage();
    await waitForSetting();

    const defaultHelp = "The default column is preselected in reports and sorts the lists and the dashboard. Freezing it fixes the year's exchange rates.";
    const followsHelp = 'The column takes what is applied to all columns on the budget tab: the distribution and period of a spread, and the quantity and price lines. A column that does not follow keeps its own.';
    expect(screen.queryByText(defaultHelp)).not.toBeInTheDocument();
    expect(screen.queryByText(followsHelp)).not.toBeInTheDocument();

    const defaultInfo = screen.getByRole('img', { name: defaultHelp });
    expect(screen.getByRole('img', { name: followsHelp })).toBeInTheDocument();
    expect(defaultInfo.closest('th')).toHaveTextContent('Default');

    fireEvent.mouseOver(defaultInfo);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(defaultHelp);
  });

  it('saves only what changed', async () => {
    mocked.patch.mockImplementation(async (_url: string, body: unknown) => ({ data: { ...stored, ...(body as object) } }));
    renderPage();
    await waitForSetting();

    fireEvent.change(row(3).getByRole('textbox'), { target: { value: '  A2  ' } });
    fireEvent.click(row(3).getByRole('checkbox', { name: 'Show A2' }));
    fireEvent.click(row(5).getByRole('checkbox', { name: 'Expected landing follows the spread and the lines' }));
    fireEvent.click(row(3).getByRole('radio'));
    fireEvent.click(save());

    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch).toHaveBeenCalledWith('/budget-columns', {
      labels: { forecast: 'A2' },
      enabled: { forecast: true },
      group_spread: { expected_landing: false },
      default_column: 'forecast',
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('says readably that at least one column must stay shown', async () => {
    renderPage();
    await waitForSetting();

    for (const p of [1, 2, 4, 5]) fireEvent.click(row(p).getAllByRole('checkbox')[0]);
    expect(screen.getByRole('alert')).toHaveTextContent('At least one column must stay shown.');
    expect(save()).toBeDisabled();
  });

  it('says readably that the default column must be shown', async () => {
    renderPage();
    await waitForSetting();

    fireEvent.click(row(1).getByRole('checkbox', { name: 'Show Budget' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The default column must be shown: choose another default column first.');
    expect(save()).toBeDisabled();

    // Moving the default first makes the change valid, in one save.
    fireEvent.click(row(2).getByRole('radio'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it('refuses two columns with the same name, whatever the case, and a name over 40 characters', async () => {
    renderPage();
    await waitForSetting();

    fireEvent.change(row(2).getByRole('textbox'), { target: { value: 'budget' } });
    expect(row(2).getByText('Two columns cannot both be named "budget".')).toBeInTheDocument();
    expect(save()).toBeDisabled();

    fireEvent.change(row(2).getByRole('textbox'), { target: { value: 'x'.repeat(41) } });
    expect(row(2).getByText('A column name can have at most 40 characters.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('applies the server rules: English standard names, composed accents, characters not code units, invisible characters', async () => {
    lang.current = 'fr';
    renderPage();
    await waitForSetting();

    // Column 3 shows "Prévision" in French, but the server also checks its English name.
    fireEvent.change(row(1).getByRole('textbox'), { target: { value: 'Forecast' } });
    expect(row(1).getByText('Deux colonnes ne peuvent pas porter le même nom « Forecast ».')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    // "Réel" typed with a combining accent is the same name as "Réel".
    fireEvent.change(row(1).getByRole('textbox'), { target: { value: 'Réel' } });
    fireEvent.change(row(2).getByRole('textbox'), { target: { value: 'Re\u0301el' } });
    expect(row(2).getByText(/Deux colonnes ne peuvent pas porter le même nom/)).toBeInTheDocument();

    // 40 emoji are 40 characters (80 code units): accepted; 41 are refused.
    fireEvent.change(row(2).getByRole('textbox'), { target: { value: '\u{1F600}'.repeat(40) } });
    expect(row(2).queryByText(/40 caractères/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
    fireEvent.change(row(2).getByRole('textbox'), { target: { value: '\u{1F600}'.repeat(41) } });
    expect(row(2).getByText('Un nom de colonne compte au plus 40 caractères.')).toBeInTheDocument();

    // A zero width space would make a second "Budget" look different.
    fireEvent.change(row(2).getByRole('textbox'), { target: { value: 'Budget\u200B' } });
    expect(row(2).getByText('Un nom de colonne ne peut pas contenir de caractères de contrôle ou invisibles.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });

  it('Reset brings back the saved setting', async () => {
    stored = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } };
    renderPage();
    await waitForSetting();

    fireEvent.change(row(1).getByRole('textbox'), { target: { value: 'Other' } });
    fireEvent.click(row(2).getByRole('radio'));
    expect(save()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(row(1).getByRole('textbox')).toHaveValue('A0');
    expect(row(1).getByRole('radio')).toBeChecked();
    expect(save()).toBeDisabled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('groups the default radios so the arrow keys move between them', async () => {
    renderPage();
    await waitForSetting();
    const names = new Set([1, 2, 3, 4, 5].map((p) => row(p).getByRole('radio').getAttribute('name')));
    expect(names.size).toBe(1);
    expect([...names][0]).toBeTruthy();
  });

  it('says the setting could not be loaded and offers nothing to change', async () => {
    mocked.get.mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText('The column settings could not be loaded.', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByTestId('budget-column-row-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('shows the server message when a save is refused', async () => {
    mocked.patch.mockRejectedValue(Object.assign(new Error('Bad Request'), {
      response: { status: 400, data: { message: 'Two columns cannot both be named "Réel".' } },
    }));
    renderPage();
    await waitForSetting();

    fireEvent.change(row(4).getByRole('textbox'), { target: { value: 'Réel' } });
    fireEvent.click(save());
    expect(await screen.findByText('Two columns cannot both be named "Réel".')).toBeInTheDocument();
  });

  it('is read-only without budget administration', async () => {
    auth.admin = false;
    stored = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } };
    renderPage();
    await waitFor(() => expect(row(1).getByRole('textbox')).toHaveValue('A0'));

    expect(screen.getByText('Only budget administrators can change this page.')).toBeInTheDocument();
    expect(row(1).getByRole('textbox')).toHaveAttribute('readonly');
    for (const p of [1, 2, 3, 4, 5]) {
      for (const control of row(p).getAllByRole('checkbox')) expect(control).toBeDisabled();
      expect(row(p).getByRole('radio')).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
