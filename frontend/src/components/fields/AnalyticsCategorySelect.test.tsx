import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());
const axesState = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: apiGet } }));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return {
    ...actual,
    useAnalyticsAxes: () => actual.buildAnalyticsAxes(axesState.list as any, ((key: string) => key) as any),
  };
});

import AnalyticsCategorySelect from './AnalyticsCategorySelect';

const NATURE_VALUES = [
  { id: 'v-lic', axis_id: 'ax-nature', name: 'Licenses', description: null, status: 'enabled', disabled_at: null },
  { id: 'v-hw', axis_id: 'ax-nature', name: 'Hardware', description: 'Servers and laptops', status: 'enabled', disabled_at: null },
];

function renderSelect(props: Partial<React.ComponentProps<typeof AnalyticsCategorySelect>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AnalyticsCategorySelect axisId="ax-nature" value={null} onChange={onChange} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onChange, queryClient };
}

describe('AnalyticsCategorySelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    axesState.list = [
      { id: 'ax-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, status: 'enabled', disabled_at: null },
      { id: 'ax-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, status: 'enabled', disabled_at: null },
    ];
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/analytics-categories') return { data: { items: NATURE_VALUES } };
      if (url === '/analytics-categories/v-old') {
        return { data: { id: 'v-old', axis_id: 'ax-nature', name: 'Old licenses', description: null, status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' } };
      }
      throw new Error(`unexpected ${url}`);
    });
  });

  it('loads the values of its dimension only, under a cache key per dimension', async () => {
    const { queryClient } = renderSelect();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories', {
      params: { axis_id: 'ax-nature', limit: 1000, sort: 'name:ASC' },
    }));
    await waitFor(() => expect(queryClient.getQueryData(['analytics-categories', 'axis', 'ax-nature'])).toEqual(NATURE_VALUES));
  });

  it('offers the values by name and returns the picked id', async () => {
    const { onChange } = renderSelect();
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.mouseDown(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Hardware' + 'Servers and laptops', 'Licenses']);
    fireEvent.click(screen.getByText('Licenses'));
    expect(onChange).toHaveBeenCalledWith('v-lic');
  });

  it('keeps a disabled current value shown, fetched by id', async () => {
    renderSelect({ value: 'v-old' });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/analytics-categories/v-old'));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Old licenses'));
  });

  it('is labelled with the dimension name, the translated default label for the unnamed default', async () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <AnalyticsCategorySelect axisId="ax-nature" value={null} onChange={() => undefined} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText('Nature')).toBeInTheDocument();
    unmount();
    renderSelect({ axisId: 'ax-default' });
    expect(await screen.findByLabelText('master-data:analytics.analyticsCategoryFallback')).toBeInTheDocument();
  });

  it('uses the label it is given, also as the name of a field whose label is hidden', async () => {
    renderSelect({ label: 'Cost nature', hideLabel: true });
    expect(await screen.findByLabelText('Cost nature')).toBeInTheDocument();
    expect(screen.queryByText('Nature')).toBeNull();
  });
});
