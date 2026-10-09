import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import DateEUField from './DateEUField';

const fullDate = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function renderField(props: Partial<React.ComponentProps<typeof DateEUField>> = {}) {
  const onChangeYmd = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <DateEUField label="Go-live" valueYmd="2026-10-14" onChangeYmd={onChangeYmd} {...props} />
    </ThemeProvider>,
  );
  return { onChangeYmd };
}

describe('DateEUField calendar', () => {
  it('opens the in-page calendar on the value and emits the picked day', () => {
    const { onChangeYmd } = renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    expect(screen.getByRole('dialog', { name: 'Choose a date' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: fullDate.format(new Date(2026, 9, 20)) }));
    expect(onChangeYmd).toHaveBeenCalledWith('2026-10-20');
  });

  it('opens from the keyboard with Alt+Down in the input', () => {
    renderField();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('dialog', { name: 'Choose a date' })).toBeInTheDocument();
  });

  it('gives the focus back to the calendar button on Escape', async () => {
    renderField();
    const button = screen.getByRole('button', { name: 'Open calendar' });
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(button);
  });

  it('clears an optional field', () => {
    const { onChangeYmd } = renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChangeYmd).toHaveBeenCalledWith('');
  });

  it('keeps Clear off a required field', () => {
    renderField({ required: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('does not open while disabled', () => {
    renderField({ disabled: true });
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown', altKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
