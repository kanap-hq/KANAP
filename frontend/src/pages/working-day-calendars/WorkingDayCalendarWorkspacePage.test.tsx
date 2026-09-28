import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import type { WorkingDayProfileDetail } from '../../services/workingDayProfiles';

const navigateMock = vi.hoisted(() => vi.fn());
const levels = vi.hoisted(() => ({ value: 'admin' as 'reader' | 'member' | 'admin' }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(' ')}` : key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, member: 3, admin: 4 };
      return rank[levels.value] >= rank[level];
    },
    profile: { id: 'user-1' },
  }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
vi.mock('../../services/workingDayProfiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/workingDayProfiles')>()),
  getWorkingDayProfile: vi.fn(),
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
  createWorkingDayProfile: ReturnType<typeof vi.fn>;
  updateWorkingDayProfile: ReturnType<typeof vi.fn>;
  deleteWorkingDayProfile: ReturnType<typeof vi.fn>;
};

// The editor opens on the current year.
const Y = new Date().getFullYear();
const DAYS = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CALENDAR: WorkingDayProfileDetail = {
  id: 'wd-1',
  code: 'CAL-01',
  name: 'Head office staff',
  description: null,
  days_by_year: { [String(Y)]: DAYS },
  status: 'enabled',
  disabled_at: null,
  opex_count: 3,
  capex_count: 1,
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/master-data/working-day-calendars/:id/:tab" element={<WorkingDayCalendarWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function monthInput(month: number, year: number): HTMLInputElement {
  return screen.getByLabelText(`workingDayCalendars.days.monthField month=${MONTHS[month - 1]} year=${year}`) as HTMLInputElement;
}

describe('WorkingDayCalendarWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    levels.value = 'admin';
    mocked.getWorkingDayProfile.mockResolvedValue(CALENDAR);
    mocked.updateWorkingDayProfile.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      const days = patch.days_by_year as Record<string, string[] | null> | undefined;
      const merged = { ...CALENDAR.days_by_year };
      for (const [year, values] of Object.entries(days ?? {})) {
        if (values) merged[year] = values;
        else delete merged[year];
      }
      return { ...CALENDAR, ...patch, days_by_year: merged };
    });
  });

  it('creates with an explicit button and opens the new calendar', async () => {
    mocked.createWorkingDayProfile.mockResolvedValue({ ...CALENDAR, id: 'wd-new' });
    renderAt('/master-data/working-day-calendars/new/overview?sort=name%3AASC');
    // No Properties drawer on the create page.
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.change(screen.getByLabelText('workingDayCalendars.fields.code'), { target: { value: ' CAL-02 ' } });
    fireEvent.change(screen.getByLabelText('workingDayCalendars.fields.name'), { target: { value: 'Contractors' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createWorkingDayProfile).toHaveBeenCalledWith({ code: 'CAL-02', name: 'Contractors', description: null }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/working-day-calendars/wd-new/overview?sort=name%3AASC'));
  });

  it('asks for the code and the name before creating', async () => {
    renderAt('/master-data/working-day-calendars/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('workingDayCalendars.messages.codeRequired')).toBeInTheDocument();
    expect(screen.getByText('workingDayCalendars.messages.nameRequired')).toBeInTheDocument();
    expect(mocked.createWorkingDayProfile).not.toHaveBeenCalled();
  });

  it('saves the code on blur, with no save button', async () => {
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    const code = await screen.findByLabelText('workingDayCalendars.fields.code');
    expect(screen.getByRole('complementary')).toContainElement(code);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    fireEvent.change(code, { target: { value: 'CAL-10' } });
    expect(mocked.updateWorkingDayProfile).not.toHaveBeenCalled();
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-1', { code: 'CAL-10' }));
  });

  it('saves a changed month as that year only', async () => {
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    await screen.findByLabelText('workingDayCalendars.fields.code');
    expect(screen.getByTestId('working-days-total')).toHaveTextContent(`total=218 year=${Y}`);
    const march = monthInput(3, Y);
    fireEvent.change(march, { target: { value: '21' } });
    fireEvent.blur(march);
    const expected = [...DAYS];
    expected[2] = '21';
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-1', { days_by_year: { [String(Y)]: expected } }));
    await waitFor(() => expect(screen.getByTestId('working-days-total')).toHaveTextContent(`total=219 year=${Y}`));
  });

  it('writes a new year once its twelve months are filled, or copied from the year before', async () => {
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    await screen.findByLabelText('workingDayCalendars.fields.code');
    fireEvent.click(screen.getByRole('tab', { name: String(Y + 1) }));
    const january = monthInput(1, Y + 1);
    fireEvent.change(january, { target: { value: '20' } });
    fireEvent.blur(january);
    expect(mocked.updateWorkingDayProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId('working-days-status')).toHaveTextContent(`workingDayCalendars.days.fillToSave year=${Y + 1}`);
    fireEvent.change(january, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: `workingDayCalendars.days.copyFrom year=${Y}` }));
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-1', { days_by_year: { [String(Y + 1)]: DAYS } }));
  });

  it('shows a refused year under the months', async () => {
    mocked.updateWorkingDayProfile.mockRejectedValueOnce({
      response: { data: { message: `March ${Y} has 31 days: enter 31 or less.`, field: 'days_by_year' } },
    });
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    await screen.findByLabelText('workingDayCalendars.fields.code');
    const march = monthInput(3, Y);
    fireEvent.change(march, { target: { value: '21' } });
    fireEvent.blur(march);
    expect(await screen.findByTestId('working-days-status')).toHaveTextContent(`March ${Y} has 31 days: enter 31 or less.`);
  });

  it('disables Delete with the reason when lines use the calendar', async () => {
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    expect(await screen.findByTestId('working-day-calendar-usage')).toHaveTextContent('workingDayCalendars.deleteBlocked');
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeDisabled();
  });

  it('deletes a free calendar and goes back to the list', async () => {
    mocked.getWorkingDayProfile.mockResolvedValue({ ...CALENDAR, opex_count: 0, capex_count: 0 });
    mocked.deleteWorkingDayProfile.mockResolvedValue(undefined);
    renderAt('/master-data/working-day-calendars/wd-1/overview?sort=name%3AASC');
    await screen.findByLabelText('workingDayCalendars.fields.code');
    expect(screen.queryByTestId('working-day-calendar-usage')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.deleteWorkingDayProfile).toHaveBeenCalledWith('wd-1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/working-day-calendars?sort=name%3AASC'));
  });

  it('shows the usage line without Delete to members, and keeps readers read only', async () => {
    levels.value = 'member';
    const first = renderAt('/master-data/working-day-calendars/wd-1/overview');
    expect(await screen.findByTestId('working-day-calendar-usage')).toHaveTextContent('workingDayCalendars.usage.both');
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    first.unmount();
    levels.value = 'reader';
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    expect(await screen.findByLabelText('workingDayCalendars.fields.code')).toBeDisabled();
    expect(monthInput(1, Y)).toBeDisabled();
  });
});
