import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
// The real ReportLayout module (filter helpers) and the report filter bar are loaded: their locale and
// auth modules would load i18n.
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
// The layout's notice of the amounts left out without an exchange rate is the real one.
vi.mock('../../components/reports/ReportLayout', async (importOriginal) => {
  const { default: FxMissingNotice } = await import('../../components/finance/FxMissingNotice');
  return {
    ...(await importOriginal<typeof import('../../components/reports/ReportLayout')>()),
    default: ({ children, fxMissing }: { children?: React.ReactNode; fxMissing?: React.ComponentProps<typeof FxMissingNotice>['items'] }) => (
      <div><FxMissingNotice items={fxMissing} />{children}</div>
    ),
  };
});
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return { ...actual, useCostCenterTree: () => actual.buildCostCenterTree([]) };
});
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return { ...actual, useAnalyticsAxes: () => actual.buildAnalyticsAxes([], ((key: string) => key) as never) };
});
vi.mock('../../components/reports/ChartCard', () => ({ default: React.forwardRef(() => null) }));
vi.mock('../../components/reports/ReportGrid', () => ({ default: () => null }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn() } }));

import api from '../../api';
import ComparisonReport from './ComparisonReport';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const empty = { groups: [], others: null, total: { keys: [], count: 0, values: {}, unknown: {} }, groupCount: 0, reportingCurrency: null };

describe('ComparisonReport', () => {
  it('reads the window of every year it offers, Y-2 to Y+2, and sums the range on the server', async () => {
    post.mockResolvedValue({ data: empty });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter><ComparisonReport /></MemoryRouter></QueryClientProvider>);
    const Y = new Date().getFullYear();
    await waitFor(() => expect(post.mock.calls.some(([, body]) => body.spec.groupBy.length === 0 && body.spec.measures.length > 0)).toBe(true));
    const [url, body] = post.mock.calls.find(([, b]) => b.spec.groupBy.length === 0 && b.spec.measures.length > 0)!;
    expect(url).toBe('/budget-lines/summary/aggregate');
    expect(body.query.years).toBe([Y - 2, Y - 1, Y, Y + 1, Y + 2].join(','));
    // Default range Y-1 to Y+1, one sum per shown default column and year.
    expect(body.spec.measures.map((m: { field: string }) => m.field)).toContain(`y${Y - 1}Budget`);
    expect(body.spec.measures.map((m: { field: string }) => m.field)).toContain(`y${Y + 1}Budget`);
    expect(body.spec.measures.map((m: { field: string }) => m.field)).not.toContain(`y${Y - 2}Budget`);
    // The filter bar's options read the same window.
    expect(post.mock.calls.some(([, b]) => b.spec.groupBy[0] === 'run_build' && b.query.years === body.query.years)).toBe(true);
  });

  it('names at its top the amounts its aggregate leaves out without an exchange rate', async () => {
    const Y = new Date().getFullYear();
    post.mockReset();
    post.mockImplementation(async (_url: string, body: { spec: { groupBy: string[]; measures: unknown[] } }) => ({
      data: body.spec.groupBy.length === 0 && body.spec.measures.length > 0
        ? { ...empty, reportingCurrency: 'EUR', fxMissing: [{ currency: 'USD', year: Y, lines: 2 }, { currency: 'JPY', year: Y + 1, lines: 1 }] }
        : { ...empty, fxMissing: [] },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter><ComparisonReport /></MemoryRouter></QueryClientProvider>);
    // Once, for the report's aggregates together.
    expect(await screen.findAllByText('ops:shared.fxMissing.excludingSeveral')).toHaveLength(1);
  });
});
