import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const calendarsState = vi.hoisted(() => ({ ready: true, profiles: [] as unknown[], isError: false }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const levels = vi.hoisted(() => ({ value: 'admin' as 'reader' | 'member' | 'admin' | null, resources: [] as string[] }));
const api = vi.hoisted(() => ({
  suggestions: [] as unknown[],
  get: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
  post: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    // Keys with their options, so a test can read what the sentence would say.
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(' ')}` : key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => {
      levels.resources.push(resource);
      const rank: Record<string, number> = { reader: 1, member: 3, manager: 3, admin: 4 };
      return levels.value != null && rank[levels.value] >= rank[level];
    },
  }),
}));
vi.mock('../api', () => {
  api.get = vi.fn(async (url: string) => ({ data: { items: url.endsWith('/suggestions') ? api.suggestions : [] } }));
  api.post = vi.fn(async (_url: string, body: Record<string, unknown>) => ({ data: { id: `new-${body.code}`, ...body } }));
  return { default: api };
});
vi.mock('../hooks/useWorkingDayProfiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useWorkingDayProfiles')>();
  return {
    ...actual,
    useWorkingDayProfiles: () =>
      actual.buildWorkingDayProfiles(calendarsState.profiles as any, calendarsState.ready, calendarsState.isError),
  };
});
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return <div data-testid="grid" />;
  },
}));

import WorkingDayCalendarsPage from './WorkingDayCalendarsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/master-data/working-day-calendars']}>
          <WorkingDayCalendarsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

type Column = {
  field?: string;
  colId?: string;
  valueFormatter?: (p: { value: unknown; data?: unknown }) => string;
  valueGetter?: (p: { data?: unknown }) => string;
  sortable?: boolean;
  filter?: unknown;
};

const FRANCE = { country_iso: 'FR', country_name: 'France', companies: ['Head office', 'Plant'] };
const NETHERLANDS = { country_iso: 'NL', country_name: 'Netherlands', companies: ['Sales office'] };
const ITALY = { country_iso: 'IT', country_name: 'Italy', companies: ['Branch'] };

describe('WorkingDayCalendarsPage', () => {
  beforeEach(() => {
    calendarsState.ready = true;
    calendarsState.profiles = [];
    calendarsState.isError = false;
    levels.value = 'admin';
    levels.resources = [];
    grid.props = null;
    api.suggestions = [];
    api.get.mockClear();
    api.post.mockClear();
  });

  it('shows the one-line explainer when the tenant has no calendar', () => {
    renderPage();
    expect(screen.getByTestId('working-day-calendars-empty')).toHaveTextContent('workingDayCalendars.emptyExplainer');
  });

  it('hides the explainer once a calendar exists, while loading, and after a failed load', () => {
    calendarsState.profiles = [{ id: 'p1', code: 'CAL', name: 'Staff', status: 'enabled', disabled_at: null, days_by_year: {} }];
    const first = renderPage();
    expect(screen.queryByTestId('working-day-calendars-empty')).toBeNull();
    first.unmount();
    calendarsState.profiles = [];
    calendarsState.ready = false;
    const second = renderPage();
    expect(screen.queryByTestId('working-day-calendars-empty')).toBeNull();
    second.unmount();
    calendarsState.ready = true;
    calendarsState.isError = true;
    renderPage();
    expect(screen.queryByTestId('working-day-calendars-empty')).toBeNull();
  });

  it('lists code, name, country, years, status and last update, the years joined', () => {
    renderPage();
    expect(grid.props?.endpoint).toBe('/working-day-profiles');
    expect(grid.props?.defaultSort).toEqual({ field: 'name', direction: 'ASC' });
    // Country names come back in the UI language.
    expect(grid.props?.extraParams).toEqual({ lang: 'en' });
    const columns = grid.props?.columns as Column[];
    expect(columns.map((c) => c.field ?? c.colId)).toEqual(['code', 'name', 'country', 'years', 'status', 'updated_at']);
    const years = columns.find((c) => c.field === 'years');
    expect(years?.valueFormatter?.({ value: ['2026', '2027'] })).toBe('2026, 2027');
    expect(years?.valueFormatter?.({ value: [] })).toBe('');
    expect(years?.sortable).toBe(false);
    expect((columns.find((c) => c.field === 'status') as { defaultHidden?: boolean })?.defaultHidden).toBe(true);
  });

  it('shows the country of a standard calendar, region in parentheses, and nothing on a custom one', () => {
    renderPage();
    const country = (grid.props?.columns as Column[]).find((c) => c.colId === 'country');
    const moselle = { country_iso: 'FR', region_code: '57', country_name: 'France', region_name: 'Moselle' };
    expect(country?.valueGetter?.({ data: moselle })).toBe('France (Moselle)');
    expect(country?.valueGetter?.({ data: { ...moselle, region_code: null, region_name: null } })).toBe('France');
    expect(country?.valueGetter?.({ data: { country_iso: null, region_code: null, country_name: null, region_name: null } })).toBe('');
  });

  it('sorts and filters the country column on the server, as the text it shows', () => {
    renderPage();
    const country = (grid.props?.columns as Column[]).find((c) => c.colId === 'country');
    // `country` is the server's field for "France (Moselle)"; the grid sends the column id.
    expect(country?.field).toBeUndefined();
    expect(country?.sortable).not.toBe(false);
    expect(country?.filter).toBe('agTextColumnFilter');
  });

  it('says "All years" for a standard calendar, with its edited years, and the stored years for a custom one', () => {
    renderPage();
    const years = (grid.props?.columns as Column[]).find((c) => c.field === 'years');
    const standard = { country_iso: 'FR' };
    expect(years?.valueFormatter?.({ value: [], data: standard })).toBe('workingDayCalendars.yearsAll');
    expect(years?.valueFormatter?.({ value: ['2026'], data: standard })).toBe('workingDayCalendars.yearsAllEdited years=2026');
    expect(years?.valueFormatter?.({ value: ['2026', '2027'], data: { country_iso: null } })).toBe('2026, 2027');
  });

  it('offers the standard calendars of the companies\' countries, and creates them in one click', async () => {
    api.suggestions = [FRANCE, NETHERLANDS, ITALY];
    renderPage();
    const strip = await screen.findByTestId('working-day-calendars-suggestions');
    expect(api.get).toHaveBeenCalledWith('/working-day-profiles/suggestions', { params: { lang: 'en' } });
    expect(strip).toHaveTextContent('workingDayCalendars.suggestions.line count=3 countries=France, Netherlands, and Italy');
    // The strip replaces the empty-state line.
    expect(screen.queryByTestId('working-day-calendars-empty')).toBeNull();
    api.suggestions = [];
    fireEvent.click(screen.getByRole('button', { name: 'workingDayCalendars.suggestions.create count=3' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(api.post.mock.calls.map((call) => call[1])).toEqual([
      { code: 'FR', name: 'France', country_iso: 'FR' },
      { code: 'NL', name: 'Netherlands', country_iso: 'NL' },
      { code: 'IT', name: 'Italy', country_iso: 'IT' },
    ]);
    // The list and the suggestions are read again: nothing left to suggest.
    await waitFor(() => expect(screen.queryByTestId('working-day-calendars-suggestions')).toBeNull());
  });

  it('keeps creating the other calendars when one is refused, and says why', async () => {
    api.suggestions = [FRANCE, NETHERLANDS];
    api.post.mockImplementationOnce(async () => {
      throw { response: { status: 400, data: { message: 'A calendar with code FR already exists.' } } };
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'workingDayCalendars.suggestions.create count=2' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('A calendar with code FR already exists.');
  });

  it('shows no suggestion to readers', () => {
    api.suggestions = [FRANCE];
    levels.value = 'reader';
    renderPage();
    expect(api.get).not.toHaveBeenCalledWith('/working-day-profiles/suggestions', expect.anything());
    expect(screen.queryByTestId('working-day-calendars-suggestions')).toBeNull();
  });

  it('offers New to members and the CSV and delete actions to admins only', () => {
    levels.value = 'member';
    const { unmount } = renderPage();
    expect(screen.getByRole('button', { name: 'shared.labels.new' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shared.labels.importCsv' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'shared.labels.exportCsv' })).toBeNull();
    expect(grid.props?.enableRowSelection).toBe(false);
    unmount();
    levels.value = 'admin';
    renderPage();
    expect(screen.getByRole('button', { name: 'shared.labels.importCsv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shared.labels.exportCsv' })).toBeInTheDocument();
    expect(grid.props?.enableRowSelection).toBe(true);
  });

  it('gives readers the list without actions, and refuses users without access', () => {
    levels.value = 'reader';
    const { unmount } = renderPage();
    expect(screen.getByTestId('grid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shared.labels.new' })).toBeNull();
    expect(levels.resources.every((resource) => resource === 'working_day_profiles')).toBe(true);
    unmount();
    levels.value = null;
    renderPage();
    expect(screen.queryByTestId('grid')).toBeNull();
  });
});
