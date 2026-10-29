import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    if (options && Object.keys(options).length > 0) return `${key}:${JSON.stringify(options)}`;
    return key;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'fr', resolvedLanguage: 'fr' } }) };
});

vi.mock('../../api', () => ({
  default: {
    post: vi.fn(),
    // The tenant's column names: the product defaults.
    get: vi.fn(async () => ({ data: (await import('../../services/budgetColumns')).DEFAULT_BUDGET_COLUMNS })),
  },
}));
const features = vi.hoisted(() => ({ importXlsx: true }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features }, isLoading: false }) }));

import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import { formatShortDateTime } from '../../lib/dateFormat';
import { DECODE_SENTENCE_CODES, OLD_LAYOUT_SENTENCE, STALE_SENTENCE } from './budgetFile';
import BudgetFileImportDialog from './BudgetFileImportDialog';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

const DATES_DAY = 'Dates read day first: 01/03/2027 is March 1.';
const DATES_MONTH = 'Dates read month first: 01/03/2027 is January 3.';
const AMOUNTS_COMMA = 'Amounts read with a decimal comma: 12.280 is twelve thousand two hundred eighty.';
const AMOUNTS_DOT = 'Amounts read with a decimal dot: 12,280 is twelve thousand two hundred eighty.';

const report = (over: Record<string, unknown> = {}) => ({
  ok: true,
  notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA },
  fileErrors: [],
  headerErrors: [],
  errors: [],
  errorCount: 0,
  missing: [],
  deleted: [],
  deletedCount: 0,
  changes: { created: 0, updated: 1, unchanged: 2, createdLines: [], updatedLines: [{ line: 2, itemNumber: 'OPX-4', fields: ['budget_2026'] }] },
  changedSinceExport: [{ line: 2, itemNumber: 'OPX-4', by: 'Ada', at: '2026-03-01T14:02:00.000Z', message: 'OPX-4 was changed by Ada at 14:02.' }],
  changedSinceExportCount: 1,
  warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [] },
  creates: { dimensionValues: [], suppliers: [] },
  supplierMessage: null,
  snapshot: { lines: [{ id: 'line-1' }] },
  ...over,
});

function renderDialog(props: { canCreateSuppliers?: boolean; onImported?: () => void; scope?: 'opex' | 'capex' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <ThemeProvider theme={createAppTheme('dark')}>
      <QueryClientProvider client={client}>
        <BudgetFileImportDialog
          open
          onClose={() => undefined}
          scope={props.scope ?? 'opex'}
          canCreateSuppliers={props.canCreateSuppliers ?? true}
          onImported={props.onImported}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['item_number\n'], 'opex.csv', { type: 'text/csv' })] } });
  return view;
}

const lastCall = () => post.mock.calls[post.mock.calls.length - 1];
const lastParams = () => lastCall()?.[2]?.params;

describe('BudgetFileImportDialog', () => {
  beforeEach(() => post.mockReset());

  it.each(['opex', 'capex'] as const)('titles the dialog for budget lines of both types when the list is on %s', async (scope) => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog({ scope });
    expect(await screen.findByText('budget.importTitle')).toBeInTheDocument();
    expect(screen.queryByText(/^(opex|capex)\.importTitle$/)).not.toBeInTheDocument();
  });

  it('checks the file in the screen language and shows the notices and who changed a line', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.datesDayFirst')).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.amountsComma')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.readMonthFirst' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.readDecimalDot' })).toBeInTheDocument();
    const changed = screen.getByText(/operations.budgetFile.changedByAt/);
    expect(changed.textContent).toContain(formatShortDateTime('2026-03-01T14:02:00.000Z', 'fr'));
    expect(changed.textContent).toContain('Ada');
    expect(post).toHaveBeenCalledWith('/spend-items/budget-file/preflight', expect.any(FormData), {
      params: { language: 'fr', createSuppliers: 'false' },
    });
  });

  it('checks again with the other date order when the switch is used', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_MONTH, amounts: AMOUNTS_COMMA } }) });
    fireEvent.click(await screen.findByRole('button', { name: 'operations.budgetFile.readMonthFirst' }));
    expect(await screen.findByRole('button', { name: 'operations.budgetFile.readDayFirst' })).toBeInTheDocument();
    expect(lastCall()?.[0]).toBe('/spend-items/budget-file/preflight');
    expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'false', dateOrder: 'month-first', decimalMark: 'comma' });
  });

  it('switches the decimal mark while keeping the screen language and date order', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_DOT } }) });
    fireEvent.click(await screen.findByRole('button', { name: 'operations.budgetFile.readDecimalDot' }));
    expect(await screen.findByText('operations.budgetFile.amountsDot')).toBeInTheDocument();
    expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'false', dateOrder: 'day-first', decimalMark: 'dot' });
  });

  it('pins the amount reading selected by the export hint for import without switching', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: null, amounts: AMOUNTS_DOT } }) });
    renderDialog();
    await screen.findByText('operations.budgetFile.ready');
    expect(post).toHaveBeenCalledTimes(1);
    expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'false' });
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 0, updated: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    await screen.findByText(/operations.budgetFile.loaded/);
    expect(lastCall()?.[0]).toBe('/spend-items/budget-file/import');
    expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'false', decimalMark: 'dot' });
  });

  it('loads with the explicitly switched amount reading', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    await screen.findByText('operations.budgetFile.ready');
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_DOT } }) });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.readDecimalDot' }));
    await screen.findByText('operations.budgetFile.amountsDot');
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 0, updated: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    await screen.findByText(/operations.budgetFile.loaded/);
    expect(lastCall()?.[0]).toBe('/spend-items/budget-file/import');
    expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'false', dateOrder: 'day-first', decimalMark: 'dot' });
  });

  it('switches from decimal dot back to comma without changing the screen language', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: null, amounts: AMOUNTS_DOT } }) });
    renderDialog();
    post.mockResolvedValueOnce({ data: report({ notices: { dates: null, amounts: AMOUNTS_COMMA } }) });
    fireEvent.click(await screen.findByRole('button', { name: 'operations.budgetFile.readDecimalComma' }));
    await screen.findByText('operations.budgetFile.amountsComma');
    expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'false', decimalMark: 'comma' });
  });

  it('shows evidence against the amount switch as a blocking file error', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    const message = 'This file shows amounts with a decimal comma (12,5). The decimal mark cannot be switched.';
    post.mockResolvedValueOnce({ data: report({ ok: false, notices: { dates: null, amounts: null }, fileErrors: [message] }) });
    fireEvent.click(await screen.findByRole('button', { name: 'operations.budgetFile.readDecimalDot' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.load' })).toBeDisabled();
  });

  it('offers Create missing suppliers only to users who may create them, and sends it', async () => {
    post.mockResolvedValue({ data: report() });
    const { unmount } = renderDialog({ canCreateSuppliers: false });
    await screen.findByText('operations.budgetFile.datesDayFirst');
    expect(screen.queryByText('operations.budgetFile.createSuppliers')).toBeNull();
    unmount();

    renderDialog({ canCreateSuppliers: true });
    await screen.findByText('operations.budgetFile.datesDayFirst');
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'true', decimalMark: 'comma' }));
  });

  it('says what is missing in the screen language and shows an old file as one sentence', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        notices: { dates: null, amounts: null },
        missing: [{ type: 'costCenters', count: 3, examples: ['A1', 'A2'], where: 'Master data > Cost centers', message: 'raw' }],
        supplierMessage: '2 suppliers do not exist. Create them in Master data > Suppliers, or tick Create missing suppliers.',
      }),
    });
    const { unmount } = renderDialog();
    expect(await screen.findByText(/operations.budgetFile.missing.costCenters/)).toBeInTheDocument();
    expect(screen.getByText(/"examples":"A1, A2 operations.budgetFile.andMoreInline/)).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.suppliersMissing:{"count":2}')).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.notReady')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.load' })).toBeDisabled();
    unmount();

    post.mockResolvedValueOnce({ data: report({ ok: false, notices: { dates: null, amounts: null }, fileErrors: [OLD_LAYOUT_SENTENCE] }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.oldLayout')).toBeInTheDocument();
    expect(screen.queryByText(OLD_LAYOUT_SENTENCE)).toBeNull();
  });

  it('shows a workbook refusal in the screen language', async () => {
    const sentence = Object.keys(DECODE_SENTENCE_CODES).find((text) => DECODE_SENTENCE_CODES[text] === 'CSV_FILE_EXCEL')!;
    post.mockResolvedValueOnce({ data: report({ ok: false, notices: { dates: null, amounts: null }, fileErrors: [sentence] }) });
    renderDialog();
    expect(await screen.findByText(/^errors:CSV_FILE_EXCEL/)).toBeInTheDocument();
    expect(screen.queryByText(sentence)).toBeNull();
  });

  it('shows an empty file in the screen language', async () => {
    post.mockResolvedValueOnce({ data: report({ ok: false, notices: { dates: null, amounts: null }, fileErrors: ['The file is empty.'] }) });
    renderDialog();
    expect(await screen.findByText(/^errors:CSV_FILE_EMPTY/)).toBeInTheDocument();
    expect(screen.queryByText('The file is empty.')).toBeNull();
  });

  it('shows a file without a budget header in the screen language', async () => {
    const sentence = Object.keys(DECODE_SENTENCE_CODES).find((text) => DECODE_SENTENCE_CODES[text] === 'CSV_HEADER_NOT_BUDGET_FILE')!;
    post.mockResolvedValueOnce({ data: report({ ok: false, notices: { dates: null, amounts: null }, headerErrors: [sentence] }) });
    renderDialog();
    expect(await screen.findByText(/^errors:CSV_HEADER_NOT_BUDGET_FILE/)).toBeInTheDocument();
    expect(screen.queryByText(sentence)).toBeNull();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.load' })).toBeDisabled();
  });

  it('takes CSV and Excel files and sends an Excel file as it is', async () => {
    post.mockResolvedValue({ data: report() });
    renderDialog();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept.split(',')).toEqual(expect.arrayContaining(['.csv', '.xlsx']));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const workbook = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'budget.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(input, { target: { files: [workbook] } });
    await waitFor(() => expect((lastCall()?.[1] as FormData).get('file')).toBe(workbook));
  });

  it('takes CSV files only while the server reads no workbook', () => {
    features.importXlsx = false;
    try {
      renderDialog();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toBe('.csv,text/csv');
    } finally {
      features.importXlsx = true;
    }
  });

  it('says when only the first sheet of a workbook was read', async () => {
    post.mockResolvedValueOnce({ data: report({ firstSheetOnly: 'OPEX' }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.firstSheetOnly:{"name":"OPEX"}')).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.warningsTitle')).toBeInTheDocument();
  });

  it('shows an Excel file it cannot read in the screen language', async () => {
    const codes = ['XLSX_OLD_FORMAT', 'XLSX_NOT_WORKBOOK', 'XLSX_INVALID', 'XLSX_DOCTYPE', 'XLSX_NO_SHEET'];
    const sentences = codes.map((code) => Object.keys(DECODE_SENTENCE_CODES).find((text) => DECODE_SENTENCE_CODES[text] === code)!);
    expect(sentences.every(Boolean)).toBe(true);
    const tooLarge = 'This file is too large to read: the sheet has more than 5,000,000 cells.';
    post.mockResolvedValueOnce({ data: report({ ok: false, notices: { dates: null, amounts: null }, fileErrors: [...sentences, tooLarge] }) });
    renderDialog();
    for (const code of [...codes, 'XLSX_TOO_LARGE']) expect(await screen.findByText(new RegExp(`^errors:${code}`))).toBeInTheDocument();
    for (const text of [...sentences, tooLarge]) expect(screen.queryByText(text)).toBeNull();
  });

  it('loads with the snapshot of the check and shows the result', async () => {
    const onImported = vi.fn();
    post.mockResolvedValueOnce({ data: report() });
    renderDialog({ onImported });
    await screen.findByText('operations.budgetFile.ready');
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 0, updated: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    expect(await screen.findByText(/operations.budgetFile.loaded/)).toBeInTheDocument();
    const [url, body, config] = lastCall();
    expect(url).toBe('/spend-items/budget-file/import');
    expect((body as FormData).get('snapshot')).toBe(JSON.stringify({ lines: [{ id: 'line-1' }] }));
    expect(config).toEqual({ params: { language: 'fr', createSuppliers: 'false', decimalMark: 'comma' } });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'operations.budgetFile.done' })).toBeEnabled();
  });

  it('refreshes both lists after a load: a file may hold lines of both natures', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    await screen.findByText('operations.budgetFile.ready');
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 1, updated: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    await screen.findByText(/operations.budgetFile.loaded/);
    const keys = invalidate.mock.calls.map(([filters]) => (filters as { queryKey?: unknown[] } | undefined)?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(['spend-items-summary', 'capex-items-summary']));
    invalidate.mockRestore();
  });

  it('lists the cells the load ignores among the warnings, by line and column', async () => {
    const message = 'description is ignored on a CAPEX line. Leave the cell empty.';
    post.mockResolvedValueOnce({ data: report({ warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [{ line: 3, column: 'description', message }] } }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.warningsTitle')).toBeInTheDocument();
    expect(screen.getByText(`operations.budgetFile.rowColumn:${JSON.stringify({ line: 3, column: 'description', message })}`)).toBeInTheDocument();
  });

  it("warns, by its translation code, about a company other than the cost center's", async () => {
    const warning = {
      line: 4, code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY', costCenter: 'IT-100', company: 'Globex', costCenterCompany: 'Acme',
      message: 'Cost center IT-100 belongs to Acme. The line is paid by Globex.',
    };
    post.mockResolvedValueOnce({ data: report({ warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [], costCenterCompanies: [warning] } }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.warningsTitle')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^operations\\.budgetFile\\.rowColumn:.*"line":4,"column":"company_name".*errors:BUDGET_FILE_COST_CENTER_OTHER_COMPANY`))).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.ready')).toBeInTheDocument();
  });

  it.each([
    [1, '70000.00', '70\u202f000,00'],
    [3, '281280.00', '281\u202f280,00'],
  ])('warns that %i calculation line(s) will no longer drive a changed column, with their total', async (count, total, shown) => {
    const warning = {
      line: 2, item: 'BL-83', column: 'revision', year: 2026, count, total,
      message: `BL-83 · Revision 2026: ${count} calculation lines (${total}) will no longer drive these amounts.`,
    };
    post.mockResolvedValueOnce({ data: report({ warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [], calculationLines: [warning] } }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.warningsTitle')).toBeInTheDocument();
    const options = { item: 'BL-83', column: 'ops:operations.budgetColumns.revision', year: 2026, count, total: shown, defaultValue: warning.message };
    const text = screen.getByText(/^operations\.budgetFile\.calculationLines:/).textContent ?? '';
    expect(JSON.parse(text.slice('operations.budgetFile.calculationLines:'.length))).toEqual(options);
    expect(screen.getByText('operations.budgetFile.ready')).toBeInTheDocument();
  });

  it('says how many calculation lines warnings the list leaves out', async () => {
    const calculationLines = Array.from({ length: 20 }, (_, index) => ({
      line: index + 2, item: `BL-${index + 1}`, column: 'budget', year: 2026, count: 2, total: '100.00',
      message: `BL-${index + 1} · Budget 2026: 2 calculation lines (100.00) will no longer drive these amounts.`,
    }));
    post.mockResolvedValueOnce({ data: report({
      warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [], calculationLines, calculationLinesCount: 23 },
    }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.warningsTitle')).toBeInTheDocument();
    expect(screen.getAllByText(/^operations\.budgetFile\.calculationLines:/)).toHaveLength(20);
    expect(screen.getByText('operations.budgetFile.andMore:{"count":3}')).toBeInTheDocument();
  });

  it('turns a stale check into a plain sentence with a way to check again', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    await screen.findByText('operations.budgetFile.ready');
    post.mockRejectedValueOnce({ response: { status: 409, data: { message: STALE_SENTENCE }, headers: {} } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    expect(await screen.findByText('operations.budgetFile.stale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.load' })).toBeDisabled();
    post.mockResolvedValueOnce({ data: report() });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.checkAgain' }));
    await waitFor(() => expect(lastCall()?.[0]).toBe('/spend-items/budget-file/preflight'));
    await waitFor(() => expect(screen.queryByText('operations.budgetFile.stale')).toBeNull());
  });

  it('turns operation_running, a busy answer and an oversized file into plain sentences', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    await screen.findByText('operations.budgetFile.ready');

    post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'operation_running', message: 'raw' }, headers: {} } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    expect(await screen.findByText('operations.budgetFile.running')).toBeInTheDocument();
    expect(screen.queryByText('raw')).toBeNull();

    post.mockRejectedValueOnce({ response: { status: 503, data: { code: 'busy', message: 'raw' }, headers: { 'retry-after': '4' } } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.tryAgain' }));
    expect(await screen.findByText('operations.budgetFile.busyAfter:{"count":4}')).toBeInTheDocument();
    expect(lastCall()?.[0]).toBe('/spend-items/budget-file/import');

    post.mockRejectedValueOnce({ response: { status: 413, data: { message: 'raw' }, headers: {} } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.readMonthFirst' }));
    expect(await screen.findByText('operations.budgetFile.tooLarge')).toBeInTheDocument();
  });

  it('lists the lines refused for the access among the other errors, in the screen language', async () => {
    post.mockResolvedValueOnce({ data: report({
      ok: false,
      dataAccessLimited: true,
      errors: [
        { line: 2, column: 'item_number', message: 'BL-4 is read only in your access.' },
        { line: 3, column: 'cost_center_code', message: 'This company or cost center is not part of your access.' },
        { line: 4, column: 'item_number', message: 'OPX-12 is no longer available since the export.' },
        { line: 5, column: 'supplier_name', message: "Supplier 'Initech' does not exist." },
      ],
      errorCount: 4,
    }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.notReady')).toBeInTheDocument();
    const rows = screen.getAllByText(/^operations\.budgetFile\.rowColumn:/).map((node) => node.textContent);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('errors:dataAccess.readOnlyRef');
    expect(rows[0]).toContain('\\"ref\\":\\"BL-4\\"');
    expect(rows[1]).toContain('errors:dataAccess.placement');
    expect(rows[2]).toContain('errors:dataAccess.noLongerAvailable');
    expect(rows[3]).toContain("Supplier 'Initech' does not exist.");
    // One table of errors: no section of its own for the access.
    expect(screen.getAllByText('operations.budgetFile.errorsTitle')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'operations.budgetFile.load' })).toBeDisabled();
  });

  it('tells the dimension values the load will create from those it refuses', async () => {
    post.mockResolvedValueOnce({ data: report({
      ok: false,
      dataAccessLimited: true,
      errors: [{ line: 3, column: 'analytics_nature', message: "Value 'Gifts' is not in the list of nature. Pick an existing value." }],
      errorCount: 1,
      creates: {
        dimensionValues: [{ dimension: 'Project code', names: ['P-77'] }],
        refusedDimensionValues: [{ dimension: 'Nature', names: ['Gifts'] }],
        suppliers: [],
      },
    }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.createsTitle')).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.dimensionValuesCreated:{"dimension":"Project code","names":"P-77"}')).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.dimensionValuesRefused:{"dimension":"Nature","names":"Gifts"}')).toBeInTheDocument();
  });

  it('keeps the plain list of values to create for a person with access to all data', async () => {
    post.mockResolvedValueOnce({ data: report({ creates: { dimensionValues: [{ dimension: 'Nature', names: ['Gifts'] }], suppliers: [] } }) });
    renderDialog();
    expect(await screen.findByText('operations.budgetFile.dimensionValues:{"dimension":"Nature","names":"Gifts"}')).toBeInTheDocument();
    expect(screen.queryByText(/dimensionValuesRefused/)).toBeNull();
    expect(screen.queryByText(/dimensionValuesCreated/)).toBeNull();
  });

  it('goes back to the check after a 409, and loads again once the new check is ready', async () => {
    post.mockResolvedValueOnce({ data: report({ dataAccessLimited: true }) });
    renderDialog();
    await screen.findByText('operations.budgetFile.ready');
    post.mockRejectedValueOnce({ response: { status: 409, data: { message: STALE_SENTENCE }, headers: {} } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    expect(await screen.findByText('operations.budgetFile.stale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.load' })).toBeDisabled();
    post.mockResolvedValueOnce({ data: report({ dataAccessLimited: true, snapshot: { lines: [{ id: 'line-1', v: 2 }] } }) });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.checkAgain' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'operations.budgetFile.load' })).toBeEnabled());
    expect(lastCall()?.[0]).toBe('/spend-items/budget-file/preflight');
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 0, updated: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.load' }));
    expect(await screen.findByText(/operations.budgetFile.loaded/)).toBeInTheDocument();
    expect((lastCall()?.[1] as FormData).get('snapshot')).toBe(JSON.stringify({ lines: [{ id: 'line-1', v: 2 }] }));
  });

  it('shows a refusal for the access in its own words, not as missing rights', async () => {
    post.mockRejectedValueOnce({ response: { status: 403, data: { code: 'DATA_ACCESS_LIMITED', message: 'This action is reserved to people with access to all data.' }, headers: {} } });
    renderDialog();
    expect(await screen.findByText(/^errors:dataAccess\.reserved/)).toBeInTheDocument();
    expect(screen.queryByText('operations.budgetFile.forbidden')).toBeNull();
  });
});
