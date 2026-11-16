import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiImportRun, AiMutationPreview } from '../aiTypes';
import type { CsvImportMatch, ImportLookalike, ImportLookalikes } from '../../components/csv/csv.types';
import PreviewCard from './PreviewCard';

vi.mock('../../components/csv/serverExport', () => ({ downloadServerExport: vi.fn(async () => undefined) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import api from '../../api';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// Lot I3 of 26.11.9, pass 3b: the card of an applications import shows the rows that look like an
// application the person reads, with the choices of the budget file's card; a choice sends the whole
// list of the card's choices and the new card takes its place.

type RowsReport = Extract<AiImportRun['report'], { kind: 'rows' }>;

const accents: ImportLookalike = {
  line: 3, name: 'Comptabilite', target: { id: 'app-4', ref: 'APP-4', name: 'Comptabilité', state: '2026-11-10T08:00:00.000Z' },
  reason: 'name_accents', outcome: 'ignored', updatable: true,
};
const close: ImportLookalike = {
  line: 5, name: 'Cegid XRP Flex', target: { id: 'app-7', ref: 'APP-7', name: 'Cegid XRP', state: '2026-11-11T09:30:00.000Z' },
  reason: 'close_name', outcome: 'ignored', updatable: true,
};

const lookalikes = (lines: ImportLookalike[], over: Partial<ImportLookalikes> = {}): ImportLookalikes => ({
  lines,
  targets: Object.fromEntries(lines.map((entry) => [String(entry.line), { id: entry.target.id, state: entry.target.state }])),
  count: lines.length,
  ignored: lines.filter((entry) => entry.outcome === 'ignored').length,
  created: lines.filter((entry) => entry.outcome === 'created').length,
  updated: lines.filter((entry) => entry.outcome === 'updated').length,
  ...over,
});

const editor: CsvImportMatch = {
  column: 'supplier_name', name: null, value: 'Cegid', target: 'Cegid', ref: 'SUP-4',
  origin: 'editor', reason: 'accents', lines: [5], count: 1, undoable: true,
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
    target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Applications · applications.xlsx' },
    changes: {},
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Import applications.xlsx into the applications.',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-11-16T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    import_mapping: {
      import_key: 'applications',
      filename: 'applications.xlsx',
      row_count: 4,
      columns: [column('name', 'Nom'), column('supplier_name', 'Fournisseur')],
      missing_required: [],
      unplaced: [],
      assumptions: [],
      sample: { columns: [], rows: [] },
      rows_missing_required: 0,
      validation: {
        ok: true, dry_run: true, total: 4, inserted: 2, updated: 0, unchanged: 0, skipped: 2, error_count: 0, warning_count: 0,
        report: { kind: 'rows', errors: [], warnings: [], lookalikes: lookalikes([accents, close]), ...report },
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
const ROW_3 = 'Line 3: Comptabilite → APP-4 Comptabilité';
const ROW_5 = 'Line 5: Cegid XRP Flex → APP-7 Cegid XRP';
const choice = (row: string, name: string) => within(screen.getByRole('group', { name: row })).getByRole('button', { name });

describe('PreviewCard, the rows of an applications import that look like an existing application', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('lists each row with the application it looks like, by its reference and name, its reason in a tooltip', async () => {
    renderCard(card());
    expect(screen.getByText('Looks like an existing application')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'APP-4' })).toHaveAttribute('href', '/it/applications/APP-4');
    fireEvent.mouseOver(screen.getByRole('group', { name: ROW_3 }).parentElement!.previousSibling as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Same name, accents aside');
  });

  it('says the reasons in French', async () => {
    await i18n.changeLanguage('fr');
    renderCard(card());
    const row = screen.getByRole('group', { name: /^Ligne 5/ });
    fireEvent.mouseOver(row.parentElement!.previousSibling as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nom proche, même fournisseur ou éditeur');
  });

  it('sends a row created anyway with the matches undone on the card, and puts the new card in its place', async () => {
    const next = card({}, { id: 'preview-2' });
    post.mockResolvedValueOnce({ data: next });
    const onReplace = renderCard(card({ undone: [{ column: 'supplier_name', value: 'Cegid' }] }));
    fireEvent.click(choice(ROW_3, 'Create anyway'));
    expect(post).toHaveBeenCalledWith(ROUTE, {
      choices: [
        { kind: 'unmatch', column: 'supplier_name', value: 'Cegid' },
        { kind: 'lookalike', line: 3, action: 'create' },
      ],
    });
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ preview_id: 'preview-1' }), next));
  });

  it('sends the whole list of the card: a row the check created anyway, and a row updated by its id and state', () => {
    post.mockResolvedValueOnce({ data: card({}, { id: 'preview-2' }) });
    renderCard(card({ lookalikes: lookalikes([{ ...accents, outcome: 'created' }, close]) }));
    fireEvent.click(choice(ROW_5, 'Update APP-7'));
    expect(post).toHaveBeenCalledWith(ROUTE, {
      choices: [
        { kind: 'lookalike', line: 3, action: 'create' },
        { kind: 'lookalike', line: 5, action: 'update', id: 'app-7', state: '2026-11-11T09:30:00.000Z' },
      ],
    });
  });

  it('keeps the rows\' choices when a match is undone, and keeps a choice for all rows beyond the rows listed', () => {
    post.mockResolvedValueOnce({ data: card({}, { id: 'preview-2' }) });
    // 250 rows created anyway: the 2 listed, and 248 beyond the list.
    const all = lookalikes([{ ...accents, outcome: 'created' }, { ...close, outcome: 'ignored' }], { count: 250, created: 249, ignored: 1 });
    renderCard(card({ matches: [editor], matchesTotal: 1, lookalikes: all }));
    fireEvent.click(screen.getByRole('button', { name: /^1 value matched/ }));
    fireEvent.click(within(screen.getByText(/Cegid → SUP-4/).parentElement!).getByRole('button', { name: 'Undo' }));
    expect(post).toHaveBeenCalledWith(ROUTE, {
      choices: [
        { kind: 'lookalikes', action: 'create', targets: all.targets },
        { kind: 'lookalike', line: 5, action: 'ignore' },
        { kind: 'unmatch', column: 'supplier_name', value: 'Cegid' },
      ],
    });
  });

  it('shows what became of each row, with no choice, on an approved card', () => {
    renderCard(card({ lookalikes: lookalikes([{ ...accents, outcome: 'created' }]) }, { status: 'approved' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByText((content) => content.includes('Created anyway'))).toBeInTheDocument();
  });
});
