import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// jsdom has no localStorage here: the export control remembers the format in it.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
    },
  });
}

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  const translation = { t, i18n: { language: 'fr', resolvedLanguage: 'fr' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../utils/downloadBlob', () => ({ downloadBlob: vi.fn(), extractFilenameFromDisposition: () => null }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
// The layout draws the server export control it is given, and the report.
vi.mock('../../components/reports/ReportLayout', async (importOriginal) => {
  const { default: ReportExportButton } = await import('../../components/reports/ReportExportButton');
  return {
    ...(await importOriginal<typeof import('../../components/reports/ReportLayout')>()),
    default: ({ filters, children, tableExport, onExportTableCsv }: any) => (
      <div>
        {filters}
        {tableExport && <ReportExportButton {...tableExport} />}
        {onExportTableCsv && <button type="button">browser csv</button>}
        {children}
      </div>
    ),
  };
});
vi.mock('../../components/reports/ChartCard', () => ({ default: React.forwardRef(() => null) }));
vi.mock('../../components/reports/ReportGrid', () => ({ default: () => null }));
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

const COMPANY = {
  year: 2026, metric: 'budget', scope: 'opex', total: 0, totalRaw: 0,
  company: { id: 'co-1', name: 'Acme France', total: 0, totalRaw: 0, headcount: null, itUsers: null, turnover: null, turnoverRaw: null, costPerUser: null, costPerUserRaw: null, costPerItUser: null, costPerItUserRaw: null, costVsTurnoverPct: null },
  departments: [], items: [], itemsTotal: 0, itemsTotalRaw: 0, itemsTotalShare: null, kpis: [], globalKpi: null,
  intercompany: { receivables: [], payables: [] }, intercompanyRows: [], intercompanyTotal: null, reportingCurrency: 'EUR', warnings: [],
};
const GLOBAL = {
  year: 2026, metric: 'budget', scope: 'opex', total: 0, totalRaw: 0, detailed: [], detailedRows: [], companies: [], kpis: [],
  kpiTotals: null, intercompanyFlows: [], nettedFlows: [], reportingCurrency: 'EUR', warnings: [],
};

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

const paramsOf = (url: string) => get.mock.calls.filter(([called]) => called === url).map(([, config]) => config ?? {});

describe('chargeback table export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    get.mockImplementation(async (url: string) => {
      if (url === '/reports/chargeback/company') return { data: COMPANY };
      if (url === '/reports/chargeback/global') return { data: GLOBAL };
      if (url.endsWith('/export')) return { data: new Blob(['x']), headers: {} };
      return { data: { items: [] } };
    });
  });

  it('asks the server for the global file with the screen parameters', async () => {
    renderReport(<GlobalChargebackReport />);
    await waitFor(() => expect(paramsOf('/reports/chargeback/global')).toHaveLength(1));
    const screenParams = paramsOf('/reports/chargeback/global')[0].params;
    expect(screen.queryByText('browser csv')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportTable' }));
    fireEvent.click(await screen.findByText('reports.shared.exportXlsx'));
    await waitFor(() => expect(paramsOf('/reports/chargeback/global/export')).toHaveLength(1));
    const [request] = paramsOf('/reports/chargeback/global/export');
    expect(request).toEqual({ params: { ...screenParams, format: 'xlsx', language: 'fr' }, responseType: 'blob' });
    expect(screenParams).toEqual({ year: expect.any(Number), metric: 'budget', scope: 'opex' });
  });

  it('asks the server for one company table as CSV with the screen parameters', async () => {
    renderReport(<CompanyChargebackReport />);
    await waitFor(() => expect(paramsOf('/reports/chargeback/company')).toHaveLength(1));
    const screenParams = paramsOf('/reports/chargeback/company')[0].params;
    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportTable' }));
    // One CSV item per table, in the order departments, items, intercompany, KPIs.
    const csvItems = await screen.findAllByText('reports.shared.exportCsvTable');
    expect(csvItems).toHaveLength(4);
    fireEvent.click(csvItems[1]);
    await waitFor(() => expect(paramsOf('/reports/chargeback/company/export')).toHaveLength(1));
    const [request] = paramsOf('/reports/chargeback/company/export');
    expect(request).toEqual({ params: { ...screenParams, format: 'csv', language: 'fr', table: 'items' }, responseType: 'blob' });
    expect(screenParams).toEqual({ companyId: 'co-1', year: expect.any(Number), metric: 'budget', scope: 'opex' });
  });
});
