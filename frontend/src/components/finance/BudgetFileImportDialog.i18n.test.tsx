import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(async () => ({ data: (await import('../../services/budgetColumns')).DEFAULT_BUDGET_COLUMNS })),
  },
}));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { importXlsx: true } }, isLoading: false }) }));

import api from '../../api';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import BudgetFileImportDialog from './BudgetFileImportDialog';

// The warning of a changed column that follows its calculation lines, in the real locale texts:
// the count with the right plural, the column's name and the lines' total in the screen language.

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

const report = (count: number, total: string) => ({
  ok: true,
  notices: { dates: null, amounts: null },
  fileErrors: [],
  headerErrors: [],
  errors: [],
  errorCount: 0,
  missing: [],
  deleted: [],
  deletedCount: 0,
  changes: { created: 0, updated: 1, unchanged: 0, createdLines: [], updatedLines: [] },
  changedSinceExport: [],
  changedSinceExportCount: 0,
  warnings: {
    duplicates: [],
    ignoredColumns: [],
    supplierNames: [],
    ignoredCells: [],
    calculationLines: [{ line: 2, item: 'BL-83', column: 'revision', year: 2026, count, total, message: 'server sentence' }],
  },
  creates: { dimensionValues: [], suppliers: [] },
  supplierMessage: null,
  snapshot: { lines: [] },
});

async function warningIn(lng: string, count: number, total: string): Promise<string> {
  await i18n.changeLanguage(lng);
  post.mockResolvedValueOnce({ data: report(count, total) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={client}>
          <BudgetFileImportDialog open onClose={() => undefined} scope="opex" canCreateSuppliers />
        </QueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['item_number\n'], 'opex.csv', { type: 'text/csv' })] } });
  return (await screen.findByText(/^BL-83 · /)).textContent ?? '';
}

describe('BudgetFileImportDialog calculation lines warning', () => {
  beforeEach(() => post.mockReset());
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('says it in English, one line and several', async () => {
    expect(await warningIn('en', 3, '281280.00')).toBe('BL-83 · Revision 2026: 3 calculation lines (281,280.00) will no longer drive these amounts.');
  });

  it('says one line in English', async () => {
    expect(await warningIn('en', 1, '209280.00')).toBe('BL-83 · Revision 2026: 1 calculation line (209,280.00) will no longer drive these amounts.');
  });

  it('says it in French, with non-breaking spaces', async () => {
    expect(await warningIn('fr', 3, '281280.00'))
      .toBe('BL-83 · Révision 2026 : 3 lignes de calcul (281 280,00) ne piloteront plus ces montants.');
  });

  it('says one line in French', async () => {
    expect(await warningIn('fr', 1, '209280.00'))
      .toBe('BL-83 · Révision 2026 : 1 ligne de calcul (209 280,00) ne pilotera plus ces montants.');
  });
});
