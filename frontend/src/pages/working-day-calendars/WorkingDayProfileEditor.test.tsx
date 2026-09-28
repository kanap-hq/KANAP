import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import type { CalendarDays } from '../../services/workingDayProfiles';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    // Keys with their options, so a test can read what the sentence would say.
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(' ')}` : key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

import WorkingDayProfileEditor from './WorkingDayProfileEditor';

// The anonymised reference calendar: 218 days in 2026.
const DAYS_2026 = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const onSaveYear = vi.fn(async () => true);

function renderEditor(daysByYear: CalendarDays, year = 2026, disabled = false) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <WorkingDayProfileEditor daysByYear={daysByYear} disabled={disabled} onSaveYear={onSaveYear} initialYear={year} />
    </ThemeProvider>,
  );
}

function monthInput(month: number, year: number): HTMLInputElement {
  return screen.getByLabelText(`workingDayCalendars.days.monthField month=${MONTHS[month - 1]} year=${year}`) as HTMLInputElement;
}

function type(month: number, year: number, value: string) {
  const input = monthInput(month, year);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('WorkingDayProfileEditor', () => {
  beforeEach(() => {
    onSaveYear.mockClear();
  });

  it('shows the twelve months of the year and its total', () => {
    renderEditor({ '2026': DAYS_2026 });
    expect(monthInput(2, 2026)).toHaveValue('18');
    expect(monthInput(10, 2026)).toHaveValue('19');
    expect(screen.getByTestId('working-days-total')).toHaveTextContent('workingDayCalendars.days.total count=218 total=218 year=2026');
  });

  it('adds fractional days exactly', () => {
    renderEditor({ '2027': Array.from({ length: 12 }, () => '19.083333') }, 2027);
    expect(screen.getByTestId('working-days-total')).toHaveTextContent('count=229 total=229 year=2027');
  });

  it('saves a stored year when a month changes, and not when nothing changed', async () => {
    renderEditor({ '2026': DAYS_2026 });
    fireEvent.blur(monthInput(3, 2026));
    expect(onSaveYear).not.toHaveBeenCalled();
    type(3, 2026, '19.50');
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledTimes(1));
    const expected = [...DAYS_2026];
    expected[2] = '19.5';
    expect(onSaveYear).toHaveBeenCalledWith(2026, expected);
  });

  it('takes fractional days typed one character at a time', async () => {
    renderEditor({ '2026': DAYS_2026 });
    const january = monthInput(1, 2026);
    fireEvent.change(january, { target: { value: '' } });
    for (const ch of '19.083333') fireEvent.change(january, { target: { value: january.value + ch } });
    expect(january).toHaveValue('19.083333');
    fireEvent.blur(january);
    expect(screen.queryByRole('alert')).toBeNull();
    const expected = [...DAYS_2026];
    expected[0] = '19.083333';
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledWith(2026, expected));
  });

  it('keeps a month typed while the previous write was running', async () => {
    const view = renderEditor({ '2026': DAYS_2026 });
    type(3, 2026, '21');
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledTimes(1));
    fireEvent.change(monthInput(4, 2026), { target: { value: '1' } });
    const saved = [...DAYS_2026];
    saved[2] = '21';
    view.rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <WorkingDayProfileEditor daysByYear={{ '2026': saved }} disabled={false} onSaveYear={onSaveYear} initialYear={2026} />
      </ThemeProvider>,
    );
    expect(monthInput(3, 2026)).toHaveValue('21');
    expect(monthInput(4, 2026)).toHaveValue('1');
  });

  it('saves a new year only once its twelve months are filled', async () => {
    renderEditor({ '2026': DAYS_2026 }, 2027);
    for (let month = 1; month <= 11; month += 1) type(month, 2027, '20');
    expect(onSaveYear).not.toHaveBeenCalled();
    expect(screen.getByTestId('working-days-status')).toHaveTextContent('workingDayCalendars.days.fillToSave year=2027');
    type(12, 2027, '21');
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledTimes(1));
    expect(onSaveYear).toHaveBeenCalledWith(2027, [...Array.from({ length: 11 }, () => '20'), '21']);
  });

  it('refuses more days than the month has, naming the month', () => {
    renderEditor({}, 2028);
    for (let month = 1; month <= 12; month += 1) type(month, 2028, '20');
    onSaveYear.mockClear();
    type(2, 2028, '30');
    expect(onSaveYear).not.toHaveBeenCalled();
    expect(screen.getByTestId('working-days-status')).toHaveTextContent('workingDayCalendars.days.tooMany month=February year=2028 max=29');
    type(2, 2028, '29');
    expect(onSaveYear).toHaveBeenCalledTimes(1);
  });

  it('asks for the twelve months when a stored month is cleared, without saving', () => {
    renderEditor({ '2026': DAYS_2026 });
    type(5, 2026, '');
    expect(onSaveYear).not.toHaveBeenCalled();
    expect(screen.getByTestId('working-days-status')).toHaveTextContent('workingDayCalendars.days.incomplete year=2026');
  });

  it('copies the previous year into an empty year and saves it', async () => {
    renderEditor({ '2026': DAYS_2026 }, 2027);
    fireEvent.click(screen.getByRole('button', { name: 'workingDayCalendars.days.copyFrom year=2026' }));
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledWith(2027, DAYS_2026));
  });

  it('offers the copy only for an empty year that follows a stored one', () => {
    const first = renderEditor({ '2026': DAYS_2026 }, 2026);
    expect(screen.queryByRole('button', { name: /copyFrom/ })).toBeNull();
    first.unmount();
    renderEditor({ '2026': DAYS_2026 }, 2028);
    expect(screen.queryByRole('button', { name: /copyFrom/ })).toBeNull();
  });

  it('moves between years with the year tabs', () => {
    renderEditor({ '2026': DAYS_2026 }, 2026);
    fireEvent.click(screen.getByRole('tab', { name: '2027' }));
    expect(monthInput(1, 2027)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'workingDayCalendars.days.copyFrom year=2026' })).toBeInTheDocument();
  });

  it('removes a stored year at once when no line uses the calendar', async () => {
    renderEditor({ '2026': DAYS_2026 });
    fireEvent.click(screen.getByRole('button', { name: 'workingDayCalendars.days.removeYear year=2026' }));
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledWith(2026, null));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before removing a year of a calendar that lines use', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <WorkingDayProfileEditor
          daysByYear={{ '2026': DAYS_2026 }}
          disabled={false}
          onSaveYear={onSaveYear}
          initialYear={2026}
          usage="Used by 3 OPEX lines and 1 CAPEX line."
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'workingDayCalendars.days.removeYear year=2026' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('workingDayCalendars.days.removeDialog.title year=2026');
    expect(dialog).toHaveTextContent('workingDayCalendars.days.removeDialog.body usage=Used by 3 OPEX lines and 1 CAPEX line. year=2026');
    expect(onSaveYear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'workingDayCalendars.days.removeDialog.confirm' }));
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledWith(2026, null));
  });

  it('is read only without edit rights', () => {
    renderEditor({ '2026': DAYS_2026 }, 2027, true);
    expect(monthInput(1, 2027)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /copyFrom|removeYear/ })).toBeNull();
  });

  it('shows a refusal from the server under the months', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <WorkingDayProfileEditor
          daysByYear={{ '2026': DAYS_2026 }}
          disabled={false}
          error="March 2026 has 31 days: enter 31 or less."
          onSaveYear={onSaveYear}
          initialYear={2026}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('March 2026 has 31 days: enter 31 or less.');
  });
});

describe('WorkingDayProfileEditor on a standard calendar', () => {
  // France 2026: Monday to Friday minus the public holidays that fall on a weekday, 252 days.
  const FRANCE_2026 = ['21', '20', '22', '21', '17', '22', '22', '21', '22', '22', '20', '22'];
  const HOLIDAYS_2026 = [
    { date: '2026-01-01', name: "New Year's Day", weekend: false },
    { date: '2026-04-06', name: 'Easter Monday', weekend: false },
    { date: '2026-08-15', name: 'Assumption', weekend: true },
    { date: '2026-11-01', name: "All Saints' Day", weekend: true },
  ];
  const onYearChange = vi.fn();

  function yearInfo(year: number, standardDays: string[] = FRANCE_2026, holidays = HOLIDAYS_2026) {
    return { year, source: 'standard' as const, days: standardDays, standard_days: standardDays, holidays };
  }

  function renderStandard(
    daysByYear: CalendarDays,
    info: ReturnType<typeof yearInfo> | null = yearInfo(2026),
    options: { year?: number; disabled?: boolean; failed?: boolean } = {},
  ) {
    const element = (next: CalendarDays, nextInfo: ReturnType<typeof yearInfo> | null) => (
      <ThemeProvider theme={createAppTheme('light')}>
        <WorkingDayProfileEditor
          daysByYear={next}
          disabled={options.disabled ?? false}
          onSaveYear={onSaveYear}
          initialYear={options.year ?? 2026}
          standard={{ source: 'France', year: nextInfo, failed: options.failed }}
          onYearChange={onYearChange}
        />
      </ThemeProvider>
    );
    const view = render(element(daysByYear, info));
    return { ...view, update: (next: CalendarDays, nextInfo = info) => view.rerender(element(next, nextInfo)) };
  }

  beforeEach(() => {
    onSaveYear.mockClear();
    onYearChange.mockClear();
  });

  it('shows the standard values of a year the calendar does not hold, and nothing more than the total', () => {
    renderStandard({});
    expect(monthInput(1, 2026)).toHaveValue('21');
    expect(monthInput(5, 2026)).toHaveValue('17');
    expect(screen.getByTestId('working-days-total')).toHaveTextContent('workingDayCalendars.days.total count=252 total=252 year=2026');
    expect(screen.queryByTestId('working-days-standard')).toBeNull();
    expect(screen.queryByRole('button', { name: 'workingDayCalendars.days.resetToStandard' })).toBeNull();
    expect(screen.getByText('workingDayCalendars.days.standardHint source=France')).toBeInTheDocument();
  });

  it('never offers the copy from the year before nor the removal of a year', () => {
    renderStandard({ '2025': DAYS_2026, '2026': DAYS_2026 });
    expect(screen.queryByRole('button', { name: /copyFrom|removeYear/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '2027' }));
    expect(screen.queryByRole('button', { name: /copyFrom|removeYear/ })).toBeNull();
  });

  it('saves nothing while the standard values are kept, and the twelve values once a month changes', async () => {
    renderStandard({});
    fireEvent.blur(monthInput(3, 2026));
    expect(onSaveYear).not.toHaveBeenCalled();
    type(3, 2026, '20');
    const expected = [...FRANCE_2026];
    expected[2] = '20';
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledWith(2026, expected));
    expect(onSaveYear).toHaveBeenCalledTimes(1);
  });

  it('shows an edited year with its standard total and a reset link that removes the edit', async () => {
    renderStandard({ '2026': DAYS_2026 });
    expect(monthInput(1, 2026)).toHaveValue('18');
    expect(screen.getByTestId('working-days-total')).toHaveTextContent('count=218 total=218 year=2026');
    expect(screen.getByTestId('working-days-standard')).toHaveTextContent('workingDayCalendars.days.standardTotal count=252 total=252');
    fireEvent.click(screen.getByRole('button', { name: 'workingDayCalendars.days.resetToStandard' }));
    // No dialog: the standard values are one click away again.
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onSaveYear).toHaveBeenCalledWith(2026, null));
  });

  it('shows the standard values again once the edit is removed', () => {
    const view = renderStandard({ '2026': DAYS_2026 });
    view.update({});
    expect(monthInput(1, 2026)).toHaveValue('21');
    expect(screen.getByTestId('working-days-total')).toHaveTextContent('count=252 total=252 year=2026');
    expect(screen.queryByTestId('working-days-standard')).toBeNull();
  });

  it('lists the public holidays of the year, those on a weekend marked', () => {
    renderStandard({});
    expect(screen.getByTestId('working-days-holidays')).toHaveTextContent(
      "workingDayCalendars.days.holidays list=1 Jan New Year's Day, 6 Apr Easter Monday, 15 Aug Assumption workingDayCalendars.days.weekend, 1 Nov All Saints' Day workingDayCalendars.days.weekend",
    );
  });

  it('names a holiday of several days once, with its first and last day', () => {
    renderStandard({}, yearInfo(2026, FRANCE_2026, [
      { date: '2026-05-16', name: 'Kurbanski bajram', weekend: true },
      { date: '2026-05-17', name: 'Kurbanski bajram', weekend: true },
      { date: '2026-05-18', name: 'Kurbanski bajram', weekend: false },
      { date: '2026-05-19', name: 'Kurbanski bajram', weekend: false },
    ]));
    expect(screen.getByTestId('working-days-holidays')).toHaveTextContent(
      'workingDayCalendars.days.holidays list=workingDayCalendars.days.holidayRange from=16 to=19 May Kurbanski bajram',
    );
  });

  it('says so when a year has no public holiday', () => {
    renderStandard({}, yearInfo(2026, FRANCE_2026, []));
    expect(screen.getByTestId('working-days-holidays')).toHaveTextContent('workingDayCalendars.days.noHolidays year=2026');
  });

  it('waits for the year: blank and locked fields, no holidays line, until its values arrive', () => {
    const view = renderStandard({}, null);
    expect(monthInput(1, 2026)).toHaveValue('');
    expect(monthInput(1, 2026)).toBeDisabled();
    expect(screen.queryByTestId('working-days-holidays')).toBeNull();
    // Another year's values are not this year's.
    view.update({}, yearInfo(2025));
    expect(monthInput(1, 2026)).toBeDisabled();
    view.update({}, yearInfo(2026));
    expect(monthInput(1, 2026)).not.toBeDisabled();
    expect(monthInput(1, 2026)).toHaveValue('21');
  });

  it('says when the standard values could not be loaded', () => {
    renderStandard({}, null, { failed: true });
    expect(screen.getByRole('alert')).toHaveTextContent('workingDayCalendars.days.standardFailed year=2026');
  });

  it('offers five years around the current one and moves one year at a time, telling the caller', () => {
    renderStandard({}, yearInfo(2026), { year: 2026 });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['2024', '2025', '2026', '2027', '2028']);
    expect(onYearChange).toHaveBeenLastCalledWith(2026);
    fireEvent.click(screen.getByRole('button', { name: 'yearTabs.previous' }));
    expect(onYearChange).toHaveBeenLastCalledWith(2025);
    fireEvent.click(screen.getByRole('button', { name: 'yearTabs.previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'yearTabs.previous' }));
    expect(onYearChange).toHaveBeenLastCalledWith(2023);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['2021', '2022', '2023', '2024', '2025']);
  });

  it('stops at 2000 and 2100', () => {
    const first = renderStandard({}, yearInfo(2100), { year: 2100 });
    expect(screen.getByRole('button', { name: 'yearTabs.next' })).toBeDisabled();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['2096', '2097', '2098', '2099', '2100']);
    first.unmount();
    renderStandard({}, yearInfo(2000), { year: 2000 });
    expect(screen.getByRole('button', { name: 'yearTabs.previous' })).toBeDisabled();
  });

  it('is read only without edit rights: no reset link', () => {
    renderStandard({ '2026': DAYS_2026 }, yearInfo(2026), { disabled: true });
    expect(monthInput(1, 2026)).toBeDisabled();
    expect(screen.getByTestId('working-days-standard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'workingDayCalendars.days.resetToStandard' })).toBeNull();
  });
});
