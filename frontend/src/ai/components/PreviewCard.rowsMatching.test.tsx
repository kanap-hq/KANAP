import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiImportRun, AiMutationPreview } from '../aiTypes';
import type { CsvImportMatch } from '../../components/csv/csv.types';
import PreviewCard from './PreviewCard';

vi.mock('../../components/csv/serverExport', () => ({ downloadServerExport: vi.fn(async () => undefined) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import api from '../../api';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// Lot I3 of 26.11.9, fifth pass: the card of a row import (here contracts) shows its matches as the
// budget file's card does, and the person undoes them from it.

type RowsReport = Extract<AiImportRun['report'], { kind: 'rows' }>;

const accents: CsvImportMatch = {
  column: 'supplier_name', name: null, value: 'Societe Generale', target: 'Société Générale', ref: 'SUP-3',
  origin: 'server', reason: 'accents', lines: [2, 4], count: 2, undoable: true,
};
const byKad: CsvImportMatch = {
  column: 'company_name', name: null, value: 'FPS', target: 'Fromage SA', ref: 'COMP-1',
  origin: 'model', reason: 'model', lines: [3], count: 1, undoable: true,
};

function card(report: Partial<RowsReport> = {}, over: { status?: AiMutationPreview['status']; id?: string } = {}): AiMutationPreview {
  const column = (name: string, title: string) => ({
    column: name, title, required: false, kind: 'reference', source: null, value: null, confidence: 'high' as const,
    filled: 3, unread: 0, read_as: null, note: null,
  });
  return {
    preview_id: over.id ?? 'preview-1',
    tool_name: 'prepare_import_mapping',
    status: over.status ?? 'pending',
    target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Contracts · contrats.xlsx' },
    changes: {},
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Import contrats.xlsx into the contracts.',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-11-16T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    import_mapping: {
      import_key: 'contracts',
      filename: 'contrats.xlsx',
      row_count: 3,
      columns: [column('supplier_name', 'Fournisseur du contrat'), column('company_name', 'Société du contrat')],
      missing_required: [],
      unplaced: [],
      assumptions: [],
      sample: { columns: [], rows: [] },
      rows_missing_required: 0,
      validation: {
        ok: true, dry_run: true, total: 3, inserted: 3, updated: 0, unchanged: 0, skipped: 0, error_count: 0, warning_count: 0,
        report: {
          kind: 'rows',
          errors: [],
          warnings: [],
          matches: [accents, byKad],
          matchesTotal: 2,
          refusedProposals: [{ column: 'supplier_name', name: null, value: 'IBM', target: 'International Business Machines', reason: 'missing', lines: [5], count: 1 }],
          refusedProposalsTotal: 1,
          ...report,
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

describe('PreviewCard, the matches of a contracts import', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('shows the matches folded, each column by its title and each record with its reference, a proposal of Kad marked', async () => {
    renderCard(card());
    fireEvent.click(screen.getByRole('button', { name: /^2 values matched/ }));
    const server = screen.getByText('Fournisseur du contrat: Societe Generale → SUP-3 Société Générale');
    expect(within(server).queryByLabelText('Proposed by Kad')).toBeNull();
    const kad = screen.getByText('Société du contrat: FPS → COMP-1 Fromage SA');
    expect(within(kad).getByLabelText('Proposed by Kad')).toBeInTheDocument();
    fireEvent.mouseOver(server);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Lines 2, 4');
  });

  it('lists a proposal of Kad the check refused', () => {
    renderCard(card());
    expect(screen.getByText('Fournisseur du contrat: IBM → International Business Machines: no such value')).toBeInTheDocument();
  });

  it('undoes a match with the whole list of the matches undone on the card, and puts the new card in its place', async () => {
    const next = card({ matches: [byKad], matchesTotal: 1 }, { id: 'preview-2' });
    post.mockResolvedValueOnce({ data: next });
    const onReplace = renderCard(card({ undone: [{ column: 'cost_center', value: 'Informatique' }] }));
    fireEvent.click(screen.getByRole('button', { name: /^2 values matched/ }));
    fireEvent.click(within(screen.getByText(/Societe Generale → SUP-3/).parentElement!).getByRole('button', { name: 'Undo' }));
    expect(post).toHaveBeenCalledWith(ROUTE, {
      choices: [
        { kind: 'unmatch', column: 'cost_center', value: 'Informatique' },
        { kind: 'unmatch', column: 'supplier_name', value: 'Societe Generale' },
      ],
    });
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ preview_id: 'preview-1' }), next));
  });

  it('offers no Undo for a match the card cannot undo, nor on an approved card', () => {
    renderCard(card({ matches: [{ ...accents, undoable: false }], matchesTotal: 1 }));
    fireEvent.click(screen.getByRole('button', { name: /^1 value matched/ }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    cleanup();
    renderCard(card({}, { status: 'approved' }));
    fireEvent.click(screen.getByRole('button', { name: /^2 values matched/ }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('keeps a match undone on the card listed with Match again, even with no match left, and sends the list without it', async () => {
    post.mockResolvedValueOnce({ data: card({}, { id: 'preview-2' }) });
    const onReplace = renderCard(card({
      matches: undefined,
      matchesTotal: undefined,
      refusedProposals: undefined,
      refusedProposalsTotal: undefined,
      undone: [{ column: 'cost_center', value: 'Informatique' }, { column: 'supplier_name', value: 'Societe Generale' }],
    }));
    const undone = screen.getByText('Fournisseur du contrat: Societe Generale');
    fireEvent.click(within(undone.parentElement!).getByRole('button', { name: 'Match again' }));
    expect(post).toHaveBeenCalledWith(ROUTE, { choices: [{ kind: 'unmatch', column: 'cost_center', value: 'Informatique' }] });
    await waitFor(() => expect(onReplace).toHaveBeenCalled());
  });

  it('lists no Match again on an approved card', () => {
    renderCard(card({ undone: [{ column: 'supplier_name', value: 'Societe Generale' }] }, { status: 'approved' }));
    expect(screen.queryByRole('button', { name: 'Match again' })).toBeNull();
  });
});
