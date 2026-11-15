import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiMutationPreview } from '../aiTypes';
import type { BudgetFileChoice, BudgetFileMatching } from '../../components/finance/budgetFile';
import PreviewCard from './PreviewCard';

vi.mock('../../components/csv/serverExport', () => ({ downloadServerExport: vi.fn(async () => undefined) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(async (url: string) => {
      if (url === '/analytics-axes') return { data: { items: [] } };
      if (url === '/budget-columns') return { data: (await import('../../services/budgetColumns')).DEFAULT_BUDGET_COLUMNS };
      throw new Error(`Unexpected request ${url}`);
    }),
  },
}));

import api from '../../api';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

const matching = (over: Partial<BudgetFileMatching> = {}): BudgetFileMatching => ({
  matches: [
    { column: 'analytics:it_tower', name: 'IT domain', value: 'Hardware', target: 'Matériel', origin: 'model', reason: 'model', lines: [2, 4], count: 2, undoable: true },
    { column: 'supplier_name', name: null, value: 'ACME corp.', target: 'Acme', origin: 'server', reason: 'accents', lines: [3], count: 1, undoable: true },
  ],
  refusedProposals: [],
  candidates: [],
  choices: [{ kind: 'create_suppliers', value: true }],
  createSuppliers: { allowed: true, value: true },
  ...over,
});

function card(over: { matching?: BudgetFileMatching; status?: AiMutationPreview['status']; id?: string; replaces?: string } = {}): AiMutationPreview {
  return {
    preview_id: over.id ?? 'preview-1',
    ...(over.replaces ? { replaces_preview_id: over.replaces } : {}),
    tool_name: 'prepare_import_mapping',
    status: over.status ?? 'pending',
    target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Budget lines · budget.xlsx' },
    changes: {},
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Import budget.xlsx into the budget lines.',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-11-15T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    import_mapping: {
      import_key: 'budget_lines',
      filename: 'budget.xlsx',
      row_count: 3,
      columns: [],
      missing_required: [],
      unplaced: [],
      assumptions: [],
      sample: { columns: [], rows: [] },
      rows_missing_required: 0,
      validation: {
        ok: true, dry_run: true, total: 3, inserted: 3, updated: 0, unchanged: 0, skipped: 0, error_count: 0, warning_count: 0,
        report: {
          kind: 'budget_file',
          file: {
            ok: true,
            notices: { dates: null, amounts: null },
            fileErrors: [],
            headerErrors: [],
            errors: [],
            errorCount: 0,
            missing: [],
            deleted: [],
            deletedCount: 0,
            changes: { created: 3, updated: 0, unchanged: 0, createdLines: [], updatedLines: [] },
            changedSinceExport: [],
            changedSinceExportCount: 0,
            warnings: { duplicates: [], ignoredColumns: [], supplierNames: [], ignoredCells: [] },
            creates: { dimensionValues: [], suppliers: [] },
            matching: over.matching ?? matching(),
            supplierMessage: null,
            snapshot: { lines: [] },
          },
        },
      },
    },
  };
}

function renderCard(preview: AiMutationPreview, onReplace = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <PreviewCard preview={preview} onApprove={() => undefined} onReject={() => undefined} onReplace={onReplace} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onReplace;
}

const ROUTE = '/ai/conversations/conv-1/previews/preview-1/import-choices';

describe('PreviewCard, the matches of a budget file', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('shows the matches folded, a proposal of Kad marked, the file lines in a tooltip', async () => {
    renderCard(card());
    const toggle = screen.getByRole('button', { name: /^2 values matched/ });
    fireEvent.click(toggle);
    const kadLine = screen.getByText('IT domain: Hardware → Matériel');
    expect(within(kadLine).getByLabelText('Proposed by Kad')).toBeInTheDocument();
    expect(screen.getByText('Supplier: ACME corp. → Acme')).toBeInTheDocument();
    fireEvent.mouseOver(kadLine);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Lines 2, 4');
  });

  it('undoes a match with the whole list, buttons off during the call, and puts the new card in its place', async () => {
    let answer: (value: unknown) => void = () => undefined;
    post.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const onReplace = renderCard(card());
    fireEvent.click(screen.getByRole('button', { name: /^2 values matched/ }));
    fireEvent.click(within(screen.getByText('IT domain: Hardware → Matériel').parentElement!).getByRole('button', { name: 'Undo' }));

    const sent: BudgetFileChoice[] = [
      { kind: 'create_suppliers', value: true },
      { kind: 'unmatch', column: 'analytics:it_tower', value: 'Hardware' },
    ];
    expect(post).toHaveBeenCalledWith(ROUTE, { choices: sent });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    for (const undo of screen.getAllByRole('button', { name: 'Undo' })) expect(undo).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Create missing suppliers' })).toBeDisabled();

    const next = card({ id: 'preview-2', replaces: 'preview-1', matching: matching({ choices: sent }) });
    answer({ data: next });
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ preview_id: 'preview-1' }), next));
  });

  it('takes a match back: Match again sends the list without its entry', async () => {
    post.mockResolvedValueOnce({ data: card({ id: 'preview-2', replaces: 'preview-1' }) });
    renderCard(card({
      matching: matching({
        matches: [],
        choices: [{ kind: 'unmatch', column: 'supplier_name', value: 'ACME corp.' }, { kind: 'create_suppliers', value: true }],
      }),
    }));
    expect(screen.queryByRole('button', { name: /values? matched/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Match again' }));
    expect(post).toHaveBeenCalledWith(ROUTE, { choices: [{ kind: 'create_suppliers', value: true }] });
  });

  it('shows the Create missing suppliers box from the server and sends its new value with the other choices', async () => {
    post.mockResolvedValueOnce({ data: card({ id: 'preview-2', replaces: 'preview-1' }) });
    renderCard(card({ matching: matching({ choices: [{ kind: 'unmatch', column: 'analytics:it_tower', value: 'Hardware' }, { kind: 'create_suppliers', value: true }] }) }));
    const box = screen.getByRole('checkbox', { name: 'Create missing suppliers' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(post).toHaveBeenCalledWith(ROUTE, {
      choices: [{ kind: 'unmatch', column: 'analytics:it_tower', value: 'Hardware' }, { kind: 'create_suppliers', value: false }],
    });
  });

  it('has no box when the person may not create suppliers, and nothing to change on an approved card', () => {
    renderCard(card({ matching: matching({ createSuppliers: { allowed: false, value: false } }) }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    cleanup();
    renderCard(card({ status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: /^2 values matched/ }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('lists the proposals of Kad the check refused', () => {
    renderCard(card({
      matching: matching({
        matches: [],
        refusedProposals: [
          { column: 'analytics:it_tower', name: 'IT domain', value: 'Cloud', target: 'Nuage', reason: 'missing', lines: [5], count: 1 },
          { column: 'analytics:it_tower', name: 'IT domain', value: 'Old', target: 'Ancien', reason: 'disabled', lines: [6], count: 1 },
        ],
      }),
    }));
    expect(screen.getByText('IT domain: Cloud → Nuage: no such value')).toBeInTheDocument();
    expect(screen.getByText('IT domain: Old → Ancien: disabled value')).toBeInTheDocument();
  });

  it('says to ask for a new card when the card can no longer be changed', async () => {
    post.mockRejectedValueOnce({ response: { status: 409, data: { message: 'This card can no longer be changed: ask for a new one.' } } });
    const onReplace = renderCard(card());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create missing suppliers' }));
    expect(await screen.findByText('This card can no longer be changed. Ask Kad for a new one.')).toBeInTheDocument();
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });
});
