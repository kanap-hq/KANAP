import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// One `t` for every render: a new one each time would rerun the effects that depend on it.
const translation = vi.hoisted(() => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    if (key === 'master-data:analytics.analyticsCategoryFallback') return 'Analytics dimension';
    return opts && 'name' in opts ? `${key}:${opts.name}` : key;
  };
  return { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
});
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import AnalyticsDimensionOrderDialog from './AnalyticsDimensionOrderDialog';
import type { AnalyticsAxis } from '../../services/analytics';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function axis(id: string, name: string | null, sortOrder: number, patch: Partial<AnalyticsAxis> = {}): AnalyticsAxis {
  return {
    id, code: id, name, description: null, sort_order: sortOrder, is_default: false, applies_to: null,
    required: false, status: 'enabled', disabled_at: null, ...patch,
  };
}

// The stored order: the default (unnamed), Nature, Internal order (disabled), Investment (CAPEX only).
// The response order is shuffled: the dialog shows the dimensions in their order.
const AXES = [
  axis('ax-invest', 'Investment', 3, { applies_to: 'capex' }),
  axis('ax-default', null, 0, { is_default: true }),
  axis('ax-order', 'Internal order', 2, { status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' }),
  axis('ax-nature', 'Nature', 1),
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Picks the row up with Space, presses `arrow` once, drops it with Space (the keyboard sensor listens on the document). */
async function keyboardMove(row: HTMLElement, arrow: 'ArrowUp' | 'ArrowDown') {
  row.focus();
  await act(async () => { fireEvent.keyDown(row, { key: ' ', code: 'Space' }); await tick(); });
  await act(async () => { fireEvent.keyDown(document, { key: arrow, code: arrow }); await tick(); });
  await act(async () => { fireEvent.keyDown(document, { key: ' ', code: 'Space' }); await tick(); });
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-dimension-id]'));
const rowTexts = () => rows().map((row) => row.textContent);
const STORED_ORDER = [
  '1Analytics dimensionanalytics.defaultMark',
  '2Nature',
  '3Internal orderanalytics.disabledMark',
  '4Investmentmaster-data:shared.lineTypeUsage.capex',
];

function renderDialog() {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AnalyticsDimensionOrderDialog open onClose={onClose} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onClose, invalidate };
}

describe('AnalyticsDimensionOrderDialog', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ data: { items: AXES } });
    post.mockImplementation(async (_url: string, body: { axis_ids: string[] }) => ({
      data: { items: body.axis_ids.map((id, i) => ({ ...AXES.find((a) => a.id === id)!, sort_order: i + 1 })) },
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

  it('lists every dimension in its order, with the default, disabled and line type marks', async () => {
    renderDialog();
    expect(screen.getByText('analytics.reorderDimensions.title')).toBeInTheDocument();
    expect(screen.getByText('analytics.reorderDimensions.hint')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(get).toHaveBeenCalledWith('/analytics-axes');
    expect(rowTexts()).toEqual(STORED_ORDER);
    expect(rows()[0]).toHaveAttribute('aria-roledescription', 'analytics.reorderDimensions.roleDescription');
  });

  it('moves a dimension with the keyboard, then saves the whole order and refreshes every dimension query', async () => {
    const { onClose, invalidate } = renderDialog();
    await waitFor(() => expect(rows()).toHaveLength(4));

    // Investment goes up one place.
    await keyboardMove(rows()[3], 'ArrowUp');
    expect(rowTexts()).toEqual([STORED_ORDER[0], STORED_ORDER[1], '3Investmentmaster-data:shared.lineTypeUsage.capex', '4Internal orderanalytics.disabledMark']);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' })); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/analytics-axes/reorder', { axis_ids: ['ax-default', 'ax-nature', 'ax-invest', 'ax-order'] });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The list (useAnalyticsAxes) and the dimension details sit under this key.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analytics-axes'] });
  });

  it('cancels a move with Escape without closing the dialog; Escape with no move closes it', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => expect(rows()).toHaveLength(4));
    const nature = rows()[1];
    nature.focus();
    await act(async () => { fireEvent.keyDown(nature, { key: ' ', code: 'Space' }); await tick(); });
    await act(async () => { fireEvent.keyDown(document, { key: 'ArrowDown', code: 'ArrowDown' }); await tick(); });
    await act(async () => { fireEvent.keyDown(nature, { key: 'Escape', code: 'Escape' }); await tick(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(rowTexts()).toEqual(STORED_ORDER);

    await act(async () => { fireEvent.keyDown(rows()[1], { key: 'Escape', code: 'Escape' }); await tick(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('closes without a request when the order is unchanged', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => expect(rows()).toHaveLength(4));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('shows a refusal in the dialog and stays open', async () => {
    post.mockRejectedValue(Object.assign(new Error('Request failed'), {
      response: { status: 400, data: { message: 'A dimension in this order does not exist. Reload the page and try again.' } },
    }));
    const { onClose } = renderDialog();
    await waitFor(() => expect(rows()).toHaveLength(4));
    await keyboardMove(rows()[1], 'ArrowUp');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' })); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole('alert')).getByText(/A dimension in this order does not exist/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
