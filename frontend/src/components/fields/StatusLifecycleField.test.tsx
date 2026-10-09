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
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <StatusLifecycleField
        disabledAt={null}
        onStatusChange={onStatusChange}
        onDisabledAtChange={onDisabledAtChange}
        {...props}
      />
    </ThemeProvider>,
  );
  return { onStatusChange, onDisabledAtChange };
}

describe('StatusLifecycleField', () => {
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

  it('stamps a date and disables when switched off without a date field', () => {
    const { onStatusChange, onDisabledAtChange } = renderField({ status: STATUS_ENABLED, hideDisabledAt: true });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onDisabledAtChange).toHaveBeenCalledWith(expect.any(String));
    expect(onStatusChange).toHaveBeenCalledWith(STATUS_DISABLED);
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
