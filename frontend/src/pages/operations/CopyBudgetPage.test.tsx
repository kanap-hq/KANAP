import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  // Messages with options come back as `key {options}` so the page's choices can be read.
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
// The grid draws its header and every cell as the page defines them (value getters, formatters, renderers).
vi.mock('ag-grid-react', () => ({
  AgGridReact: ({ rowData, columnDefs }: { rowData: any[]; columnDefs: any[] }) => (
    <table>
      <thead><tr>{columnDefs.map((col, i) => <th key={i}>{col.headerName}</th>)}</tr></thead>
      <tbody>
        {rowData.map((row) => (
          <tr key={row.id} data-testid={`row-${row.id}`}>
            {columnDefs.map((col, i) => {
              const value = col.valueGetter ? col.valueGetter({ data: row }) : row[col.field];
              const shown = col.valueFormatter ? col.valueFormatter({ value, data: row }) : value;
              const Renderer = col.cellRenderer;
              return (
                <td key={i} data-col={col.colId ?? col.field}>
                  {Renderer ? <Renderer value={value} data={row} colDef={col} /> : String(shown ?? '')}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../components/AgGridBox', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../components/reports/ReportLayout', () => ({
  default: ({ filters, actions, children }: { filters?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) => (
    <div>{filters}{actions}{children}</div>
  ),
  ReportFilter: ({ label, children }: { label: string; children: React.ReactNode }) => <label>{label}{children}</label>,
  reportFilterMenuProps: {},
  reportFilterSelectSx: {},
}));
const alert = vi.fn(async (_message: string) => undefined);
vi.mock('../../components/design', () => ({ useKanapDialogs: () => ({ alert }) }));
const frozen = vi.hoisted(() => ({ capex: false }));
vi.mock('../../hooks/useFreezeState', () => {
  const slot = (value: boolean) => ({ frozen: value });
  const scope = (value: boolean) => ({ budget: slot(value), revision: slot(false), forecast: slot(false), actual: slot(false), landing: slot(false) });
  return { useFreezeState: () => ({ data: { summary: { scopes: { opex: scope(false), capex: scope(frozen.capex) } } }, isLoading: false }) };
});
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const { DEFAULT_BUDGET_COLUMNS } = await import('../../services/budgetColumns');
  const value = mod.resolveBudgetColumns(DEFAULT_BUDGET_COLUMNS as never, ((key: string) => key) as never);
  return { ...mod, useBudgetColumns: () => value };
});

import api from '../../api';
import { fakeAggregate } from '../../test/fakeBudgetAggregate';
import CopyBudgetPage from './CopyBudgetPage';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const Y = new Date().getFullYear();
const COPY_URL = '/budget-lines/budget-operations/copy';

const slot = (year: number, budget: number) => ({ year, totals: { budget, revision: 0, forecast: 0, follow_up: 0, landing: 0 } });
/** The lines the server holds: the unified list reads both natures and the line's own number (`item_number`). */
const opexLine = { id: 'o-1', nature: 'opex', item_number: 1, line_number: 1, product_name: 'Licences', versions: { [`y${Y}`]: slot(Y, 1200) } };
const capexLine = {
  id: 'c-1', nature: 'capex', item_number: 500001, line_number: 500001, product_name: 'Servers',
  versions: { [`y${Y}`]: slot(Y, 9000), [`y${Y + 1}`]: slot(Y + 1, 300) },
};
/** The same line through the CAPEX routes: its title is `description`, its `item_number` the CPX number. */
const capexAliasLine = { ...capexLine, item_number: 7, description: 'Servers', product_name: undefined };

/** A preview of both parts: Licences copied (its automatic allocation replaced), Servers kept on both sides. */
const preview = (dryRun = true) => ({
  success: true,
  dryRun,
  scope: 'all',
  summary: {
    lines: 2,
    amounts: { totalItems: 2, processed: 1, skipped: 1, errors: 0 },
    allocations: { totalItems: 2, processed: 1, skipped: 1, errors: 0 },
  },
  results: [
    {
      itemId: 'o-1', itemNumber: 1, reference: 'BL-1', nature: 'opex', itemName: 'Licences',
      amounts: { sourceValue: 1200, currentDestinationValue: 0, newValue: 1200, skipped: false, skip: null, prorated: true, fromLines: false, calendarIssues: [] },
      allocations: {
        sourceMethod: 'headcount', sourceMethodLabel: 'Headcount', destinationMethod: 'it_users', destinationMethodLabel: 'IT users',
        resultMethod: 'headcount', resultMethodLabel: 'Headcount', sourceAllocationsCount: 2, destinationAllocationsCount: 0, action: 'copy',
      },
    },
    {
      itemId: 'c-1', itemNumber: 500001, reference: 'BL-500001', nature: 'capex', itemName: 'Servers',
      amounts: { sourceValue: 9000, currentDestinationValue: 300, newValue: 300, skipped: true, skip: 'destination_filled', prorated: false, fromLines: false, calendarIssues: [] },
      allocations: {
        sourceMethod: 'manual_pct', sourceMethodLabel: 'Manual', destinationMethod: 'manual_pct', destinationMethodLabel: 'Manual',
        resultMethod: 'manual_pct', resultMethodLabel: 'Manual', sourceAllocationsCount: 1, destinationAllocationsCount: 1, action: 'skip_destination_has_data',
      },
    },
  ],
});

/** The copy calls (the page's lines come from the aggregate routes). */
const operation = vi.fn();
const copyCalls = () => operation.mock.calls.filter(([url]) => url === COPY_URL).map(([, body]) => body);
const aggregateUrls = () => post.mock.calls.map(([url]) => url as string).filter((url) => url.endsWith('/summary/aggregate'));

function renderPage(path = '/ops/operations/copy-budget') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <CopyBudgetPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const button = (name: string) => screen.getByRole('button', { name: `operations.copyBudget.${name}` });
const checkbox = (name: string) => screen.queryByRole('checkbox', { name: `operations.copyBudget.${name}` });
/** The lines are in: the preview can run. */
const linesLoaded = () => waitFor(() => expect(button('preview')).toBeEnabled());

async function pickYear(label: 'sourceYear' | 'destinationYear', year: number) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: `operations.copyBudget.${label}` }));
  fireEvent.click(await screen.findByRole('option', { name: String(year) }));
}

describe('CopyBudgetPage', () => {
  beforeEach(() => {
    frozen.capex = false;
    alert.mockClear();
    operation.mockReset();
    operation.mockImplementation(async (_url: string, body: any) => ({ data: preview(body.dryRun) }));
    get.mockReset();
    get.mockResolvedValue({ data: { fiscal_year: Y, mode: 'auto', method: 'headcount', source: 'standard', standard_mode: 'auto', standard_method: 'headcount' } });
    post.mockReset();
    post.mockImplementation(async (url: string, body: any) => {
      if (url === '/budget-lines/summary/aggregate') return { data: fakeAggregate([opexLine, capexLine], body) };
      if (url === '/spend-items/summary/aggregate') return { data: fakeAggregate([opexLine], body) };
      if (url === '/capex-items/summary/aggregate') return { data: fakeAggregate([capexAliasLine], body) };
      return operation(url, body);
    });
  });

  it('opens on all lines, with the amounts and the allocations ticked between two years', async () => {
    renderPage();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['operations.scope.all', 'operations.scope.opex', 'operations.scope.capex']);
    expect(screen.getByRole('tab', { name: 'operations.scope.all' })).toHaveAttribute('aria-selected', 'true');
    expect(checkbox('amounts')).toBeChecked();
    expect(checkbox('allocations')).toBeChecked();
    await linesLoaded();
    expect(aggregateUrls()).toContain('/budget-lines/summary/aggregate');

    fireEvent.click(button('preview'));
    await waitFor(() => expect(copyCalls()).toHaveLength(1));
    expect(copyCalls()[0]).toEqual({
      scope: 'all',
      sourceYear: Y,
      destinationYear: Y + 1,
      amounts: { sourceColumn: 'budget', destinationColumn: 'budget', percentageIncrease: 0 },
      allocations: true,
      overwrite: false,
      dryRun: true,
    });
  });

  it('hides and unticks the allocations within one year, and ticks them again between two years', async () => {
    renderPage();
    await linesLoaded();
    fireEvent.click(checkbox('allocations')!);
    expect(checkbox('allocations')).not.toBeChecked();
    await pickYear('destinationYear', Y);
    expect(checkbox('allocations')).toBeNull();
    await linesLoaded();
    fireEvent.click(button('preview'));
    await waitFor(() => expect(copyCalls()).toHaveLength(1));
    expect(copyCalls()[0]).toMatchObject({ sourceYear: Y, destinationYear: Y, allocations: false });

    await pickYear('destinationYear', Y + 2);
    expect(checkbox('allocations')).toBeChecked();
  });

  it('opens with the amounts unticked from the former allocation copy, and copies the allocations only', async () => {
    renderPage('/ops/operations/copy-budget?amounts=0');
    expect(checkbox('amounts')).not.toBeChecked();
    expect(checkbox('allocations')).toBeChecked();
    expect(screen.queryByRole('combobox', { name: 'operations.copyBudget.sourceColumn' })).toBeNull();
    await linesLoaded();
    fireEvent.click(button('preview'));
    await waitFor(() => expect(copyCalls()).toHaveLength(1));
    expect(copyCalls()[0]).toMatchObject({ scope: 'all', amounts: null, allocations: true });
  });

  it('asks for a part when none is ticked and keeps the buttons off', async () => {
    renderPage('/ops/operations/copy-budget?amounts=0');
    await linesLoaded();
    await pickYear('destinationYear', Y);
    expect(screen.getByText('operations.copyBudget.chooseParts')).toBeInTheDocument();
    expect(button('preview')).toBeDisabled();
    expect(button('copy')).toBeDisabled();
  });

  it('previews both parts line by line, with BL links in a new tab and the type, then copies', async () => {
    renderPage();
    await linesLoaded();
    expect(button('copy')).toBeDisabled();
    fireEvent.click(button('preview'));

    const licences = await screen.findByTestId('row-o-1');
    await waitFor(() => expect(within(licences).getByText('operations.copyBudget.prorated')).toBeInTheDocument());
    const link = within(licences).getByRole('link', { name: 'Licences' });
    expect(link).toHaveAttribute('href', '/ops/budget/BL-1');
    expect(link).toHaveAttribute('target', '_blank');
    const servers = screen.getByTestId('row-c-1');
    // The line's own number, never the CPX number the CAPEX list shows.
    expect(within(servers).getByRole('link', { name: 'Servers' })).toHaveAttribute('href', '/ops/budget/BL-500001');
    const cell = (row: HTMLElement, col: string) => row.querySelector(`[data-col="${col}"]`)?.textContent;
    expect(cell(servers, 'nature')).toBe('operations.scope.capex');
    expect(cell(licences, 'amountsStatus')).toBe('operations.copyBudget.status.toCopy');
    expect(cell(servers, 'amountsStatus')).toBe('operations.copyBudget.status.destinationFilled');
    // An automatic allocation counts as empty: the preview says its method is replaced.
    expect(cell(licences, 'allocationsStatus')).toBe('operations.copyBudget.status.replaces {"method":"IT users"}');
    expect(cell(servers, 'allocationsStatus')).toBe(`operations.copyBudget.status.destinationAllocation {"year":${Y + 1}}`);
    expect(cell(servers, 'afterValue')).toBe('300');
    expect(screen.getByText(`operations.copyBudget.methodsReplaced {"count":1,"year":${Y + 1}}`)).toBeInTheDocument();
    expect(screen.getByText(`operations.copyBudget.existingAllocations {"count":1,"year":${Y + 1}}`)).toBeInTheDocument();

    await waitFor(() => expect(button('copy')).toBeEnabled());
    fireEvent.click(button('copy'));
    await waitFor(() => expect(copyCalls()).toHaveLength(2));
    expect(copyCalls()[1]).toMatchObject({ scope: 'all', dryRun: false, allocations: true, amounts: { acceptCalendarChanges: false } });
    // The result stays on screen, line by line.
    expect(await screen.findByText('operations.copyBudget.resultTitle')).toBeInTheDocument();
    expect(cell(screen.getByTestId('row-o-1'), 'amountsStatus')).toBe('operations.copyBudget.status.copied');
    expect(button('copy')).toBeDisabled();
  });

  it('reads and copies the CAPEX lines alone from the CAPEX tab, without the type column', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await waitFor(() => expect(aggregateUrls()).toContain('/capex-items/summary/aggregate'));
    expect(await screen.findByRole('link', { name: 'Servers' })).toHaveAttribute('href', '/ops/budget/BL-500001');
    expect(screen.queryByRole('columnheader', { name: 'operations.scope.label' })).toBeNull();
    await linesLoaded();
    fireEvent.click(button('preview'));
    await waitFor(() => expect(copyCalls()).toHaveLength(1));
    expect(copyCalls()[0]).toMatchObject({ scope: 'capex' });
  });

  it('names the frozen type in All and keeps the copy off', async () => {
    frozen.capex = true;
    renderPage();
    expect(await screen.findByText(/operations\.copyBudget\.frozenNatureError .*"nature":"operations\.scope\.capex"/)).toBeInTheDocument();
    expect(button('preview')).toBeDisabled();
    // OPEX alone is not frozen.
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.opex' }));
    await linesLoaded();
  });

  it('asks to confirm a calendar change before the copy', async () => {
    const withIssue = preview();
    withIssue.results[0].amounts.calendarIssues = [{ line: 'Consultant', lineNumber: 1, calendar: 'Custom', kind: 'missing' }] as never;
    operation.mockResolvedValueOnce({ data: withIssue });
    renderPage();
    await linesLoaded();
    fireEvent.click(button('preview'));
    const confirm = await screen.findByRole('checkbox', { name: 'operations.copyBudget.acceptCalendarChanges' });
    expect(button('copy')).toBeDisabled();
    fireEvent.click(confirm);
    expect(button('copy')).toBeEnabled();
    fireEvent.click(button('copy'));
    await waitFor(() => expect(copyCalls()).toHaveLength(2));
    expect(copyCalls()[1]).toMatchObject({ amounts: { acceptCalendarChanges: true } });
  });
});
