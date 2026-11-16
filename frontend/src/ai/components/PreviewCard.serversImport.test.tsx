import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

// Lot I3 of 26.11.9, merge of the fourth and fifth passes: the card of a servers import shows a
// version found in the catalog as a match the person undoes, and says in one line how each site
// the file names hosts its servers (T-I3f).

type RowsReport = Extract<AiImportRun['report'], { kind: 'rows' }>;

const version: CsvImportMatch = {
  column: 'operating_system', name: null, value: 'Ubuntu 22.04', target: 'Ubuntu 22.04 LTS', ref: null,
  origin: 'server', reason: 'version', lines: [2, 3], count: 2, undoable: true,
};
const hosting: NonNullable<RowsReport['hosting']> = [
  { ref: 'LOC-2', name: 'Datacenter Rennes', hostingType: 'on_prem', label: 'On-prem', category: 'on_prem', provider: null },
  { ref: 'LOC-5', name: 'AWS Paris', hostingType: 'public_cloud', label: 'Public cloud', category: 'cloud', provider: 'AWS' },
  { ref: 'LOC-7', name: 'Salle B', hostingType: 'room', label: 'Server room', category: null, provider: null },
];

function card(report: Partial<RowsReport> = {}, over: { status?: AiMutationPreview['status']; id?: string } = {}): AiMutationPreview {
  const column = (name: string, title: string) => ({
    column: name, title, required: false, kind: 'reference', source: null, value: null, confidence: 'high' as const,
    filled: 3, unread: 0, read_as: null, note: null,
  });
  return {
    preview_id: over.id ?? 'preview-1',
    tool_name: 'prepare_import_mapping',
    status: over.status ?? 'pending',
    target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Servers · serveurs.xlsx' },
    changes: {},
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Import serveurs.xlsx into the servers.',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-11-16T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    import_mapping: {
      import_key: 'assets',
      filename: 'serveurs.xlsx',
      row_count: 3,
      columns: [column('operating_system', 'Operating system'), column('location_reference', 'Location')],
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
          matches: [version],
          matchesTotal: 1,
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

describe('PreviewCard, a servers import', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('shows a version found in the catalog as a match, said in its tooltip, and undoes it', async () => {
    post.mockResolvedValueOnce({ data: card({ matches: [], matchesTotal: 0 }, { id: 'preview-2' }) });
    renderCard(card());
    fireEvent.click(screen.getByRole('button', { name: /^1 value matched/ }));
    const line = screen.getByText('Operating system: Ubuntu 22.04 → Ubuntu 22.04 LTS');
    fireEvent.mouseOver(line);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Catalog version');
    expect(tooltip).toHaveTextContent('Lines 2, 3');
    fireEvent.click(within(line.parentElement!).getByRole('button', { name: 'Undo' }));
    expect(post).toHaveBeenCalledWith(ROUTE, { choices: [{ kind: 'unmatch', column: 'operating_system', value: 'Ubuntu 22.04' }] });
  });

  it('says in one line how each site of the file hosts its servers', () => {
    renderCard(card({ hosting }));
    expect(screen.getByText('Hosting: LOC-2 Datacenter Rennes (on-prem); LOC-5 AWS Paris (cloud, AWS); LOC-7 Salle B (Server room)')).toBeInTheDocument();
  });

  it('says it in French with the spaces of French', async () => {
    await i18n.changeLanguage('fr');
    renderCard(card({ hosting: hosting.slice(0, 2) }));
    const text = 'Hébergement\u00a0: LOC-2 Datacenter Rennes (sur site)\u202f; LOC-5 AWS Paris (cloud, AWS)';
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text)).toBeInTheDocument();
  });

  it('says nothing of the hosting when the report has none', () => {
    renderCard(card());
    expect(screen.queryByText(/^Hosting:/)).toBeNull();
  });
});
