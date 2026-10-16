import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import IncidentDateTimeField from './IncidentDateTimeField';

// Incident timestamps: the app's date field and a 24-hour time, in the app's language, in place of
// the browser's date-time input. The field hands back an ISO instant.

const iso = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m - 1, d, h, mi).toISOString();

function renderField(value: string | null) {
  const onChange = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <IncidentDateTimeField value={value} onChange={onChange} />
    </ThemeProvider>,
  );
  const [date, time] = screen.getAllByRole('textbox') as HTMLInputElement[];
  return { onChange, date, time };
}

describe('IncidentDateTimeField', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the date in French and the time on 24 hours, with no browser date input', async () => {
    await i18n.changeLanguage('fr');
    const { date, time } = renderField(iso(2026, 10, 15, 14, 5));
    expect(document.querySelector('input[type="datetime-local"], input[type="date"]')).toBeNull();
    expect(date.value).toBe('15 oct. 2026');
    expect(time.value).toBe('14:05');
    expect(time).toHaveAccessibleName('Heure');
    fireEvent.focus(date);
    expect(date.value).toBe('15/10/2026');
  });

  it('keeps the time when the date changes, and saves a typed time on blur', () => {
    const { onChange, date, time } = renderField(iso(2026, 10, 15, 14, 5));
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: '16102026' } });
    expect(onChange).toHaveBeenLastCalledWith(iso(2026, 10, 16, 14, 5));
    onChange.mockClear();
    fireEvent.change(time, { target: { value: '9:30' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(time);
    expect(onChange).toHaveBeenLastCalledWith(iso(2026, 10, 16, 9, 30));
    expect(time.value).toBe('09:30');
  });

  it('starts a new timestamp at midnight, and reverts a time it cannot read', () => {
    const { onChange, date, time } = renderField(null);
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: '01022026' } });
    expect(onChange).toHaveBeenLastCalledWith(iso(2026, 2, 1, 0, 0));
    expect(time.value).toBe('00:00');
    onChange.mockClear();
    fireEvent.change(time, { target: { value: '25:00' } });
    fireEvent.blur(time);
    expect(onChange).not.toHaveBeenCalled();
    expect(time.value).toBe('00:00');
  });

  it('selects the time on click, so a typed time replaces the prefilled 00:00', async () => {
    const user = userEvent.setup();
    const { onChange, date, time } = renderField(null);
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: '01022026' } });
    expect(time.value).toBe('00:00');
    onChange.mockClear();
    await user.click(time);
    await user.keyboard('14:30');
    expect(time.value).toBe('14:30');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(iso(2026, 2, 1, 14, 30));
  });

  it('selects the time when reached with the keyboard too', async () => {
    const user = userEvent.setup();
    const { time } = renderField(iso(2026, 10, 15, 14, 5));
    time.focus();
    await user.keyboard('9');
    expect(time.value).toBe('9');
  });

  it('clears with the date', () => {
    const { onChange, date } = renderField(iso(2026, 10, 15, 14, 5));
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: '' } });
    fireEvent.blur(date);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
