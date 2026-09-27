import React from 'react';
import { render } from '@testing-library/react';
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
vi.mock('../../components/reports/ReportLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/reports/ReportLayout')>()),
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
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
const summaryHook = vi.fn();
vi.mock('./useOpexSummary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useOpexSummary')>()),
  useOpexSummaryAll: (years?: number[]) => summaryHook(years),
}));

import ComparisonReport from './ComparisonReport';

describe('ComparisonReport', () => {
  it('requests every year it offers, Y-2 to Y+2', () => {
    summaryHook.mockReturnValue({ data: [], isLoading: false });
    render(<MemoryRouter><ComparisonReport /></MemoryRouter>);
    const Y = new Date().getFullYear();
    expect(summaryHook).toHaveBeenCalledWith([Y - 2, Y - 1, Y, Y + 1, Y + 2]);
  });
});
