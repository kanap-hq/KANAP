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
