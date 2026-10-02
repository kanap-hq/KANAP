import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { formatAmount } from '../../i18n/formatters';
import { useLocalStorageState } from '../../hooks/useLocalStorageState';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { FreezeColumn } from '../../services/freeze';
import { FinanceModuleConfig } from './config';
import { AMOUNT_COLUMNS } from './amountColumns';
import {
  overlayYear,
  YEARLY_TOTALS_FROM,
  YEARLY_TOTALS_TO,
  yearlyTotalsQueryKey,
  type LiveBudgetTotals,
  type YearTotals,
} from './yearlyTotals';

// The chart library (its own vendor chunk) loads with the first chart drawn, not with the workspace.
const AgChartsReact = React.lazy(() => import('ag-charts-react').then((mod) => ({ default: mod.AgChartsReact })));

/** Series keys are the yearly totals keys, one per column. */
type SeriesKey = FreezeColumn;
const SERIES_KEYS: SeriesKey[] = AMOUNT_COLUMNS.map((column) => column.freezeKey);
const isSeriesKey = (v: unknown): v is SeriesKey => SERIES_KEYS.includes(v as SeriesKey);

/** Series colours by column position (1 to 5), light and dark; each column keeps its colour when others are hidden. */
const SERIES_COLORS: Array<{ light: string; dark: string } | 'orange'> = [
  { light: '#3B82F6', dark: '#60A5FA' },
  { light: '#6B7280', dark: '#9CA3AF' },
  { light: '#8B5CF6', dark: '#A78BFA' },
  { light: '#10B981', dark: '#34D399' },
  'orange',
];

export default function BudgetTrendChart({
  id,
  year,
  liveTotals,
  currency,
  config,
}: {
  id: string;
  year: number;
  liveTotals?: LiveBudgetTotals;
  currency?: string;
  config: FinanceModuleConfig;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const { shown } = useBudgetColumns();

  // Legend toggles live inside AG Charts and reset whenever the chart remounts
  // (navigating between items). Mirror them here so the choice survives, per module.
  const [storedHidden, setHidden] = useLocalStorageState<SeriesKey[]>(
    `kanap.${config.module}.budgetTrend.hiddenSeries`,
    [],
  );
  const hidden = React.useMemo(
    () => (Array.isArray(storedHidden) ? storedHidden.filter(isSeriesKey) : []),
    [storedHidden],
  );

  const { data } = useQuery({
    queryKey: yearlyTotalsQueryKey(config, id),
    queryFn: async () => {
      const res = await api.get<{ items: YearTotals[] }>(`${config.itemsApi}/${id}/yearly-totals`, {
        params: { from: YEARLY_TOTALS_FROM, to: YEARLY_TOTALS_TO },
      });
      return res.data?.items || [];
    },
    staleTime: 30_000,
    enabled: !!id,
  });

  // Keep the last payload across refetches so the canvas is never fed [].
  const itemsRef = React.useRef<YearTotals[]>([]);
  if (data) itemsRef.current = data;
  const items = data ?? itemsRef.current;

  const merged = React.useMemo(
    () => overlayYear(items, year, liveTotals),
    [items, year, liveTotals],
  );

  const series = React.useMemo(() => {
    const colorOf = (position: number) => {
      const color = SERIES_COLORS[position - 1];
      return color === 'orange' ? theme.palette.kanap.orange : dark ? color.dark : color.light;
    };
    const line = (yKey: SeriesKey, yName: string, color: string) => ({
      type: 'line' as const,
      xKey: 'year',
      yKey,
      yName,
      visible: !hidden.includes(yKey),
      stroke: color,
      strokeWidth: 2,
      marker: { enabled: true, size: 6, fill: color, stroke: color },
    });
    return shown.map((column) => line(column.freezeKey, column.label, colorOf(column.position)));
  }, [dark, theme, hidden, shown]);

  const shownKeysRef = React.useRef<SeriesKey[]>([]);
  shownKeysRef.current = shown.map((column) => column.freezeKey);

  // Mirror AG Charts' own legend behaviour: click toggles one series, double-click
  // isolates it (or shows everything again when it is already the only one visible).
  const legendListeners = React.useMemo(() => ({
    legendItemClick: ({ itemId, enabled }: { itemId: string; enabled: boolean }) => {
      if (!isSeriesKey(itemId)) return;
      setHidden((prev) => (enabled ? prev.filter((k) => k !== itemId) : [...prev.filter((k) => k !== itemId), itemId]));
    },
    legendItemDoubleClick: ({ itemId }: { itemId: string }) => {
      if (!isSeriesKey(itemId)) return;
      setHidden((prev) => {
        const others = shownKeysRef.current.filter((k) => k !== itemId);
        const alreadyAlone = others.every((k) => prev.includes(k)) && !prev.includes(itemId);
        return alreadyAlone ? [] : others;
      });
    },
  }), [setHidden]);

  // Theme / series stay on a data-independent object so AG Charts can delta-update
  // the series data without re-applying the theme (canvas flash).
  const chartMeta = React.useMemo(() => ({
    theme: dark ? 'ag-default-dark' : 'ag-default',
    background: { fill: 'transparent' },
    series,
    axes: [
      { type: 'category', position: 'bottom' },
      { type: 'number', position: 'left', label: { formatter: (p: { value: number }) => formatAmount(p.value) } },
    ],
    legend: { enabled: true, position: 'bottom', listeners: legendListeners },
    padding: { top: 8, right: 12, bottom: 4, left: 4 },
    animation: { enabled: false },
  }), [dark, series, legendListeners]);

  const options = React.useMemo(
    () => ({ ...chartMeta, data: merged }),
    [chartMeta, merged],
  );

  return (
    <Box sx={{ bgcolor: 'kanap.bg.drawer', border: '1px solid', borderColor: 'kanap.border.soft', borderRadius: '8px', p: 2 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 }}>
        {t(`${config.i18nPrefix}.budget.multiYearTitle`)}{currency ? ` · ${currency.toUpperCase()}` : ''}
      </Typography>
      <Box sx={{ height: 260 }}>
        <React.Suspense fallback={null}>
          <AgChartsReact options={options as any} />
        </React.Suspense>
      </Box>
    </Box>
  );
}
