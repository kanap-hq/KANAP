import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _serialiseDate } from 'ag-grid-community';
import i18n from '../i18n';
import { createAppTheme } from '../config/ThemeContext';
import GridDateField, { GRID_POPUP_CLASS } from './GridDateField';

// The date input of the grid date filters: the app's date field in the app's language, handing
// the grid a local day that the filter model writes as an ISO date.

function renderField(date: Date | null) {
  const onDateChange = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <GridDateField {...({ date, onDateChange } as any)} />
    </ThemeProvider>,
  );
  return { onDateChange, input: screen.getByRole('textbox') as HTMLInputElement };
}

describe('GridDateField', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the date in French and takes a French day/month/year', async () => {
    await i18n.changeLanguage('fr');
    const { onDateChange, input } = renderField(new Date(2026, 9, 15));
    expect(input.value).toBe('15 oct. 2026');
    expect(input.getAttribute('type')).not.toBe('date');
    fireEvent.focus(input);
    expect(input.value).toBe('15/10/2026');
    expect(input.placeholder).toBe('jj/mm/aaaa');
    fireEvent.change(input, { target: { value: '20102026' } });
    expect(onDateChange).toHaveBeenCalledTimes(1);
    const emitted = onDateChange.mock.calls[0][0] as Date;
    expect([emitted.getFullYear(), emitted.getMonth(), emitted.getDate(), emitted.getHours()]).toEqual([2026, 9, 20, 0]);
    // What the grid's date filter writes into its model and the server receives.
    expect(_serialiseDate(emitted, false)).toBe('2026-10-20');
    expect(_serialiseDate(emitted)).toBe('2026-10-20 00:00:00');
  });

  it('hands the grid no date once the field is emptied', () => {
    const { onDateChange, input } = renderField(new Date(2026, 0, 2));
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onDateChange).toHaveBeenLastCalledWith(null);
  });

  it('opens its calendar inside the grid filter menu', () => {
    const { onDateChange } = renderField(new Date(2026, 9, 15));
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    const calendar = screen.getByRole('dialog', { name: 'Choose a date' });
    expect(calendar.closest(`.${GRID_POPUP_CLASS}`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(2026, 9, 1)) }));
    expect(_serialiseDate(onDateChange.mock.calls[0][0], false)).toBe('2026-10-01');
  });
});
