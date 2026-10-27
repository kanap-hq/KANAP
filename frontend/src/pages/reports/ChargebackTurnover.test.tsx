import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: { references?: string }) => (options?.references ? `${key}: ${options.references}` : key);
  const translation = { t, i18n: { language: 'fr', resolvedLanguage: 'fr' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
vi.mock('../../components/reports/ReportLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/reports/ReportLayout')>()),
  default: ({ filters, children }: { filters?: React.ReactNode; children?: React.ReactNode }) => <div>{filters}{children}</div>,
}));
vi.mock('../../components/reports/ChartCard', () => ({ default: React.forwardRef(() => null) }));
vi.mock('../../components/reports/ReportGrid', () => ({ default: () => null }));
// The company report waits for a company: the picker hands one over at once.
vi.mock('../../components/fields/CompanySelect', () => ({
  default: ({ value, onChange }: { value: string | null; onChange: (id: string) => void }) => {
    React.useEffect(() => { if (!value) onChange('co-1'); }, [value, onChange]);
    return null;
  },
}));

import api from '../../api';
import CompanyChargebackReport from './CompanyChargebackReport';
import GlobalChargebackReport from './GlobalChargebackReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const KPI = {
  companyId: 'co-1',
  companyName: 'Acme France',
  amount: 1000,
  amountRaw: 1000,
  headcount: 10,
  itUsers: 5,
  turnover: 31331125,
  turnoverRaw: 31331125,
  costPerUser: 100,
  costPerItUser: 200,
  costVsTurnoverPct: 0.01,
};

const SUMMARY = {
  id: 'co-1', name: 'Acme France', total: 1000, totalRaw: 1000, headcount: 10, itUsers: 5,
  turnover: 31331125, turnoverRaw: 31331125, costPerUser: 100, costPerUserRaw: 100,
  costPerItUser: 200, costPerItUserRaw: 200, costVsTurnoverPct: 0.01,
};

/** The turnover as French writes an amount in pounds, without decimals: the separators come from Intl. */
const EXPECTED = new Intl.NumberFormat('fr', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(31331125);

function renderReport(report: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>{report}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const cellTexts = () => screen.queryAllByRole('cell').map((cell) => cell.textContent);

describe('chargeback turnover indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (url: string) => {
      if (url === '/reports/chargeback/company') {
        return {
          data: {
            year: 2026, metric: 'budget', total: 1000, totalRaw: 1000, company: SUMMARY,
            departments: [], items: [], itemsTotal: 0, itemsTotalRaw: 0,
            kpis: [KPI], globalKpi: { ...KPI }, intercompany: { receivables: [], payables: [] },
            reportingCurrency: 'gbp', warnings: [],
          },
        };
      }
      if (url === '/reports/chargeback/global') {
        return {
          data: {
            year: 2026, metric: 'budget', total: 1000, totalRaw: 1000, detailed: [], companies: [],
            kpis: [KPI], intercompanyFlows: [], reportingCurrency: 'gbp', warnings: [],
            detailedRows: [], nettedFlows: [],
            kpiTotals: { amount: 1000, headcount: 10, itUsers: 5, turnover: 31331125, costVsTurnoverPct: 0.01, costPerUser: 100, costPerItUser: 200 },
          },
        };
      }
      return { data: { items: [] } };
    });
  });

  it('shows the turnover of the company report in the reporting currency', async () => {
    renderReport(<CompanyChargebackReport />);
    await waitFor(() => expect(cellTexts()).toContain('Acme France'));
    // The company row and the totals row.
    expect(cellTexts().filter((text) => text === EXPECTED)).toHaveLength(2);
  });

  it('names the hidden lines without a rate by their reference, without a link', async () => {
    const current = get.getMockImplementation() as (url: string) => Promise<{ data: Record<string, unknown> }>;
    const base = await current('/reports/chargeback/company');
    get.mockImplementation(async (url: string) => (url === '/reports/chargeback/company'
      ? { data: { ...base.data, globalKpi: null, dataAccessLimited: true, fxMissingHiddenLines: [12, 14] } }
      : { data: { items: [] } }));
    renderReport(<CompanyChargebackReport />);
    const warning = await screen.findByText('reports.companyChargeback.fxMissingHiddenLines: BL-12, BL-14');
    expect(warning.closest('a')).toBeNull();
  });

  it('shows the turnover of the global report in the reporting currency', async () => {
    renderReport(<GlobalChargebackReport />);
    await waitFor(() => expect(cellTexts()).toContain('Acme France'));
    expect(cellTexts().filter((text) => text === EXPECTED)).toHaveLength(2);
  });
});
