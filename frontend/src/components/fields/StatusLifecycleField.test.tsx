import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { STATUS_DISABLED, STATUS_ENABLED, StatusValue } from '../../constants/status';
import StatusLifecycleField from './StatusLifecycleField';

function renderField(props: Partial<React.ComponentProps<typeof StatusLifecycleField>> & { status: StatusValue }) {
  const onStatusChange = vi.fn();
  const onDisabledAtChange = vi.fn();
  const onDisableNow = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <StatusLifecycleField
        disabledAt={null}
        onStatusChange={onStatusChange}
        onDisabledAtChange={onDisabledAtChange}
        onDisableNow={onDisableNow}
        {...props}
      />
    </ThemeProvider>,
  );
  return { onStatusChange, onDisabledAtChange, onDisableNow };
}

describe('StatusLifecycleField', () => {
  it('shows the end of validity in the display format at rest and dd/mm/yyyy while editing', () => {
    renderField({ status: STATUS_ENABLED, disabledAt: '2027-12-31T12:00:00.000Z' });
    const input = screen.getByPlaceholderText(i18n.t('common:labels.datePlaceholder')) as HTMLInputElement;
    expect(input.value).not.toBe('31/12/2027');
    expect(input.value).toContain('2027');
    fireEvent.focus(input);
    expect(input.value).toBe('31/12/2027');
    fireEvent.blur(input);
    expect(input.value).not.toBe('31/12/2027');
  });

  it('edits with dots in German', async () => {
    try {
      await i18n.changeLanguage('de');
      renderField({ status: STATUS_ENABLED, disabledAt: '2027-12-31T12:00:00.000Z' });
      const input = screen.getByPlaceholderText('TT.MM.JJJJ') as HTMLInputElement;
      fireEvent.focus(input);
      expect(input.value).toBe('31.12.2027');
      fireEvent.change(input, { target: { value: '30112027' } });
      expect(input.value).toBe('30.11.2027');
      fireEvent.blur(input);
      fireEvent.focus(input);
      expect(input.value).toBe('30.11.2027');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('shows the on label while enabled', () => {
    renderField({ status: STATUS_ENABLED });
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
  });

  it('shows the off label while disabled, keeping the control name stable', () => {
    renderField({ status: STATUS_DISABLED, disabledAt: '2026-06-30T21:59:00.000Z' });
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked();
  });

  it('uses custom on and off labels when given', () => {
    renderField({ status: STATUS_DISABLED, statusLabel: 'On', statusOffLabel: 'Off' });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('On')).not.toBeInTheDocument();
  });

  it('clears the date and enables when switched on', () => {
    const { onStatusChange, onDisabledAtChange } = renderField({
      status: STATUS_DISABLED,
      disabledAt: '2026-06-30T21:59:00.000Z',
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onDisabledAtChange).toHaveBeenCalledWith(null);
    expect(onStatusChange).toHaveBeenCalledWith(STATUS_ENABLED);
  });

  // Switching off disables now, on the server's clock: the field hands no browser time to the
  // caller, which sends the status alone (the server sets the end of validity).
  it('asks the caller to disable now, without a browser time, when switched off', () => {
    const { onStatusChange, onDisabledAtChange, onDisableNow } = renderField({ status: STATUS_ENABLED });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onDisableNow).toHaveBeenCalledTimes(1);
    expect(onDisabledAtChange).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('asks the caller to disable now when switched off without a date field', () => {
    const { onDisabledAtChange, onDisableNow } = renderField({ status: STATUS_ENABLED, hideDisabledAt: true });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onDisableNow).toHaveBeenCalledTimes(1);
    expect(onDisabledAtChange).not.toHaveBeenCalled();
  });

  it('asks the caller to disable now when switched off with a future end of validity', () => {
    const { onDisabledAtChange, onDisableNow } = renderField({ status: STATUS_ENABLED, disabledAt: '2099-12-31T12:00:00.000Z' });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onDisableNow).toHaveBeenCalledTimes(1);
    expect(onDisabledAtChange).not.toHaveBeenCalled();
  });

  it('keeps an end of validity already passed when switched off', () => {
    const { onStatusChange, onDisabledAtChange, onDisableNow } = renderField({ status: STATUS_ENABLED, disabledAt: '2020-01-31T12:00:00.000Z' });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onDisableNow).not.toHaveBeenCalled();
    expect(onDisabledAtChange).toHaveBeenCalledWith('2020-01-31T12:00:00.000Z');
    expect(onStatusChange).toHaveBeenCalledWith(STATUS_DISABLED);
  });

  it('says until when a future end of validity keeps the record active', () => {
    renderField({ status: STATUS_ENABLED, disabledAt: '2099-12-31T12:00:00.000Z' });
    expect(screen.getByText(/^Active until .*2099/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
  });

  it('picks the end of validity in the calendar, as the local end of that day', () => {
    const { onStatusChange, onDisabledAtChange } = renderField({ status: STATUS_ENABLED });
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    // Empty field: the calendar opens on today's month; pick its 15th.
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), 15);
    const label = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(day);
    fireEvent.click(screen.getByRole('button', { name: label }));
    const iso = new Date(day.getFullYear(), day.getMonth(), 15, 23, 59, 0, 0).toISOString();
    expect(onDisabledAtChange).toHaveBeenCalledWith(iso);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a stored end of validity, time included, when its own day is typed or picked again', () => {
    const stored = '2031-10-16T14:37:12.000Z';
    const { onStatusChange, onDisabledAtChange } = renderField({ status: STATUS_ENABLED, disabledAt: stored });
    const input = screen.getByPlaceholderText(i18n.t('common:labels.datePlaceholder')) as HTMLInputElement;
    const local = new Date(stored);
    const sameDay = `${String(local.getDate()).padStart(2, '0')}/${String(local.getMonth() + 1).padStart(2, '0')}/${local.getFullYear()}`;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: sameDay } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    const label = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(local);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onDisabledAtChange).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '17/10/2031' } });
    expect(onDisabledAtChange).toHaveBeenCalledWith(new Date(2031, 9, 17, 23, 59, 0, 0).toISOString());
  });

  it('clears the end of validity from the calendar', () => {
    const { onStatusChange, onDisabledAtChange } = renderField({
      status: STATUS_DISABLED,
      disabledAt: '2026-06-30T21:59:00.000Z',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onDisabledAtChange).toHaveBeenCalledWith(null);
    expect(onStatusChange).toHaveBeenCalledWith(STATUS_ENABLED);
  });

  it('keeps the calendar shut while disabled', () => {
    renderField({ status: STATUS_ENABLED, disabled: true });
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeDisabled();
  });

  describe('end of validity defaults', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('labels the date field, its hint and the calendar button when no props are given', () => {
      renderField({ status: STATUS_ENABLED });
      expect(screen.getByText('End of validity')).toBeInTheDocument();
      expect(screen.getByText('Leave blank to keep active indefinitely.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open calendar' })).toBeInTheDocument();
      expect(screen.queryByText('Disabled At')).not.toBeInTheDocument();
    });

    it('keeps the label and hint given by the caller', () => {
      renderField({ status: STATUS_ENABLED, disabledAtLabel: 'Retired on', disabledAtHelperText: 'Custom hint' });
      expect(screen.getByText('Retired on')).toBeInTheDocument();
      expect(screen.getByText('Custom hint')).toBeInTheDocument();
      expect(screen.queryByText('End of validity')).not.toBeInTheDocument();
    });

    it('translates the defaults in French', async () => {
      await i18n.changeLanguage('fr');
      renderField({ status: STATUS_ENABLED });
      expect(screen.getByText('Fin de validité')).toBeInTheDocument();
      expect(screen.getByText('Laisser vide pour rester actif indéfiniment.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ouvrir le calendrier' })).toBeInTheDocument();
    });
  });
});
