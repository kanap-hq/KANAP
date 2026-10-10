import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// One `t` for every render: a new one each time would rerun the effects that depend on it.
const translation = vi.hoisted(() => {
  const t = (key: string, opts?: Record<string, unknown>) => (opts && 'name' in opts ? `${key}:${opts.name}` : key);
  return { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
});
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import AnalyticsValueOrderDialog from './AnalyticsValueOrderDialog';
import type { AnalyticsValue } from '../../services/analytics';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function value(id: string, name: string, sortOrder: number, patch: Partial<AnalyticsValue> = {}): AnalyticsValue {
  return { id, axis_id: 'ax-prio', name, description: null, applies_to: null, sort_order: sortOrder, status: 'enabled', disabled_at: null, ...patch };
}

// The stored order: Mandatory, High, Medium (disabled), Low (CAPEX only).
const VALUES = [
  value('v-mand', 'Mandatory', 1),
  value('v-high', 'High', 2),
  value('v-med', 'Medium', 3, { status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' }),
  value('v-low', 'Low', 4, { applies_to: 'capex' }),
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Picks the row up with Space, presses `arrow` once, drops it with Space (the keyboard sensor listens on the document). */
async function keyboardMove(row: HTMLElement, arrow: 'ArrowUp' | 'ArrowDown') {
  row.focus();
  await act(async () => { fireEvent.keyDown(row, { key: ' ', code: 'Space' }); await tick(); });
  await act(async () => { fireEvent.keyDown(document, { key: arrow, code: arrow }); await tick(); });
  await act(async () => { fireEvent.keyDown(document, { key: ' ', code: 'Space' }); await tick(); });
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-value-id]'));
const rowTexts = () => rows().map((row) => row.textContent);

function renderDialog(props: Partial<React.ComponentProps<typeof AnalyticsValueOrderDialog>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AnalyticsValueOrderDialog open axisId="ax-prio" axisLabel="Priority" onClose={onClose} onSaved={onSaved} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onClose, onSaved, invalidate };
}

describe('AnalyticsValueOrderDialog', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ data: { items: VALUES, total: VALUES.length } });
    post.mockImplementation(async (_url: string, body: { value_ids: string[] }) => ({
      data: body.value_ids.map((id, i) => ({ ...VALUES.find((v) => v.id === id)!, sort_order: i + 1 })),
    }));
    // jsdom lays nothing out: each row stands 36px under the previous one, so the keyboard
    // sensor finds the row below.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = rows().indexOf(this);
      const top = index < 0 ? 0 : index * 36;
      const height = index < 0 ? 0 : 36;
      return { x: 0, y: top, top, left: 0, width: 400, height, right: 400, bottom: top + height, toJSON: () => ({}) } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every value of the dimension in its order, with their marks', async () => {
    renderDialog();
    expect(screen.getByText('analytics.reorder.title:Priority')).toBeInTheDocument();
    expect(screen.getByText('analytics.reorder.hint')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(get).toHaveBeenCalledWith('/analytics-categories', expect.objectContaining({
      params: expect.objectContaining({ axis_id: 'ax-prio', includeDisabled: '1', sort: 'sort_order:ASC', limit: 1000 }),
    }));
    expect(rowTexts()).toEqual([
      '1Mandatory',
      '2High',
      '3Mediumanalytics.disabledMark',
      '4Lowmaster-data:shared.lineTypeUsage.capex',
    ]);
  });

  it('moves a value with the keyboard, then saves the whole order and refreshes the value lists', async () => {
    const { onClose, onSaved, invalidate } = renderDialog();
    await waitFor(() => expect(rows()).toHaveLength(4));

    // Medium goes up one place: picked up with Space, moved with the arrow, dropped with Space.
    await keyboardMove(rows()[2], 'ArrowUp');
    // The positions follow the new order.
    expect(rowTexts()).toEqual([
      '1Mandatory',
      '2Mediumanalytics.disabledMark',
      '3High',
      '4Lowmaster-data:shared.lineTypeUsage.capex',
    ]);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' })); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/analytics-categories/reorder', { axis_id: 'ax-prio', value_ids: ['v-mand', 'v-med', 'v-high', 'v-low'] });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(expect.arrayContaining([
      JSON.stringify(['analytics-categories']),
      JSON.stringify(['analytics-ids']),
      JSON.stringify(['lookup', '/analytics-categories/lookup']),
      JSON.stringify(['grid-filter-values']),
    ]));
  });

  it('posts nothing on Cancel', async () => {
    const { onClose, onSaved } = renderDialog();
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows a refusal in the dialog and stays open', async () => {
    post.mockRejectedValue(Object.assign(new Error('Request failed'), {
      response: { status: 400, data: { message: 'A value of another dimension cannot be ordered here.' } },
    }));
    const { onClose, onSaved } = renderDialog();
    await waitFor(() => expect(rows()).toHaveLength(4));
    await keyboardMove(rows()[1], 'ArrowUp');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' })); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole('alert')).getByText('A value of another dimension cannot be ordered here.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
