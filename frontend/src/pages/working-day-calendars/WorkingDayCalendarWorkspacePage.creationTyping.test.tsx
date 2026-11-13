import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import type { WorkingDayProfileDetail } from '../../services/workingDayProfiles';

const stableT = vi.hoisted(() => (key: string, opts?: Record<string, unknown>) => (
  opts ? `${key} ${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(' ')}` : key
));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: null }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../services/workingDayProfiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/workingDayProfiles')>()),
  getWorkingDayProfile: vi.fn(),
  getWorkingDayProfileYear: vi.fn(),
  listCountries: vi.fn(),
  createWorkingDayProfile: vi.fn(),
  updateWorkingDayProfile: vi.fn(),
  deleteWorkingDayProfile: vi.fn(),
}));
vi.mock('../../hooks/useWorkingDayCalendarNav', () => ({
  useWorkingDayCalendarNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));

import * as service from '../../services/workingDayProfiles';
import WorkingDayCalendarWorkspacePage from './WorkingDayCalendarWorkspacePage';

const mocked = service as unknown as {
  getWorkingDayProfile: ReturnType<typeof vi.fn>;
  listCountries: ReturnType<typeof vi.fn>;
  createWorkingDayProfile: ReturnType<typeof vi.fn>;
  updateWorkingDayProfile: ReturnType<typeof vi.fn>;
};

const Y = new Date().getFullYear();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** What the server stores for the calendar the draft created: only what was sent with it. */
const STORED: WorkingDayProfileDetail = {
  id: 'wd-new', code: 'CAL-02', name: 'Contractors', description: null, days_by_year: {}, status: 'enabled', disabled_at: null,
  country_iso: null, region_code: null, country_name: null, region_name: null, opex_count: 0, capex_count: 0,
};

/** The server's copy of the calendar: an update changes what a read returns. */
let server: WorkingDayProfileDetail;

/** Polls like waitFor, with a short failure message (a failed DOM matcher prints the whole page). */
async function until(check: () => void, ms = 1500) {
  const end = Date.now() + ms;
  for (;;) {
    try { check(); return; } catch (error) {
      if (Date.now() > end) throw error;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    }
  }
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}</div>;
}

function renderNew() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/master-data/working-day-calendars/new/overview']}>
            <Where />
            <Routes>
              <Route path="/master-data/working-day-calendars/:id/:tab" element={<WorkingDayCalendarWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const monthInput = (month: number) => screen.getByLabelText(`workingDayCalendars.days.monthField month=${MONTHS[month - 1]} year=${Y}`) as HTMLInputElement;

describe('WorkingDayCalendarWorkspacePage typing while the calendar is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.listCountries.mockResolvedValue([]);
    mocked.getWorkingDayProfile.mockImplementation(async () => server);
    mocked.updateWorkingDayProfile.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      const days = patch.days_by_year as Record<string, string[] | null> | undefined;
      const merged = { ...server.days_by_year };
      for (const [year, values] of Object.entries(days ?? {})) {
        if (values) merged[year] = values;
        else delete merged[year];
      }
      server = { ...server, ...patch, days_by_year: merged };
      return server;
    });
  });

  /** A new calendar with its code and name set and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.createWorkingDayProfile.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const code = screen.getByLabelText('workingDayCalendars.fields.code');
    fireEvent.change(code, { target: { value: 'CAL-02' } });
    fireEvent.blur(code);
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Contractors' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocked.createWorkingDayProfile).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ ...STORED, creation_token: 'tok' }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/working-day-calendars/wd-new/overview'));
      await until(() => { if (mocked.getWorkingDayProfile.mock.calls.length === 0) throw new Error('calendar not read'); });
    };
    return { finish };
  }

  const updatesWith = (field: string, value: unknown) => mocked.updateWorkingDayProfile.mock.calls
    .filter(([id, body]) => id === 'wd-new' && body?.[field] === value);

  it('saves once on the new calendar the description committed while the calendar is written', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('workingDayCalendars.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Contract staff' } });
    fireEvent.blur(description);
    await finish();

    await until(() => { if (updatesWith('description', 'Contract staff').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateWorkingDayProfile.mock.calls)}`); });
    expect(updatesWith('description', 'Contract staff')).toHaveLength(1);
    const shown = screen.getByLabelText('workingDayCalendars.fields.description') as HTMLTextAreaElement;
    await until(() => { if (shown.value !== 'Contract staff') throw new Error(`description shows "${shown.value}"`); });
  });

  it('keeps the description being typed while the calendar is written: same field, same focus, saved on the new calendar', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('workingDayCalendars.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Con' } });
    await finish();

    const shown = screen.getByLabelText('workingDayCalendars.fields.description') as HTMLTextAreaElement;
    expect(shown === description).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'Contract staff' } });
    await until(() => { if (shown.value !== 'Contract staff') throw new Error(`description shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (updatesWith('description', 'Contract staff').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateWorkingDayProfile.mock.calls)}`); });
  });

  it('saves on the new calendar the working days of a year filled while the calendar is written', async () => {
    const { finish } = await startWrite();
    for (let month = 1; month <= 12; month += 1) {
      fireEvent.change(monthInput(month), { target: { value: '20' } });
      fireEvent.blur(monthInput(month));
    }
    await finish();

    const days = Array.from({ length: 12 }, () => '20');
    await until(() => {
      const sent = mocked.updateWorkingDayProfile.mock.calls.filter(([id, body]) => id === 'wd-new' && body?.days_by_year);
      if (sent.length !== 1) throw new Error(`updates: ${JSON.stringify(mocked.updateWorkingDayProfile.mock.calls)}`);
      expect(sent[0][1]).toEqual({ days_by_year: { [String(Y)]: days } });
    });
  });
});
