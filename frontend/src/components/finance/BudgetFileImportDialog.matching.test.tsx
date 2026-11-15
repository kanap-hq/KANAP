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
import type { BudgetFileChoice, BudgetFileMatching } from './budgetFile';
import BudgetFileImportDialog from './BudgetFileImportDialog';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const K = 'operations.budgetFile.';

const match = (over: Partial<BudgetFileMatching['matches'][number]> = {}): BudgetFileMatching['matches'][number] => ({
  column: 'analytics:it_tower',
  name: 'Domaine IT',
  value: 'Hardware',
  target: 'Matériel',
  origin: 'server',
  reason: 'translation',
  lines: [2, 5],
  count: 2,
  undoable: true,
  ...over,
});

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
  changes: { created: 2, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] },
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

describe('BudgetFileImportDialog, matching before creating', () => {
  beforeEach(() => post.mockReset());

  it('shows no matching line when the check matched nothing', async () => {
    post.mockResolvedValueOnce({ data: report() });
    renderDialog();
    await screen.findByText(`${K}ready`);
    expect(screen.queryByText(new RegExp(`^${K}matching\\.count`))).toBeNull();
  });

  it('counts the matches on one folded line, which unfolds into one line per match, a Kad proposal marked', async () => {
    post.mockResolvedValueOnce({
      data: report({
        matching: matching({
          matches: [
            match(),
            match({ column: 'supplier_name', name: null, value: 'ACME Corp', target: 'Acme', origin: 'model', reason: 'model', lines: [3], count: 1 }),
          ],
        }),
      }),
    });
    renderDialog();
    const toggle = await screen.findByRole('button', { name: new RegExp(`^${K}matching\\.count:\\{"count":2\\}`) });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Hardware/)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Named by the dimension's name and by the column's label, never by their codes.
    expect(screen.getByText(`${K}matching.match:${JSON.stringify({ dimension: 'Domaine IT', value: 'Hardware', target: 'Matériel' })}`)).toBeInTheDocument();
    const kadLine = screen.getByText(`${K}matching.match:${JSON.stringify({ dimension: 'opex.columns.supplier', value: 'ACME Corp', target: 'Acme' })}`);
    expect(within(kadLine).getByLabelText(`${K}matching.byKad`)).toBeInTheDocument();
    expect(screen.getAllByLabelText(`${K}matching.byKad`)).toHaveLength(1);
    expect(screen.queryByText(/it_tower|supplier_name/)).toBeNull();
  });

  it('undoes a match with the whole list of choices, and loads with the same list as the check shown', async () => {
    post.mockResolvedValueOnce({ data: report({ matching: matching({ matches: [match()] }) }) });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${K}matching\\.count`) }));
    expect(sentChoices(post.mock.calls[0])).toBeNull();

    const undone: BudgetFileChoice[] = [{ kind: 'unmatch', column: 'analytics:it_tower', value: 'Hardware' }];
    post.mockResolvedValueOnce({
      data: report({
        creates: { dimensionValues: [{ dimension: 'it_tower', name: 'Domaine IT', names: ['Hardware'] }], suppliers: [] },
        matching: matching({ choices: undone }),
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: `${K}matching.undo` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][0]).toBe('/spend-items/budget-file/preflight');
    expect(sentChoices(post.mock.calls[1])).toEqual(undone);
    // Never in the address.
    expect(JSON.stringify(post.mock.calls[1][2])).not.toContain('unmatch');

    // The value undone is now among the values created, with Match again.
    expect(await screen.findByRole('button', { name: `${K}matching.redo` })).toBeInTheDocument();
    post.mockResolvedValueOnce({ data: { ok: true, dryRun: false, inserted: 2, updated: 0 } });
    fireEvent.click(screen.getByRole('button', { name: `${K}load` }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][0]).toBe('/spend-items/budget-file/import');
    expect(sentChoices(post.mock.calls[2])).toEqual(undone);
  });

  it('matches again a value undone: the entry leaves the list', async () => {
    post.mockResolvedValueOnce({
      data: report({
        creates: { dimensionValues: [{ dimension: 'it_tower', name: 'Domaine IT', names: ['Hardware', 'Cloud'] }], suppliers: [] },
        matching: matching({ choices: [{ kind: 'unmatch', column: 'analytics:it_tower', value: 'Hardware' }] }),
      }),
    });
    renderDialog();
    const redo = await screen.findByRole('button', { name: `${K}matching.redo` });
    // The value undone has its own line; the others stay on the dimension's line.
    expect(screen.getByText(`${K}dimensionValues:${JSON.stringify({ dimension: 'Domaine IT', names: 'Hardware' })}`)).toBeInTheDocument();
    expect(screen.getByText(`${K}dimensionValues:${JSON.stringify({ dimension: 'Domaine IT', names: 'Cloud' })}`)).toBeInTheDocument();

    post.mockResolvedValueOnce({ data: report({ matching: matching({ matches: [match()] }) }) });
    fireEvent.click(redo);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(sentChoices(post.mock.calls[1]) ?? []).toEqual([]);
  });

  it('names each dimension of the values to create by its name, the unnamed default one by its label', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        errors: [{ line: 4, column: 'analytics:purpose', message: 'Value not allowed', code: 'X', params: {} }],
        errorCount: 1,
        creates: {
          dimensionValues: [
            { dimension: 'it_tower', name: 'Domaine IT', names: ['Réseau'] },
            { dimension: 'default', name: null, names: ['Logiciels'] },
          ],
          refusedDimensionValues: [{ dimension: 'purpose', names: ['Autre'] }],
          suppliers: [],
        },
      }),
    });
    renderDialog();
    await screen.findByText(`${K}notReady`);
    expect(screen.getByText(new RegExp(`dimensionValuesCreated:\\{"dimension":"Domaine IT"`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`dimensionValuesCreated:\\{"dimension":"master-data:analytics.analyticsCategoryFallback"`))).toBeInTheDocument();
    // A dimension the report does not name takes the tenant's name for it, in the refusals and in the errors.
    expect(await screen.findByText(new RegExp(`dimensionValuesRefused:\\{"dimension":"Motif"`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`rowColumn:\\{"line":4,"column":"Motif"`))).toBeInTheDocument();
    expect(screen.queryByText(/"(it_tower|default|purpose|analytics:purpose)"/)).toBeNull();
  });

  it('gives the closest names of a value to create in a tooltip, and of an unknown company under its error', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        errors: [{ line: 6, column: 'company_name', message: "Company 'Fromage SA' was not found.", code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Fromage SA' } }],
        errorCount: 1,
        creates: { dimensionValues: [{ dimension: 'it_tower', name: 'Domaine IT', names: ['Hardwar'] }], suppliers: [] },
        matching: matching({
          candidates: [
            { column: 'analytics:it_tower', name: 'Domaine IT', value: 'Hardwar', outcome: 'create', lines: [3], count: 1, candidates: [{ name: 'Hardware', score: 0.9 }, { name: 'Software', score: 0.6 }] },
            { column: 'company_name', name: null, value: 'Fromage SA', outcome: 'refused', lines: [6], count: 1, candidates: [{ name: 'Fromage & Co SA', score: 0.8 }] },
          ],
        }),
      }),
    });
    renderDialog();
    expect(await screen.findByText(`${K}matching.closeTo:${JSON.stringify({ names: 'Fromage & Co SA' })}`)).toBeInTheDocument();
    // No permanent text for the value to create: the tooltip says it.
    expect(screen.queryByText(new RegExp(`closeTo:\\{"names":"Hardware, Software"`))).toBeNull();
    fireEvent.mouseOver(screen.getByText('Hardwar'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`${K}matching.closeTo:${JSON.stringify({ names: 'Hardware, Software' })}`);
  });
});
