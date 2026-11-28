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
    i18n: {
      language: lng,
      resolvedLanguage: lng,
      hasResourceBundle: real.hasResourceBundle.bind(real),
      exists: real.exists.bind(real),
      getFixedT: real.getFixedT.bind(real),
    },
  }]));
  return { useTranslation: () => translations[lang.current] };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
// The English texts are already in the test instance: nothing to download.
vi.mock('../../i18n', () => ({ loadNamespace: vi.fn(async () => undefined) }));
const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => resource === 'budget_ops' && level === 'admin' && auth.admin }),
}));

import api from '../../api';
import { KanapDialogProvider } from '../../components/design';
import BudgetColumnsSettingsPage from './BudgetColumnsSettingsPage';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };
let stored: BudgetColumnsSettings = DEFAULT_BUDGET_COLUMNS;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <BudgetColumnsSettingsPage />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const row = (position: number) => within(screen.getByTestId(`budget-column-row-${position}`));
/** The body of each PATCH sent, in order. */
const sent = () => mocked.patch.mock.calls.map((call) => call[1]);
const echo = async (_url: string, body: any) => {
  const next = {
    labels: { ...stored.labels, ...(body.labels ?? {}) },
    enabled: { ...stored.enabled, ...(body.enabled ?? {}) },
    group_spread: { ...stored.group_spread, ...(body.group_spread ?? {}) },
    default_column: body.default_column ?? stored.default_column,
  };
  stored = next;
  return { data: next };
};

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
    mocked.patch.mockImplementation(echo);
  });

  it('lists the five columns in the fixed order, with the standard names and the file names, and no Save or Reset', async () => {
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
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  it('explains Default and Follows in info tooltips on their headers, not in lines under the table', async () => {
    renderPage();
    await waitForSetting();

    const defaultHelp = "The default column is preselected in reports and sorts the lists and the dashboard. Freezing it fixes the year's exchange rates.";
    const followsHelp = 'Ticked by default in "Use for other columns too" on the Budget tab.';
    expect(screen.queryByText(defaultHelp)).not.toBeInTheDocument();
    expect(screen.queryByText(followsHelp)).not.toBeInTheDocument();

    const defaultInfo = screen.getByRole('img', { name: defaultHelp });
    expect(screen.getByRole('img', { name: followsHelp })).toBeInTheDocument();
    expect(defaultInfo.closest('th')).toHaveTextContent('Default');

    fireEvent.mouseOver(defaultInfo);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(defaultHelp);
  });

  it('saves each change on its own, one request per change, and says it is saved', async () => {
    renderPage();
    await waitForSetting();

    fireEvent.click(row(3).getByRole('checkbox', { name: 'Show Forecast' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(row(5).getByRole('checkbox', { name: 'Expected landing follows the spread and the lines' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    fireEvent.click(row(3).getByRole('radio'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(3));
    expect(sent()).toEqual([
      { enabled: { forecast: true } },
      { group_spread: { expected_landing: false } },
      { default_column: 'forecast' },
    ]);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(row(3).getByRole('radio')).toBeChecked();
  });

  it('saves a name when the field is left, trimmed, once', async () => {
    renderPage();
    await waitForSetting();

    const field = row(3).getByRole('textbox');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '  A' } });
    fireEvent.change(field, { target: { value: '  A2  ' } });
    fireEvent.blur(field);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual([{ labels: { forecast: 'A2' } }]);
    await waitFor(() => expect(row(3).getByRole('checkbox', { name: 'Show A2' })).toBeInTheDocument());
  });

  it('saves a name 700 ms after the last key while the field keeps the focus', async () => {
    renderPage();
    await waitForSetting();

    const field = row(2).getByRole('textbox');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'A1' } });
    expect(mocked.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(sent()).toEqual([{ labels: { committed: 'A1' } }]);
    expect(field).toHaveValue('A1');
  });

  it('refuses to hide the last shown column, under its switch, and sends nothing', async () => {
    stored = { ...DEFAULT_BUDGET_COLUMNS, enabled: { planned: true, committed: false, forecast: false, actual: false, expected_landing: false } };
    renderPage();
    await waitForSetting();

    fireEvent.click(row(1).getByRole('checkbox', { name: 'Show Budget' }));
    expect(row(1).getByRole('alert')).toHaveTextContent('At least one column must stay shown.');
    expect(row(1).getByRole('checkbox', { name: 'Show Budget' })).not.toBeChecked();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('refuses to hide the default column until another default is chosen: the two changes are saved one after the other', async () => {
    renderPage();
    await waitForSetting();

    fireEvent.click(row(1).getByRole('checkbox', { name: 'Show Budget' }));
    expect(row(1).getByRole('alert')).toHaveTextContent('The default column must be shown: choose another default column first.');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocked.patch).not.toHaveBeenCalled();

    // Choosing another default drops the refused change: Budget is shown again, as stored.
    fireEvent.click(row(2).getByRole('radio'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(row(1).getByRole('checkbox', { name: 'Show Budget' })).toBeChecked();

    fireEvent.click(row(1).getByRole('checkbox', { name: 'Show Budget' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([{ default_column: 'committed' }, { enabled: { planned: false } }]);
  });

  it('refuses two columns with the same name, whatever the case, and a name over 40 characters, and sends neither', async () => {
    renderPage();
    await waitForSetting();

    const field = row(2).getByRole('textbox');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'budget' } });
    expect(row(2).getByText('Two columns cannot both be named "budget".')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'x'.repeat(41) } });
    expect(row(2).getByText('A column name can have at most 40 characters.')).toBeInTheDocument();
    fireEvent.blur(field);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(mocked.patch).not.toHaveBeenCalled();
    // The refused name stays in the field, with its reason.
    expect(field).toHaveValue('x'.repeat(41));
  });

  it('puts the error on the name typed even when the clashing name is stored on a later column', async () => {
    stored = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, expected_landing: 'A1' } };
    renderPage();
    await waitForSetting();

    const field = row(1).getByRole('textbox');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'a1' } });
    expect(row(1).getByText('Two columns cannot both be named "A1".')).toBeInTheDocument();
    fireEvent.blur(field);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('applies the server rules: English standard names, composed accents, characters not code units, invisible characters', async () => {
    lang.current = 'fr';
    renderPage();
    await waitForSetting();

    // Column 3 shows "Prévision" in French, but the server also checks its English name.
    const first = row(1).getByRole('textbox');
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: 'Forecast' } });
    expect(row(1).getByText('Deux colonnes ne peuvent pas porter le même nom « Forecast ».')).toBeInTheDocument();

    // "Réel" typed with a combining accent is the same name as the stored "Réel".
    fireEvent.change(first, { target: { value: 'Réel' } });
    fireEvent.blur(first);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(row(1).getByRole('textbox')).toHaveValue('Réel'));
    const second = row(2).getByRole('textbox');
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: 'Réel' } });
    expect(row(2).getByText(/Deux colonnes ne peuvent pas porter le même nom/)).toBeInTheDocument();

    // 40 emoji are 40 characters (80 code units): accepted; 41 are refused.
    fireEvent.change(second, { target: { value: '\u{1F600}'.repeat(41) } });
    expect(row(2).getByText('Un nom de colonne compte au plus 40 caractères.')).toBeInTheDocument();
    // A zero width space would make a second "Budget" look different.
    fireEvent.change(second, { target: { value: 'Budget​' } });
    expect(row(2).getByText('Un nom de colonne ne peut pas contenir de caractères de contrôle ou invisibles.')).toBeInTheDocument();
    fireEvent.change(second, { target: { value: '\u{1F600}'.repeat(40) } });
    expect(row(2).queryByText(/40 caractères/)).not.toBeInTheDocument();
    fireEvent.blur(second);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual([{ labels: { planned: 'Réel' } }, { labels: { committed: '\u{1F600}'.repeat(40) } }]);
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
  });

  it('shows the server message when a save is refused, and the stored choice again', async () => {
    mocked.patch.mockRejectedValue(Object.assign(new Error('Bad Request'), {
      response: { status: 400, data: { message: 'Two columns cannot both be named "Réel".' } },
    }));
    renderPage();
    await waitForSetting();

    fireEvent.click(row(2).getByRole('radio'));
    expect(await screen.findByText('Two columns cannot both be named "Réel".')).toBeInTheDocument();
    expect(row(1).getByRole('radio')).toBeChecked();
  });

  it('shows a budget administration reader the same fields, read-only, without the administrator notice', async () => {
    auth.admin = false;
    stored = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } };
    renderPage();
    await waitFor(() => expect(row(1).getByRole('textbox')).toHaveValue('A0'));

    expect(screen.queryByText('You need budget administrator rights to use this page.')).not.toBeInTheDocument();
    expect(row(1).getByRole('textbox')).toHaveAttribute('readonly');
    for (const p of [1, 2, 3, 4, 5]) {
      for (const control of row(p).getAllByRole('checkbox')) expect(control).toBeDisabled();
      expect(row(p).getByRole('radio')).toBeDisabled();
    }
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
