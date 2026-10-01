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
  getWorkingDayProfileYear: ReturnType<typeof vi.fn>;
  listCountries: ReturnType<typeof vi.fn>;
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
  country_iso: null,
  region_code: null,
  country_name: null,
  region_name: null,
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

// A standard calendar's values for any year: 21 days every month, New Year's Day on a weekday.
const STANDARD = Array.from({ length: 12 }, () => '21');
const MOSELLE: WorkingDayProfileDetail = {
  ...CALENDAR,
  id: 'wd-57',
  code: 'FR-57',
  name: 'France (Moselle)',
  days_by_year: {},
  country_iso: 'FR',
  region_code: '57',
  country_name: 'France',
  region_name: 'Moselle',
  opex_count: 0,
  capex_count: 0,
};

const COUNTRIES = [
  { code: 'FR', name: 'France', regions: [{ code: '57', name: 'Moselle' }, { code: '67', name: 'Bas-Rhin' }] },
  { code: 'NL', name: 'Netherlands', regions: [] },
];

describe('WorkingDayCalendarWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    levels.value = 'admin';
    mocked.getWorkingDayProfile.mockResolvedValue(CALENDAR);
    mocked.listCountries.mockResolvedValue(COUNTRIES);
    mocked.getWorkingDayProfileYear.mockImplementation(async (_id: string, year: number) => ({
      year,
      source: 'standard',
      days: STANDARD,
      standard_days: STANDARD,
      holidays: [{ date: `${year}-01-01`, name: "New Year's Day", weekend: false }],
    }));
    mocked.updateWorkingDayProfile.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      const loaded = (await mocked.getWorkingDayProfile.mock.results[0]?.value) as WorkingDayProfileDetail ?? CALENDAR;
      const days = patch.days_by_year as Record<string, string[] | null> | undefined;
      const merged = { ...loaded.days_by_year };
      for (const [year, values] of Object.entries(days ?? {})) {
        if (values) merged[year] = values;
        else delete merged[year];
      }
      return { ...loaded, ...patch, days_by_year: merged };
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

  it('reads the calendar with its names in the UI language, and no year route for a custom calendar', async () => {
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    await screen.findByLabelText('workingDayCalendars.fields.code');
    expect(mocked.getWorkingDayProfile).toHaveBeenCalledWith('wd-1', 'en');
    expect(mocked.getWorkingDayProfileYear).not.toHaveBeenCalled();
    expect(screen.queryByTestId('working-day-calendar-source')).toBeNull();
    expect(screen.queryByTestId('working-days-holidays')).toBeNull();
  });

  it('prefills code and name from a country and its region, and creates a standard calendar', async () => {
    mocked.createWorkingDayProfile.mockResolvedValue({ ...MOSELLE, id: 'wd-new' });
    renderAt('/master-data/working-day-calendars/new/overview');
    const country = screen.getByRole('combobox', { name: 'workingDayCalendars.fields.country' });
    await waitFor(() => expect(mocked.listCountries).toHaveBeenCalledWith('en'));
    fireEvent.change(country, { target: { value: 'fra' } });
    fireEvent.click(await screen.findByRole('option', { name: 'France' }));
    expect(screen.getByLabelText('workingDayCalendars.fields.code')).toHaveValue('FR');
    expect(screen.getByLabelText('workingDayCalendars.fields.name')).toHaveValue('France');
    expect(screen.getByTestId('working-day-calendar-create-hint')).toHaveTextContent('workingDayCalendars.createHintStandard source=France');

    const region = screen.getByRole('combobox', { name: 'workingDayCalendars.fields.region' });
    expect(region).toHaveTextContent('workingDayCalendars.wholeCountry');
    fireEvent.mouseDown(region);
    fireEvent.click(await screen.findByRole('option', { name: 'Moselle' }));
    expect(screen.getByLabelText('workingDayCalendars.fields.code')).toHaveValue('FR-57');
    expect(screen.getByLabelText('workingDayCalendars.fields.name')).toHaveValue('France (Moselle)');

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createWorkingDayProfile).toHaveBeenCalledWith({
      code: 'FR-57',
      name: 'France (Moselle)',
      description: null,
      country_iso: 'FR',
      region_code: '57',
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/working-day-calendars/wd-new/overview'));
  });

  it('keeps a code or name typed by the user when the country changes, and offers no region when there is none', async () => {
    renderAt('/master-data/working-day-calendars/new/overview');
    const country = screen.getByRole('combobox', { name: 'workingDayCalendars.fields.country' });
    await waitFor(() => expect(mocked.listCountries).toHaveBeenCalled());
    fireEvent.change(country, { target: { value: 'Fr' } });
    fireEvent.click(await screen.findByRole('option', { name: 'France' }));
    fireEvent.change(screen.getByLabelText('workingDayCalendars.fields.name'), { target: { value: 'Paris staff' } });
    fireEvent.change(country, { target: { value: 'NL' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Netherlands' }));
    expect(screen.getByLabelText('workingDayCalendars.fields.code')).toHaveValue('NL');
    expect(screen.getByLabelText('workingDayCalendars.fields.name')).toHaveValue('Paris staff');
    expect(screen.queryByRole('combobox', { name: 'workingDayCalendars.fields.region' })).toBeNull();
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
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-1', { code: 'CAL-10' }, 'en'));
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
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-1', { days_by_year: { [String(Y)]: expected } }, 'en'));
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
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-1', { days_by_year: { [String(Y + 1)]: DAYS } }, 'en'));
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

  it('shows a standard calendar from its country: standard values, public holidays and the source', async () => {
    mocked.getWorkingDayProfile.mockResolvedValue(MOSELLE);
    renderAt('/master-data/working-day-calendars/wd-57/overview');
    expect(await screen.findByTestId('working-day-calendar-source')).toHaveTextContent('France (Moselle)');
    await waitFor(() => expect(mocked.getWorkingDayProfileYear).toHaveBeenCalledWith('wd-57', Y, 'en'));
    await waitFor(() => expect(monthInput(1, Y)).toHaveValue('21'));
    expect(screen.getByTestId('working-days-total')).toHaveTextContent(`total=252 year=${Y}`);
    expect(screen.getByTestId('working-days-holidays')).toHaveTextContent("1 Jan New Year's Day");
    expect(screen.queryByRole('button', { name: /copyFrom|removeYear|resetToStandard/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: String(Y + 1) }));
    await waitFor(() => expect(mocked.getWorkingDayProfileYear).toHaveBeenCalledWith('wd-57', Y + 1, 'en'));
    await waitFor(() => expect(monthInput(1, Y + 1)).toHaveValue('21'));
  });

  it('stores the twelve values of a standard year once a month changes, then resets it to the standard values', async () => {
    mocked.getWorkingDayProfile.mockResolvedValue(MOSELLE);
    renderAt('/master-data/working-day-calendars/wd-57/overview');
    await waitFor(() => expect(monthInput(3, Y)).toHaveValue('21'));
    const march = monthInput(3, Y);
    fireEvent.change(march, { target: { value: '19' } });
    fireEvent.blur(march);
    const expected = [...STANDARD];
    expected[2] = '19';
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-57', { days_by_year: { [String(Y)]: expected } }, 'en'));
    expect(await screen.findByTestId('working-days-standard')).toHaveTextContent('workingDayCalendars.days.standardTotal count=252 total=252');
    fireEvent.click(screen.getByRole('button', { name: 'workingDayCalendars.days.resetToStandard' }));
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenLastCalledWith('wd-57', { days_by_year: { [String(Y)]: null } }, 'en'));
    await waitFor(() => expect(screen.queryByTestId('working-days-standard')).toBeNull());
    expect(monthInput(3, Y)).toHaveValue('21');
  });

  it('loads the year again after a days write, not after another field, so the budget tab sees the new days', async () => {
    mocked.getWorkingDayProfile.mockResolvedValue(MOSELLE);
    renderAt('/master-data/working-day-calendars/wd-57/overview');
    await waitFor(() => expect(monthInput(3, Y)).toHaveValue('21'));
    const yearLoads = () => mocked.getWorkingDayProfileYear.mock.calls.filter(([id, year]) => id === 'wd-57' && year === Y).length;
    expect(yearLoads()).toBe(1);

    const code = screen.getByLabelText('workingDayCalendars.fields.code');
    fireEvent.change(code, { target: { value: 'FR-57B' } });
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(yearLoads()).toBe(1);

    const march = monthInput(3, Y);
    fireEvent.change(march, { target: { value: '19' } });
    fireEvent.blur(march);
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(yearLoads()).toBe(2));
    expect(monthInput(3, Y)).toHaveValue('19');
  });

  it('keeps what the user types while an earlier save of the same field lands', async () => {
    let finishCode: (value: WorkingDayProfileDetail) => void = () => undefined;
    let finishDescription: (value: WorkingDayProfileDetail) => void = () => undefined;
    mocked.updateWorkingDayProfile.mockImplementationOnce(() => new Promise((resolve) => { finishCode = resolve; }));
    renderAt('/master-data/working-day-calendars/wd-1/overview');
    const code = await screen.findByLabelText('workingDayCalendars.fields.code');
    fireEvent.focus(code);
    fireEvent.change(code, { target: { value: 'CAL-0' } });
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenCalledWith('wd-1', { code: 'CAL-0' }, 'en'));
    fireEvent.focus(code);
    fireEvent.change(code, { target: { value: 'CAL-02' } });
    finishCode({ ...CALENDAR, code: 'CAL-0' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(code).toHaveValue('CAL-02');
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenLastCalledWith('wd-1', { code: 'CAL-02' }, 'en'));

    mocked.updateWorkingDayProfile.mockImplementationOnce(() => new Promise((resolve) => { finishDescription = resolve; }));
    const description = screen.getByLabelText('workingDayCalendars.fields.description');
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: 'Office' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenLastCalledWith('wd-1', { description: 'Office' }, 'en'));
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: 'Office staff' } });
    finishDescription({ ...CALENDAR, code: 'CAL-02', description: 'Office' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(description).toHaveValue('Office staff');
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateWorkingDayProfile).toHaveBeenLastCalledWith('wd-1', { description: 'Office staff' }, 'en'));
  });
});
