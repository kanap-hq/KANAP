import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const calendarsState = vi.hoisted(() => ({ ready: true, profiles: [] as unknown[], isError: false }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const levels = vi.hoisted(() => ({ value: 'admin' as 'reader' | 'member' | 'admin' | null, resources: [] as string[] }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
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
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
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

type Column = { field: string; valueFormatter?: (p: { value: unknown }) => string; sortable?: boolean };

describe('WorkingDayCalendarsPage', () => {
  beforeEach(() => {
    calendarsState.ready = true;
    calendarsState.profiles = [];
    calendarsState.isError = false;
    levels.value = 'admin';
    levels.resources = [];
    grid.props = null;
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

  it('lists code, name, years, status and last update, the years joined', () => {
    renderPage();
    expect(grid.props?.endpoint).toBe('/working-day-profiles');
    expect(grid.props?.defaultSort).toEqual({ field: 'name', direction: 'ASC' });
    const columns = grid.props?.columns as Column[];
    expect(columns.map((c) => c.field)).toEqual(['code', 'name', 'years', 'status', 'updated_at']);
    const years = columns.find((c) => c.field === 'years');
    expect(years?.valueFormatter?.({ value: ['2026', '2027'] })).toBe('2026, 2027');
    expect(years?.valueFormatter?.({ value: [] })).toBe('');
    expect(years?.sortable).toBe(false);
    expect((columns.find((c) => c.field === 'status') as { defaultHidden?: boolean })?.defaultHidden).toBe(true);
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
