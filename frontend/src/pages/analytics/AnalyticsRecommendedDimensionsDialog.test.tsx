import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const translation = vi.hoisted(() => {
  const t = (key: string, opts?: Record<string, unknown>) => (opts && 'name' in opts ? `${key}:${opts.name}` : key);
  return { t, i18n: { language: 'fr', resolvedLanguage: 'fr' } };
});
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import AnalyticsRecommendedDimensionsDialog from './AnalyticsRecommendedDimensionsDialog';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// An older tenant: its priority is there (the CAPEX one), its investment type stands for the purpose.
const STATE = [
  { code: 'cost_pool', present: false, axis_id: null, name: null, starting: true },
  { code: 'it_tower', present: false, axis_id: null, name: null, starting: true },
  { code: 'purpose', present: true, axis_id: 'ax-investment', name: 'Investment type', starting: true },
  { code: 'priority', present: true, axis_id: 'ax-priority', name: 'Priority', starting: true },
  { code: 'recurrence', present: false, axis_id: null, name: null, starting: false },
];

function renderDialog(onAdded = vi.fn(), onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AnalyticsRecommendedDimensionsDialog open onClose={onClose} onAdded={onAdded} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onAdded, onClose };
}

const box = (code: string) => screen.getByRole('checkbox', { name: `analytics.recommended.names.${code}` }) as HTMLInputElement;

describe('AnalyticsRecommendedDimensionsDialog', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ data: { items: STATE } });
  });

  it('ticks the starting dimensions the tenant lacks, greys the ones already there, leaves the pack unticked', async () => {
    renderDialog();
    await waitFor(() => expect(box('cost_pool').checked).toBe(true));
    expect(get).toHaveBeenCalledWith('/analytics-axes/recommended');
    expect(box('it_tower').checked).toBe(true);
    expect(box('purpose').checked).toBe(true);
    expect(box('purpose').disabled).toBe(true);
    expect(box('priority').checked).toBe(true);
    expect(box('priority').disabled).toBe(true);
    // Greyed with the name of the dimension that stands for it.
    expect(screen.getByText('analytics.recommended.presentAs:Investment type')).toBeInTheDocument();
    expect(screen.getByText('analytics.recommended.presentAs:Priority')).toBeInTheDocument();
    expect(box('recurrence').checked).toBe(false);
    expect(box('recurrence').disabled).toBe(false);
    // The screen language by default.
    expect(screen.getByRole('combobox').textContent).toBe('Français');
  });

  it('sends the codes ticked, in display order, and the language', async () => {
    post.mockResolvedValue({ data: { created: [{ code: 'cost_pool', axis_code: 'default', axis_id: 'a1', name: 'Nature de coût', values_created: 8 }], existing: [] } });
    const { onAdded, onClose } = renderDialog();
    await waitFor(() => expect(box('cost_pool').checked).toBe(true));
    fireEvent.click(box('it_tower'));
    fireEvent.click(box('recurrence'));
    fireEvent.click(screen.getByRole('button', { name: 'analytics.recommended.submit' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The purpose is never sent: the investment type stands for it.
    expect(post).toHaveBeenCalledWith('/analytics-axes/recommended', { codes: ['cost_pool', 'recurrence'], language: 'fr' });
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith({
      created: [{ code: 'cost_pool', axis_code: 'default', axis_id: 'a1', name: 'Nature de coût', values_created: 8 }],
      existing: [],
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it('cannot send when nothing is ticked', async () => {
    get.mockResolvedValue({ data: { items: STATE.map((item) => ({ ...item, present: item.starting })) } });
    renderDialog();
    await waitFor(() => expect(box('cost_pool').disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'analytics.recommended.submit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box('recurrence'));
    expect((screen.getByRole('button', { name: 'analytics.recommended.submit' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
