import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiImportRun, AiMutationPreview } from '../aiTypes';
import PreviewCard from './PreviewCard';

vi.mock('../../components/csv/serverExport', () => ({ downloadServerExport: vi.fn(async () => undefined) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

// Q1 of 26.11.9: the check of a row import names, under its counts, the records it updates (the line of
// the person's file, the reference linked to the record's page, then the name), as the budget file does.

type RowsReport = Extract<AiImportRun['report'], { kind: 'rows' }>;

function card(importKey: string, counts: { updated: number; unchanged: number }, report: Partial<RowsReport> = {}): AiMutationPreview {
  return {
    preview_id: 'preview-1',
    tool_name: 'prepare_import_mapping',
    status: 'pending',
    target: { entity_type: 'imports', entity_id: null, ref: null, title: 'Projects · projets.xlsx' },
    changes: {},
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Import projets.xlsx into the projects.',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-11-20T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    import_mapping: {
      import_key: importKey,
      filename: 'projets.xlsx',
      row_count: counts.updated + counts.unchanged,
      columns: [],
      missing_required: [],
      unplaced: [],
      assumptions: [],
      sample: { columns: [], rows: [] },
      rows_missing_required: 0,
      validation: {
        ok: true, dry_run: true, total: counts.updated + counts.unchanged, inserted: 0, ...counts, skipped: 0, error_count: 0, warning_count: 0,
        report: { kind: 'rows', errors: [], warnings: [], ...report },
      },
    },
  } as AiMutationPreview;
}

function renderCard(preview: AiMutationPreview) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <PreviewCard preview={preview} onApprove={() => undefined} onReject={() => undefined} onReplace={vi.fn()} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('PreviewCard, the records a row import updates', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('lists each update under the counts: its line, the reference linked to the record, then the name', () => {
    renderCard(card('portfolio_projects', { updated: 1, unchanged: 4 }, {
      updates: [{ row: 6, ref: 'PRJ-4', name: 'Wi-Fi des entrepôts' }], updatesTotal: 1,
    }));
    expect(screen.getByText(/1 to update · 4 unchanged/)).toBeInTheDocument();
    const line = screen.getByText((_, element) => element?.tagName === 'LI' && element.textContent === 'Row 6: PRJ-4 · Wi-Fi des entrepôts');
    const link = screen.getByRole('link', { name: 'PRJ-4' });
    expect(line).toContainElement(link);
    expect(link).toHaveAttribute('href', '/portfolio/projects/PRJ-4');
  });

  it('names a record without a reference by its name, and counts the updates beyond the first ten', () => {
    const updates = Array.from({ length: 12 }, (_, index) => ({ row: index + 2, ref: null, name: `Centre ${index + 1}` }));
    renderCard(card('cost_centers', { updated: 14, unchanged: 0 }, { updates, updatesTotal: 14 }));
    expect(screen.getByText((_, element) => element?.tagName === 'LI' && element.textContent === 'Row 2: Centre 1')).toBeInTheDocument();
    expect(screen.queryByText(/Centre 11/)).toBeNull();
    expect(screen.getByText('And 4 more.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('writes the line in the person\'s language', async () => {
    await i18n.changeLanguage('fr');
    renderCard(card('suppliers', { updated: 1, unchanged: 1 }, { updates: [{ row: 3, ref: 'SUP-2', name: 'Savencia' }], updatesTotal: 1 }));
    expect(screen.getByText((_, element) => element?.tagName === 'LI' && /^Ligne\s3\s: SUP-2 · Savencia$/.test(element.textContent ?? ''))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SUP-2' })).toHaveAttribute('href', '/master-data/suppliers/SUP-2');
  });

  it('lists nothing when the check updates nothing', () => {
    renderCard(card('portfolio_projects', { updated: 0, unchanged: 5 }));
    expect(screen.queryByText(/^Row \d+:/)).toBeNull();
  });
});
