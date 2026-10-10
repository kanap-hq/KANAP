import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

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
import AnalyticsDimensionChipBar from './AnalyticsDimensionChipBar';
import type { AnalyticsAxis } from '../../services/analytics';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

function axis(id: string, name: string, sortOrder: number, patch: Partial<AnalyticsAxis> = {}): AnalyticsAxis {
  return {
    id, code: id, name, description: null, sort_order: sortOrder, is_default: false, applies_to: null,
    required: false, status: 'enabled', disabled_at: null, ...patch,
  };
}

const DEFAULT = axis('ax-default', 'Category', 0, { is_default: true });
const NATURE = axis('ax-nature', 'Nature', 1);

function renderBar(props: { axes: AnalyticsAxis[]; canEdit: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AnalyticsDimensionChipBar
          axes={props.axes}
          selectedAxisId={props.axes[0]?.id ?? null}
          label={(a) => a.name ?? ''}
          onSelect={vi.fn()}
          onEdit={vi.fn()}
          canEdit={props.canEdit}
          onCreate={props.canEdit ? vi.fn() : undefined}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const reorderButton = () => screen.queryByRole('button', { name: 'analytics.reorderDimensions.action' });

describe('AnalyticsDimensionChipBar', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { items: [DEFAULT, NATURE] } });
  });

  it('offers Reorder next to New and Edit to users who can edit dimensions, and opens the dialog', async () => {
    renderBar({ axes: [DEFAULT, NATURE], canEdit: true });
    const reorder = reorderButton();
    expect(reorder).toBeEnabled();
    expect(reorder).toHaveTextContent('analytics.reorder.action');
    const actions = screen.getAllByRole('button').filter((button) => !button.hasAttribute('aria-pressed'));
    expect(actions.map((button) => button.getAttribute('aria-label'))).toEqual([
      'analytics.newDimension',
      'analytics.reorderDimensions.action',
      'analytics.editDimension:Category',
    ]);
    expect(get).not.toHaveBeenCalled();

    fireEvent.click(reorder!);
    expect(await screen.findByText('analytics.reorderDimensions.title')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/analytics-axes');
  });

  it('disables Reorder with fewer than two dimensions', () => {
    renderBar({ axes: [DEFAULT], canEdit: true });
    expect(reorderButton()).toBeDisabled();
  });

  it('hides Reorder from readers', () => {
    renderBar({ axes: [DEFAULT, NATURE], canEdit: false });
    expect(reorderButton()).toBeNull();
    expect(screen.getByRole('button', { name: 'analytics.openDimension:Category' })).toBeInTheDocument();
  });
});
