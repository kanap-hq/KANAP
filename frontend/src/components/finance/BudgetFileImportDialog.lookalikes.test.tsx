import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    get: vi.fn(async (url: string) => {
      // The tenant's dimensions: the default one has no name.
      if (url === '/analytics-axes') {
        return {
          data: {
            items: [
              { id: 'ax-0', code: 'default', name: null, sort_order: 0, status: 'enabled', disabled_at: null, applies_to: null, required: false },
              { id: 'ax-1', code: 'purpose', name: 'Motif', sort_order: 1, status: 'enabled', disabled_at: null, applies_to: null, required: false },
            ],
          },
        };
      }
      return { data: (await import('../../services/budgetColumns')).DEFAULT_BUDGET_COLUMNS };
    }),
  },
}));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { importXlsx: true } }, isLoading: false }) }));

import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import type { BudgetFileChoice, BudgetFileMatching, BudgetFileReport } from './budgetFile';
import BudgetFileImportDialog from './BudgetFileImportDialog';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const K = 'operations.budgetFile.';

const matching = (over: Partial<BudgetFileMatching> = {}): BudgetFileMatching => ({
  matches: [],
  refusedProposals: [],
  candidates: [],
  choices: [],
  createSuppliers: { allowed: true, value: false },
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  ok: true,
  notices: { dates: null, amounts: null },
  fileErrors: [],
  headerErrors: [],
  errors: [],
  errorCount: 0,
  missing: [],
  deleted: [],
  deletedCount: 0,
  changes: { created: 2, updated: 0, unchanged: 0, createdLines: [{ line: 90, name: 'Licences' }, { line: 91, name: 'Support' }], updatedLines: [] },
  changedSinceExport: [],
  changedSinceExportCount: 0,
  warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [] },
  creates: { dimensionValues: [], suppliers: [] },
  matching: matching(),
  supplierMessage: null,
  snapshot: { lines: [] },
  ...over,
});

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <BudgetFileImportDialog open onClose={() => undefined} scope="opex" canCreateSuppliers />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['item_number\n'], 'opex.csv', { type: 'text/csv' })] } });
}

/** The `choices` form field of a call, read back as JSON (absent: no choice). */
const sentChoices = (call: unknown[]): BudgetFileChoice[] | null => {
  const body = call[1] as FormData;
  const value = body.get('choices');
  return value == null ? null : JSON.parse(String(value)) as BudgetFileChoice[];
};

type Look = NonNullable<BudgetFileReport['lookalikes']>['lines'][number];
const L = `${K}lookalikes.`;
const look = (line: number, item: number, over: Partial<Look> = {}): Look => ({
  line,
  nature: 'opex',
  name: `Hosting ${line}`,
  target: { item, ref: `BL-${item}`, name: `AWS hosting ${item}`, state: `s${item}` },
  reason: 'amounts',
  outcome: 'ignored',
  updatable: true,
  ...over,
});
const lookalikes = (lines: Look[], over: Partial<NonNullable<BudgetFileReport['lookalikes']>> = {}) => ({
  lines,
  targets: Object.fromEntries(lines.map((entry) => [String(entry.line), { item: entry.target.item, state: entry.target.state }])),
  count: lines.length,
  ignored: lines.filter((entry) => entry.outcome === 'ignored').length,
  created: lines.filter((entry) => entry.outcome === 'created').length,
  updated: lines.filter((entry) => entry.outcome === 'updated').length,
  ...over,
});
/** The paragraph of a lookalike's row, by its line in the file. */
const rowOf = (line: number) => screen.getByText((_, element) => element?.tagName === 'P'
  && (element.textContent ?? '').startsWith(`${L}row:{"line":${line},`));
const button = (name: string) => screen.queryByRole('button', { name });

describe('BudgetFileImportDialog, rows that look like an existing line', () => {
  beforeEach(() => post.mockReset());

  it('lists each row with its reason in a tooltip, what becomes of it, its reference as a link, and the counts', async () => {
    post.mockResolvedValueOnce({ data: report({ changes: { created: 0, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] }, lookalikes: lookalikes([look(5, 12, { reason: 'title_supplier' })]) }) });
    renderDialog();
    expect(await screen.findByText(`${L}title`)).toBeInTheDocument();
    expect(screen.getByText(`${L}counts:${JSON.stringify({ ignored: 1, created: 0, updated: 0 })}`)).toBeInTheDocument();
    const row = rowOf(5);
    expect(row).toHaveTextContent(`· ${L}outcomeIgnored`);
    expect(within(row).getByRole('link', { name: 'BL-12' })).toHaveAttribute('href', '/ops/budget/BL-12');
    fireEvent.mouseOver(row);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`${L}reasonTitleSupplier`);
    // Left out by default: the other two choices, and nothing to load.
    expect(button(`${L}ignore`)).toBeNull();
    expect(button(`${L}create`)).toBeInTheDocument();
    expect(button(`${L}update:{"ref":"BL-12"}`)).toBeInTheDocument();
    expect(screen.getByText(`${K}nothingToChange`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${K}load` })).toBeDisabled();
  });

  it('sends a row created anyway, then updated, with the whole list of choices, and loads with it', async () => {
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes([look(5, 12), look(6, 13)]) }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    post.mockResolvedValueOnce({ data: report({
      lookalikes: lookalikes([look(5, 12, { outcome: 'created' }), look(6, 13)]),
      matching: matching({ choices: [{ kind: 'lookalike', line: 5, action: 'create' }] }),
    }) });
    fireEvent.click(within(rowOf(5).parentElement!).getByRole('button', { name: `${L}create` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(sentChoices(post.mock.calls[1])).toEqual([{ kind: 'lookalike', line: 5, action: 'create' }]);

    await waitFor(() => expect(rowOf(5)).toHaveTextContent(`· ${L}outcomeCreated`));
    post.mockResolvedValueOnce({ data: report({
      lookalikes: lookalikes([look(5, 12, { outcome: 'created' }), look(6, 13, { outcome: 'updated', fields: ['company_name', 'budget 2026'] })]),
      matching: matching({ choices: [{ kind: 'lookalike', line: 5, action: 'create' }, { kind: 'lookalike', line: 6, action: 'update', item: 13, state: 's13' }] }),
    }) });
    fireEvent.click(within(rowOf(6).parentElement!).getByRole('button', { name: `${L}update:{"ref":"BL-13"}` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    const both: BudgetFileChoice[] = [
      { kind: 'lookalike', line: 5, action: 'create' },
      { kind: 'lookalike', line: 6, action: 'update', item: 13, state: 's13' },
    ];
    expect(sentChoices(post.mock.calls[2])).toEqual(both);
    // An update says what it changes, by the column's name.
    await waitFor(() => expect(rowOf(6)).toHaveTextContent(`${L}outcomeUpdated:{"ref":"BL-13"}`));
    fireEvent.mouseOver(rowOf(6));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`${L}fields:{"fields":"opex.columns.payingCompany, ops:operations.budgetColumns.budget 2026"}`);

    // Leave out, with no choice for all rows: the row's choice leaves the list.
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes([look(5, 12), look(6, 13, { outcome: 'updated' })]), matching: matching({ choices: [both[1]] }) }) });
    fireEvent.click(within(rowOf(5).parentElement!).getByRole('button', { name: `${L}ignore` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(4));
    expect(sentChoices(post.mock.calls[3])).toEqual([both[1]]);

    await waitFor(() => expect(rowOf(5)).toHaveTextContent(`· ${L}outcomeIgnored`));
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 0, updated: 1, skipped: 1 } });
    fireEvent.click(screen.getByRole('button', { name: `${K}load` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(5));
    expect(post.mock.calls[4][0]).toBe('/spend-items/budget-file/import');
    expect(sentChoices(post.mock.calls[4])).toEqual([both[1]]);
    // After the load: how many rows were left out.
    expect(await screen.findByText(`${L}skipped:{"count":1}`)).toBeInTheDocument();
  });

  it('creates all anyway, updates all with the state of each updatable line, and a row keeps its own choice', async () => {
    const rows = [look(3, 21), look(4, 22, { updatable: false }), look(5, 23)];
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes(rows) }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    expect(button(`${L}ignoreAll`)).toBeNull();

    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes(rows) }) });
    fireEvent.click(screen.getByRole('button', { name: `${L}updateAll` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    // Every row's target as the check gave it; the server leaves line 22, which cannot be updated, out.
    const targets = { 3: { item: 21, state: 's21' }, 4: { item: 22, state: 's22' }, 5: { item: 23, state: 's23' } };
    expect(sentChoices(post.mock.calls[1])).toEqual([{ kind: 'lookalikes', action: 'update', targets }]);

    // All created anyway, line 3 left out by its own choice.
    post.mockResolvedValueOnce({ data: report({
      lookalikes: lookalikes([look(3, 21), look(4, 22, { updatable: false, outcome: 'created' }), look(5, 23, { outcome: 'created' })]),
      matching: matching({ choices: [{ kind: 'lookalike', line: 3, action: 'ignore' }, { kind: 'lookalikes', action: 'create' }] }),
    }) });
    fireEvent.click(await screen.findByRole('button', { name: `${L}createAll` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(sentChoices(post.mock.calls[2])).toEqual([{ kind: 'lookalikes', action: 'create', targets }]);

    // With a choice for all rows: Leave all out, and a row's Leave out is sent to override it.
    await screen.findByRole('button', { name: `${L}ignoreAll` });
    expect(button(`${L}createAll`)).toBeNull();
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes(rows) }) });
    fireEvent.click(within(rowOf(5).parentElement!).getByRole('button', { name: `${L}ignore` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(4));
    expect(sentChoices(post.mock.calls[3])).toEqual([
      { kind: 'lookalike', line: 3, action: 'ignore' },
      { kind: 'lookalikes', action: 'create' },
      { kind: 'lookalike', line: 5, action: 'ignore' },
    ]);
  });

  it('updates all the rows, beyond the 200 listed, with the targets the check gave', async () => {
    const listed = Array.from({ length: 200 }, (_, index) => look(index + 2, index + 100));
    const targets = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [String(index + 2), { item: index + 100, state: `s${index + 100}` }]));
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes(listed, { count: 250, ignored: 250, targets }) }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes(listed, { count: 250, targets }) }) });
    fireEvent.click(screen.getByRole('button', { name: `${L}updateAll` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const sent = sentChoices(post.mock.calls[1])!;
    expect(sent).toHaveLength(1);
    expect(sent[0].kind === 'lookalikes' && Object.keys(sent[0].targets ?? {})).toHaveLength(250);
  });

  it('leaves all out, the rows\' own choices included', async () => {
    const rows = [look(3, 21, { outcome: 'created' }), look(4, 22, { outcome: 'updated' }), look(5, 23)];
    const kept = { kind: 'unmatch' as const, column: 'supplier_name', value: 'Acme' };
    post.mockResolvedValueOnce({ data: report({
      lookalikes: lookalikes(rows),
      matching: matching({ choices: [
        kept,
        { kind: 'lookalike', line: 3, action: 'create' },
        { kind: 'lookalike', line: 4, action: 'update', item: 22, state: 's22' },
        { kind: 'lookalikes', action: 'ignore', targets: { 3: { item: 21, state: 's21' } } },
      ] }),
    }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes([look(3, 21), look(4, 22), look(5, 23)]) }) });
    fireEvent.click(screen.getByRole('button', { name: `${L}ignoreAll` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(sentChoices(post.mock.calls[1])).toEqual([kept, { kind: 'lookalikes', action: 'ignore', targets: lookalikes(rows).targets }]);
    // Nothing chosen any more: no "Leave all out".
    await waitFor(() => expect(button(`${L}ignoreAll`)).toBeNull());
  });

  it('loads with the choices of the check shown, the targets of the rows it left out included', async () => {
    const memory: BudgetFileChoice = { kind: 'lookalikes', action: 'ignore', targets: { 5: { item: 12, state: 's12' } } };
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes([look(5, 12)]), matching: matching({ choices: [memory] }) }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 2, updated: 0, skipped: 1 } });
    fireEvent.click(screen.getByRole('button', { name: `${K}load` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][0]).toBe('/spend-items/budget-file/import');
    expect(sentChoices(post.mock.calls[1])).toEqual([memory]);
  });

  it('names every field an update may change, amounts by their column and year or month', async () => {
    const fields = [
      'nature', 'name', 'description', 'company_name', 'supplier', 'account_number', 'cost_center_code', 'run_build',
      'owner_it_email', 'owner_business_email', 'project', 'currency', 'effective_start', 'end_of_validity', 'notes',
      'analytics:purpose', 'budget 2026', 'revision 2026', 'forecast 2026', 'actual 2026', 'landing 2026', 'budget 2026-01',
    ];
    post.mockResolvedValueOnce({ data: report({
      changes: { created: 0, updated: 1, unchanged: 0, createdLines: [], updatedLines: [{ line: 6, itemNumber: 'BL-13', fields }] },
      lookalikes: lookalikes([look(6, 13, { outcome: 'updated', fields })]),
    }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    const updated = await screen.findByText(new RegExp(`^${K.replace(/\./g, '\\.')}updatedLine`));
    const named = JSON.parse(updated.textContent!.slice(`${K}updatedLine:`.length)).fields as string;
    const names = named.split(', ');
    expect(names).toHaveLength(fields.length);
    // No server identifier left: every name is a label of the screen.
    for (const [index, name] of names.entries()) expect(name, fields[index]).not.toBe(fields[index]);
    expect(names[fields.indexOf('supplier')]).toBe('opex.columns.supplier');
    expect(names[fields.indexOf('analytics:purpose')]).toBe('Motif');
    expect(names.slice(-6)).toEqual([
      expect.stringMatching(/ 2026$/), expect.stringMatching(/ 2026$/), expect.stringMatching(/ 2026$/),
      expect.stringMatching(/ 2026$/), expect.stringMatching(/ 2026$/), expect.stringMatching(/ janv\. 2026$/),
    ]);
    fireEvent.mouseOver(rowOf(6));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(named);
  });

  it('offers no Update for a line the person may not change, nor Update all when none can be', async () => {
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes([look(4, 22, { updatable: false })]) }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    expect(within(rowOf(4).parentElement!).getByRole('button', { name: `${L}create` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lookalikes\.update/ })).toBeNull();
    expect(button(`${L}updateAll`)).toBeNull();
    expect(button(`${L}createAll`)).toBeInTheDocument();
  });

  it('shows a line changed since the check as the error it is, and offers to update it again', async () => {
    post.mockResolvedValueOnce({ data: report({
      ok: false,
      errors: [{ line: 6, column: null, message: 'BL-13 changed since the check.', code: 'BUDGET_FILE_LOOKALIKE_CHANGED', params: { ref: 'BL-13' } }],
      errorCount: 1,
      lookalikes: lookalikes([look(6, 13, { outcome: 'updated', target: { item: 13, ref: 'BL-13', name: 'AWS hosting 13', state: 's13b' } })]),
      matching: matching({ choices: [{ kind: 'lookalike', line: 6, action: 'update', item: 13, state: 's13' }] }),
    }) });
    renderDialog();
    expect(await screen.findByText(`${K}row:{"line":6,"message":"errors:BUDGET_FILE_LOOKALIKE_CHANGED:{\\"ref\\":\\"BL-13\\",\\"defaultValue\\":\\"BL-13 changed since the check.\\"}"}`)).toBeInTheDocument();
    expect(rowOf(6)).toHaveStyle({ color: createAppTheme('light').palette.kanap.danger });
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes([look(6, 13, { outcome: 'updated' })]) }) });
    fireEvent.click(within(rowOf(6).parentElement!).getByRole('button', { name: `${L}update:{"ref":"BL-13"}` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(sentChoices(post.mock.calls[1])).toEqual([{ kind: 'lookalike', line: 6, action: 'update', item: 13, state: 's13b' }]);
  });

  it('shows the first ten rows, the others on a click', async () => {
    const rows = Array.from({ length: 14 }, (_, index) => look(index + 2, index + 40));
    post.mockResolvedValueOnce({ data: report({ lookalikes: lookalikes(rows, { count: 16 }) }) });
    renderDialog();
    await screen.findByText(`${L}title`);
    expect(screen.getAllByRole('link', { name: /^BL-/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: `${K}andMoreInline:{"count":6}` }));
    expect(screen.getAllByRole('link', { name: /^BL-/ })).toHaveLength(14);
    expect(screen.getByText(`${K}andMore:{"count":2}`)).toBeInTheDocument();
  });

  it('shows the consistency warnings among the warnings, by line', async () => {
    post.mockResolvedValueOnce({ data: report({
      warnings: {
        duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [],
        consistency: [{ line: 7, message: 'Budget 2026: 120 000, against 12 000 on BL-4.', code: 'BUDGET_FILE_AMOUNT_FAR_FROM_LINE', params: { ref: 'BL-4' } }],
        consistencyCount: 3,
      },
    }) });
    renderDialog();
    expect(await screen.findByText(`${K}warningsTitle`)).toBeInTheDocument();
    expect(screen.getByText(/^operations\.budgetFile\.row:\{"line":7,"message":"errors:BUDGET_FILE_AMOUNT_FAR_FROM_LINE/)).toBeInTheDocument();
    expect(screen.getByText(`${K}andMore:{"count":2}`)).toBeInTheDocument();
  });

  it('writes the days of a consistency warning in the screen\'s language', async () => {
    post.mockResolvedValueOnce({ data: report({
      warnings: {
        duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [],
        consistency: [{ line: 4, message: 'The line ends on 2025-06-30, before its first amounts (2026).', code: 'BUDGET_FILE_END_BEFORE_AMOUNTS', params: { end: '2025-06-30', year: 2026 } }],
        consistencyCount: 1,
      },
    }) });
    renderDialog();
    const warning = await screen.findByText(/BUDGET_FILE_END_BEFORE_AMOUNTS/);
    expect(warning.textContent).toContain('30 juin 2025');
    expect(warning.textContent).not.toContain('2025-06-30\\"');
  });
});
