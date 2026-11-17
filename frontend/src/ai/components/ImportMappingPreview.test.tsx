import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiImportChoice, AiImportMapping } from '../aiTypes';
import type { BudgetFileChoice, BudgetFileReport } from '../../components/finance/budgetFile';
import ImportMappingPreview from './ImportMappingPreview';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => { throw new Error('no request in this test'); }) } }));

type Look = NonNullable<BudgetFileReport['lookalikes']>['lines'][number];
const look = (line: number, item: number, over: Partial<Look> = {}): Look => ({
  line,
  nature: 'opex',
  name: `Hébergement ${line}`,
  target: { item, ref: `BL-${item}`, name: `Hébergement AWS ${item}`, state: `s${item}` },
  reason: 'amounts',
  outcome: 'ignored',
  updatable: true,
  ...over,
});

const column = (name: string, kind: string) => ({
  column: name, title: name, required: false, kind, source: { position: 1, header: name }, value: null, confidence: 'high' as const, filled: 1, unread: 0, read_as: null, note: null,
});

function mapping(lines: Look[], choices: BudgetFileChoice[] = [], over: Partial<AiImportMapping> = {}): AiImportMapping {
  const targets = Object.fromEntries(lines.map((entry) => [String(entry.line), { item: entry.target.item, state: entry.target.state }]));
  return {
    import_key: 'budget_lines',
    filename: 'budget.xlsx',
    row_count: lines.length,
    columns: [column('nature', 'text'), column('name', 'text'), column('budget_2026', 'number')],
    unread_values: {},
    read_errors: {},
    missing_required: [],
    unplaced: [],
    assumptions: [],
    sample: { columns: ['nature', 'name', 'budget_2026'], rows: [['opex', 'Hébergement', '52000']], unread: [[false, false, false]] },
    rows_missing_required: 0,
    validation: {
      ok: true, dry_run: true, total: lines.length, inserted: 0, updated: 0, unchanged: 0, skipped: lines.length, error_count: 0, warning_count: 0, issues: [],
      report: {
        kind: 'budget_file',
        file: {
          ok: true, notices: {}, fileErrors: [], headerErrors: [], errors: [], errorCount: 0, missing: [], deleted: [], deletedCount: 0,
          changes: { created: 0, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] },
          changedSinceExport: [], changedSinceExportCount: 0,
          warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [] },
          lookalikes: {
            lines,
            targets,
            count: lines.length,
            ignored: lines.filter((entry) => entry.outcome === 'ignored').length,
            created: lines.filter((entry) => entry.outcome === 'created').length,
            updated: lines.filter((entry) => entry.outcome === 'updated').length,
          },
          creates: { dimensionValues: [], suppliers: [] },
          matching: { matches: [], refusedProposals: [], candidates: [], choices, createSuppliers: { allowed: false, value: false } },
          supplierMessage: null,
        } as any,
      },
    },
    ...over,
  } as AiImportMapping;
}

function renderPreview(value: AiImportMapping, onChoices?: (choices: AiImportChoice[]) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ImportMappingPreview mapping={value} onChoices={onChoices} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const rowOf = (line: number) => screen.getByText((_, element) => element?.tagName === 'P'
  && new RegExp(`^Ligne ${line}\\s:`).test(element.textContent ?? ''));

describe('ImportMappingPreview, a budget file in French', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
  });
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('writes the amounts of the first rows as the screen writes them', () => {
    renderPreview(mapping([]));
    const firstRows = screen.getByText('Premières lignes').parentElement!;
    const cells = Array.from(firstRows.querySelectorAll('td')).map((cell) => cell.textContent);
    expect(cells).toEqual(['opex', 'Hébergement', '52 000']);
  });

  it('marks the side of the columns a scroll hides', () => {
    const sizes = { scrollWidth: 2983, clientWidth: 425 };
    const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => sizes.scrollWidth);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => sizes.clientWidth);
    try {
      renderPreview(mapping([]));
      const firstRows = screen.getByText('Premières lignes').parentElement!;
      expect(within(firstRows).getByTestId('columns-hidden-right')).toBeInTheDocument();
      expect(within(firstRows).queryByTestId('columns-hidden-left')).not.toBeInTheDocument();
      const scroller = within(firstRows).getByRole('table').parentElement!;
      scroller.scrollLeft = 2983 - 425;
      fireEvent.scroll(scroller);
      expect(within(firstRows).getByTestId('columns-hidden-left')).toBeInTheDocument();
      expect(within(firstRows).queryByTestId('columns-hidden-right')).not.toBeInTheDocument();
    } finally {
      width.mockRestore();
      client.mockRestore();
    }
  });

  it('lists the lookalikes in the scroll of the panel, without a scroll of their own', () => {
    renderPreview(mapping(Array.from({ length: 9 }, (_, index) => look(index + 2, index + 101))));
    const section = screen.getByText('Ressemble à une ligne existante').closest('div')!;
    for (let element: HTMLElement | null = section; element; element = element.parentElement) {
      expect(getComputedStyle(element).overflowY).not.toBe('auto');
    }
  });

  it('sets every row with a choice for all, its own choice included; a row chosen after changes alone', () => {
    const rows = [look(3, 21, { outcome: 'created' }), look(4, 22, { updatable: false, outcome: 'created' }), look(5, 23)];
    const targets = { 3: { item: 21, state: 's21' }, 4: { item: 22, state: 's22' }, 5: { item: 23, state: 's23' } };
    const onChoices = vi.fn();
    const { unmount } = renderPreview(mapping(rows, [
      { kind: 'lookalike', line: 3, action: 'create' },
      { kind: 'lookalike', line: 4, action: 'create' },
      { kind: 'lookalikes', action: 'ignore', targets },
    ]), onChoices);
    fireEvent.click(screen.getByRole('button', { name: 'Tout mettre à jour' }));
    // Line 3's own choice gives way; line 4, which cannot be updated, keeps its state.
    expect(onChoices).toHaveBeenLastCalledWith([
      { kind: 'lookalike', line: 4, action: 'create' },
      { kind: 'lookalikes', action: 'update', targets },
    ]);
    unmount();

    const updated = [look(3, 21, { outcome: 'updated' }), look(4, 22, { updatable: false, outcome: 'created' }), look(5, 23, { outcome: 'updated' })];
    renderPreview(mapping(updated, [
      { kind: 'lookalike', line: 4, action: 'create' },
      { kind: 'lookalikes', action: 'update', targets },
    ]), onChoices);
    fireEvent.click(within(rowOf(5).parentElement!).getByRole('button', { name: 'Créer quand même' }));
    expect(onChoices).toHaveBeenLastCalledWith([
      { kind: 'lookalike', line: 4, action: 'create' },
      { kind: 'lookalikes', action: 'update', targets },
      { kind: 'lookalike', line: 5, action: 'create' },
    ]);
  });
});
