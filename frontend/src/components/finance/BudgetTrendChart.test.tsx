import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { OPEX_FINANCE_CONFIG } from './config';
import {
  YEARLY_TOTALS_FROM,
  yearlyTotalsQueryKey,
  type LiveBudgetTotals,
  type YearTotals,
} from './yearlyTotals';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
}));

// The tenant's column settings, set per test; the hook resolves them once per settings object.
const columnsSetting = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  let cache: { settings: unknown; value: ReturnType<typeof mod.resolveBudgetColumns> } | null = null;
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.resolveBudgetColumns>[1];
  return {
    ...mod,
    useBudgetColumns: () => {
      if (!cache || cache.settings !== columnsSetting.current) {
        cache = { settings: columnsSetting.current, value: mod.resolveBudgetColumns(columnsSetting.current as never, t) };
      }
      return cache.value;
    },
  };
});

type LegendEvent = { itemId: string; enabled: boolean };
type ChartOptions = {
  data?: YearTotals[];
  series?: { yKey: string; yName: string; visible: boolean; stroke: string }[];
  legend?: {
    listeners?: {
      legendItemClick?: (e: LegendEvent) => void;
      legendItemDoubleClick?: (e: LegendEvent) => void;
    };
  };
};

const chartState = {
  mounts: 0,
  lastOptions: null as ChartOptions | null,
};

vi.mock('ag-charts-react', () => ({
  AgChartsReact: ({ options }: { options: ChartOptions }) => {
    React.useEffect(() => {
      chartState.mounts += 1;
    }, []);
    chartState.lastOptions = options;
    return <div data-testid="budget-trend-chart" />;
  },
}));

import BudgetTrendChart from './BudgetTrendChart';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';

// jsdom here ships without localStorage; the chart persists its legend choice there.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size; },
    },
  });
}

const theme = createAppTheme('light');
const year = YEARLY_TOTALS_FROM + 3;
const seeded: YearTotals[] = Array.from({ length: 5 }, (_, i) => ({
  year: YEARLY_TOTALS_FROM + i,
  budget: 1,
  revision: 2,
  forecast: 5,
  actual: 3,
  landing: 4,
}));
const live = (over: Partial<LiveBudgetTotals> = {}): LiveBudgetTotals => ({
  planned: 10, committed: 20, forecast: 25, actual: 30, expected_landing: 40, ...over,
});

function renderChart(liveTotals?: LiveBudgetTotals) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(yearlyTotalsQueryKey(OPEX_FINANCE_CONFIG, 'item-1'), seeded);

  const ui = (totals?: LiveBudgetTotals) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <BudgetTrendChart
          id="item-1"
          year={year}
          liveTotals={totals}
          currency="EUR"
          config={OPEX_FINANCE_CONFIG}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );

  const view = render(ui(liveTotals));
  return { ...view, rerenderWith: (totals?: LiveBudgetTotals) => view.rerender(ui(totals)) };
}

describe('BudgetTrendChart', () => {
  // The chart library loads with the first chart drawn (its own chunk): load it once, then every test draws at once.
  beforeAll(async () => {
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    const view = renderChart(undefined);
    expect(await screen.findByTestId('budget-trend-chart')).toBeInTheDocument();
    view.unmount();
  });

  beforeEach(() => {
    chartState.mounts = 0;
    chartState.lastOptions = null;
    window.localStorage.clear();
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
  });

  const visibleKeys = () =>
    (chartState.lastOptions?.series ?? []).filter((s) => s.visible).map((s) => s.yKey);

  it('overlays live totals onto the selected year and leaves other years unchanged', () => {
    renderChart(live());

    expect(chartState.lastOptions?.data?.find((row) => row.year === year)).toEqual({
      year,
      budget: 10,
      revision: 20,
      forecast: 25,
      actual: 30,
      landing: 40,
    });
    expect(chartState.lastOptions?.data?.find((row) => row.year === year - 1)).toEqual({
      year: year - 1,
      budget: 1,
      revision: 2,
      forecast: 5,
      actual: 3,
      landing: 4,
    });
  });

  it('updates series data in place when live totals change', () => {
    const { rerenderWith } = renderChart(live());
    expect(chartState.mounts).toBe(1);
    expect(chartState.lastOptions?.data?.find((row) => row.year === year)?.budget).toBe(10);

    rerenderWith(live({ planned: 250000 }));
    expect(chartState.mounts).toBe(1);
    expect(chartState.lastOptions?.data?.find((row) => row.year === year)?.budget).toBe(250000);
    expect(chartState.lastOptions?.data).not.toEqual([]);
  });

  it('keeps fetched yearly totals when live overlay is not ready', () => {
    renderChart(undefined);
    expect(chartState.lastOptions?.data).toEqual(seeded);
  });

  it('remembers hidden legend series across remounts', () => {
    const first = renderChart(undefined);
    expect(visibleKeys()).toEqual(['budget', 'revision', 'actual', 'landing']);

    act(() => {
      chartState.lastOptions?.legend?.listeners?.legendItemClick?.({ itemId: 'revision', enabled: false });
    });
    expect(visibleKeys()).toEqual(['budget', 'actual', 'landing']);

    first.unmount();
    renderChart(undefined);
    expect(visibleKeys()).toEqual(['budget', 'actual', 'landing']);

    act(() => {
      chartState.lastOptions?.legend?.listeners?.legendItemClick?.({ itemId: 'revision', enabled: true });
    });
    expect(visibleKeys()).toEqual(['budget', 'revision', 'actual', 'landing']);
  });

  it('double-click isolates a series, and shows all again when it is already alone', () => {
    renderChart(undefined);
    const dblclick = (itemId: string) =>
      act(() => {
        chartState.lastOptions?.legend?.listeners?.legendItemDoubleClick?.({ itemId, enabled: true });
      });

    dblclick('actual');
    expect(visibleKeys()).toEqual(['actual']);
    dblclick('actual');
    expect(visibleKeys()).toEqual(['budget', 'revision', 'actual', 'landing']);
  });

  it('draws Forecast as a fifth series when it is shown, in the fixed order, with the tenant names and its own colour', () => {
    columnsSetting.current = {
      ...DEFAULT_BUDGET_COLUMNS,
      enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, forecast: true },
      labels: { ...DEFAULT_BUDGET_COLUMNS.labels, forecast: 'A2' },
    };
    renderChart(live());
    const series = chartState.lastOptions?.series ?? [];
    expect(series.map((s) => s.yKey)).toEqual(['budget', 'revision', 'forecast', 'actual', 'landing']);
    expect(series[2].yName).toBe('A2');
    expect(new Set(series.map((s) => s.stroke)).size).toBe(5);
    expect(chartState.lastOptions?.data?.find((row) => row.year === year)?.forecast).toBe(25);
  });

  it('leaves out the series of a hidden column', () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, committed: false } };
    renderChart(undefined);
    expect((chartState.lastOptions?.series ?? []).map((s) => s.yKey)).toEqual(['budget', 'actual', 'landing']);
  });
});
