import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const i18n = vi.hoisted(() => {
  const t = (key: string) => key;
  return { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
});
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => i18n,
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));

import api from '../../api';
import ContractSettingsDialog from './ContractSettingsDialog';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };

function renderDialog() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ContractSettingsDialog open onClose={onClose} onSaved={onSaved} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onClose, onSaved };
}

describe('ContractSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockResolvedValue({ data: { decision_window_days: 90 } });
    mocked.patch.mockImplementation(async (_url: string, body: { decision_window_days: number }) => ({ data: body }));
  });

  it('shows the stored window and saves a new one', async () => {
    const { onClose, onSaved } = renderDialog();
    const field = await screen.findByRole('textbox', { name: 'contracts.renewal.settings.windowLabel' });
    await waitFor(() => expect(field).toHaveValue('90'));
    expect(screen.getByText('contracts.renewal.settings.windowHint')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contract-settings', { decision_window_days: 60 }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses a window outside 0 to 365 days', async () => {
    renderDialog();
    const field = await screen.findByRole('textbox', { name: 'contracts.renewal.settings.windowLabel' });
    await waitFor(() => expect(field).toHaveValue('90'));
    for (const value of ['366', '-1', '1.5', 'abc']) {
      fireEvent.change(field, { target: { value } });
      expect(screen.getByRole('button', { name: 'common:buttons.save' })).toBeDisabled();
      expect(screen.getByText('contracts.renewal.settings.invalid')).toBeInTheDocument();
    }
    fireEvent.change(field, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'common:buttons.save' })).toBeEnabled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });
});
