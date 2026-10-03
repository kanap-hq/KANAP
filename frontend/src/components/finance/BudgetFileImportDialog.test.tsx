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

vi.mock('../../api', () => ({ default: { post: vi.fn() } }));

import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import { formatShortDateTime } from '../../lib/dateFormat';
import { OLD_LAYOUT_SENTENCE, STALE_SENTENCE } from './budgetFile';
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
  warnings: { duplicates: [], ignoredColumns: [], supplierNames: [] },
  creates: { dimensionValues: [], suppliers: [] },
  supplierMessage: null,
  snapshot: { lines: [{ id: 'line-1' }] },
  ...over,
});

function renderDialog(props: { canCreateSuppliers?: boolean; onImported?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <ThemeProvider theme={createAppTheme('dark')}>
      <QueryClientProvider client={client}>
        <BudgetFileImportDialog
          open
          onClose={() => undefined}
          scope="opex"
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
    expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'false', dateOrder: 'month-first' });
  });

  it('reads amounts with a decimal point through an English reading, keeping the date order', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_DOT } }) });
    fireEvent.click(await screen.findByRole('button', { name: 'operations.budgetFile.readDecimalDot' }));
    expect(await screen.findByText('operations.budgetFile.amountsDot')).toBeInTheDocument();
    expect(lastParams()).toEqual({ language: 'en', createSuppliers: 'false', dateOrder: 'day-first' });
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
    await waitFor(() => expect(lastParams()).toEqual({ language: 'fr', createSuppliers: 'true' }));
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
    expect(config).toEqual({ params: { language: 'fr', createSuppliers: 'false' } });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'operations.budgetFile.done' })).toBeEnabled();
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
});
