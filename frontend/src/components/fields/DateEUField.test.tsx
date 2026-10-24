import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
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

describe('DateEUField replaces the saved date on the first keystroke', () => {
  it('selects the whole date when the field is clicked', async () => {
    const user = userEvent.setup();
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.click(input);
    expect(input.value).toBe('15/03/2022');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    await user.type(input, '21102026', { skipClick: true });
    expect(input.value).toBe('21/10/2026');
    expect(onChangeYmd).toHaveBeenLastCalledWith('2026-10-21');
  });

  it('does not select the whole date again when the focused field is clicked', async () => {
    const user = userEvent.setup();
    renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(3, 3);
    fireEvent.mouseDown(input);
    fireEvent.mouseUp(input);
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
  });

  it('selects the whole date when the field is autoFocused', async () => {
    const user = userEvent.setup();
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15', autoFocus: true });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    await user.type(input, '21102026', { skipClick: true });
    expect(input.value).toBe('21/10/2026');
    expect(onChangeYmd).toHaveBeenLastCalledWith('2026-10-21');
  });
});

describe('DateEUField keeps the rest of the date while editing the middle', () => {
  it('retypes the selected day without shifting the month and year', async () => {
    const user = userEvent.setup();
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(0, 2);
    await user.keyboard('21');
    expect(input.value).toBe('21/03/2022');
    expect(onChangeYmd).toHaveBeenLastCalledWith('2022-03-21');
  });

  it('deletes a month digit with backspace instead of padding it back', async () => {
    const user = userEvent.setup();
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(5, 5);
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('15/0/2022');
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('15//2022');
    expect(onChangeYmd).not.toHaveBeenCalled();
  });

  it('keeps an extra digit visible instead of swallowing it', () => {
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.change(input, { target: { value: '15/03/20221' } });
    expect(input.value).toBe('15/03/20221');
    expect(onChangeYmd).not.toHaveBeenCalled();
  });
});

describe('DateEUField reports an invalid date on blur', () => {
  it('keeps the typed text visible, marks the field invalid and leaves the saved date alone', () => {
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '21/10/26' } });
    expect(screen.queryByText('Invalid date')).not.toBeInTheDocument();
    expect(onChangeYmd).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Invalid date')).toBeInTheDocument();
    expect(input.value).toBe('21/10/26');
    expect(onChangeYmd).not.toHaveBeenCalled();
  });

  it('clears the error when the text becomes valid', () => {
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '21/10/26' } });
    fireEvent.blur(input);
    expect(screen.getByText('Invalid date')).toBeInTheDocument();

    fireEvent.focus(input);
    expect(screen.queryByText('Invalid date')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '21/10/2026' } });
    expect(screen.queryByText('Invalid date')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(onChangeYmd).toHaveBeenLastCalledWith('2026-10-21');
  });

  it('clears an emptied field on blur', () => {
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChangeYmd).toHaveBeenLastCalledWith('');
    expect(screen.queryByText('Invalid date')).not.toBeInTheDocument();
  });

  it('restores the saved date on Escape', () => {
    const { onChangeYmd } = renderField({ valueYmd: '2022-03-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '21/10/26' } });
    fireEvent.blur(input);
    expect(screen.getByText('Invalid date')).toBeInTheDocument();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('15/03/2022');
    expect(screen.queryByText('Invalid date')).not.toBeInTheDocument();
    expect(onChangeYmd).not.toHaveBeenCalled();
  });

  it('keeps the error and helper text given by the caller', () => {
    renderField({ valueYmd: '2022-03-15', error: true, helperText: 'The contract starts later.' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '21/10/26' } });
    fireEvent.blur(input);
    expect(screen.getByText('The contract starts later.')).toBeInTheDocument();
    expect(screen.queryByText('Invalid date')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('DateEUField typing follows the language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['en', 'dd/mm/yyyy', '15/10/2026'],
    ['fr', 'jj/mm/aaaa', '15/10/2026'],
    ['es', 'dd/mm/aaaa', '15/10/2026'],
    ['de', 'TT.MM.JJJJ', '15.10.2026'],
  ])('%s: placeholder %s, the date edits as %s and digits get the same separator', async (language, placeholder, typed) => {
    await i18n.changeLanguage(language);
    const { onChangeYmd } = renderField({ valueYmd: '2026-10-15' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.placeholder).toBe(placeholder);
    fireEvent.focus(input);
    expect(input.value).toBe(typed);
    fireEvent.change(input, { target: { value: '2010' } });
    expect(input.value).toBe(typed.slice(0, 5).replace('15', '20'));
    fireEvent.change(input, { target: { value: '20102026' } });
    expect(input.value).toBe(typed.replace('15', '20'));
    expect(onChangeYmd).toHaveBeenLastCalledWith('2026-10-20');
  });

  it.each(['en', 'fr', 'es', 'de'])('%s: accepts slashes, dots and dashes', async (language) => {
    await i18n.changeLanguage(language);
    const { onChangeYmd } = renderField({ valueYmd: '' });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    for (const [text, ymd] of [['01/02/2026', '2026-02-01'], ['03.04.2026', '2026-04-03'], ['05-06-2026', '2026-06-05']]) {
      fireEvent.change(input, { target: { value: text } });
      expect(onChangeYmd).toHaveBeenLastCalledWith(ymd);
    }
  });
});
