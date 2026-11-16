import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { CsvImportMatch, CsvImportResult, ImportLookalike, ImportLookalikes } from './csv.types';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { importXlsx: false } }, isLoading: false }) }));

import api from '../../api';
import CsvImportDialogV2 from './CsvImportDialogV2';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// Lot I3 of 26.11.9, pass 3b: the import dialog of the applications shows, under the matches, the
// rows that look like an existing application. A choice checks the file again with the `lookalikes`
// form field; the load sends the same choices; a new file starts with none.

const accents: ImportLookalike = {
  line: 3, name: 'Comptabilite', target: { id: 'app-4', ref: 'APP-4', name: 'Comptabilité', state: 's4' },
  reason: 'name_accents', outcome: 'ignored', updatable: true,
};
const close: ImportLookalike = {
  line: 4, name: 'Cegid XRP Flex', target: { id: 'app-7', ref: 'APP-7', name: 'Cegid XRP', state: 's7' },
  reason: 'close_name', outcome: 'ignored', updatable: true,
};
const lookalikes = (lines: ImportLookalike[]): ImportLookalikes => ({
  lines,
  targets: Object.fromEntries(lines.map((entry) => [String(entry.line), { id: entry.target.id, state: entry.target.state }])),
  count: lines.length,
  ignored: lines.filter((entry) => entry.outcome === 'ignored').length,
  created: lines.filter((entry) => entry.outcome === 'created').length,
  updated: lines.filter((entry) => entry.outcome === 'updated').length,
});
const match: CsvImportMatch = {
  column: 'supplier_name', name: null, value: 'Cegid', target: 'Cegid', ref: 'SUP-4',
  origin: 'editor', reason: 'accents', lines: [4], count: 1, undoable: true,
};

const result = (over: Partial<CsvImportResult> = {}): CsvImportResult => ({
  ok: true, dryRun: true, total: 3, inserted: 1, updated: 0, skipped: 2, errors: [], warnings: [],
  matches: [match], matchesTotal: 1, lookalikes: lookalikes([accents, close]),
  ...over,
});

/** A form field of a call, read back as JSON (null when absent). */
function fieldOf(call: unknown[], name: string): unknown {
  const raw = (call[1] as FormData).get(name);
  return raw === null ? null : JSON.parse(String(raw));
}

function pickFile(name = 'applications.csv') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['name'], name, { type: 'text/csv' })] } });
}

function renderDialog() {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <CsvImportDialogV2 open onClose={() => undefined} endpoint="/applications" />
    </ThemeProvider>,
  );
  pickFile();
}

const ROW_3 = 'Line 3: Comptabilite → APP-4 Comptabilité';
const ROW_4 = 'Line 4: Cegid XRP Flex → APP-7 Cegid XRP';
const choice = (row: string, name: string) => within(screen.getByRole('group', { name: row })).getByRole('button', { name });

describe('CsvImportDialogV2, the rows that look like an existing application', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('shows them under the matches once the file is checked', async () => {
    post.mockResolvedValueOnce({ data: result() });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    const title = await screen.findByText('Looks like an existing application');
    const toggle = screen.getByRole('button', { name: /^1 value matched/ });
    expect(toggle.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('group', { name: ROW_3 })).toBeInTheDocument();
    expect(fieldOf(post.mock.calls[0], 'lookalikes')).toBeNull();
  });

  it('checks the file again with each choice, then loads with the same choices and the matches undone', async () => {
    post
      .mockResolvedValueOnce({ data: result() })
      .mockResolvedValueOnce({ data: result({ lookalikes: lookalikes([{ ...accents, outcome: 'created' }, close]) }) })
      .mockResolvedValueOnce({ data: result({ matches: undefined, matchesTotal: undefined, lookalikes: lookalikes([{ ...accents, outcome: 'created' }, { ...close, outcome: 'updated', fields: [] }]) }) })
      .mockResolvedValueOnce({ data: result({ dryRun: false, matches: undefined, matchesTotal: undefined, lookalikes: undefined }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await waitFor(() => choice(ROW_3, 'Create anyway')));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][2]).toEqual({ params: expect.objectContaining({ dryRun: true }) });
    const created = [{ kind: 'lookalike', line: 3, action: 'create' }];
    expect(fieldOf(post.mock.calls[1], 'lookalikes')).toEqual(created);
    // Undo a match: the rows keep their choices.
    fireEvent.click(await screen.findByRole('button', { name: /^1 value matched/ }));
    fireEvent.click(within(screen.getByText(/Cegid → SUP-4/).parentElement!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(fieldOf(post.mock.calls[2], 'lookalikes')).toEqual(created);
    expect(fieldOf(post.mock.calls[2], 'unmatched')).toEqual([{ column: 'supplier_name', value: 'Cegid' }]);
    await screen.findByText('Nothing changes on APP-7');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(4));
    expect(post.mock.calls[3][2]).toEqual({ params: expect.objectContaining({ dryRun: false }) });
    expect(fieldOf(post.mock.calls[3], 'lookalikes')).toEqual(created);
    expect(fieldOf(post.mock.calls[3], 'unmatched')).toEqual([{ column: 'supplier_name', value: 'Cegid' }]);
  });

  it('sends a row updated by its id and the state of the check', async () => {
    post.mockResolvedValueOnce({ data: result() }).mockResolvedValueOnce({ data: result() });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await waitFor(() => choice(ROW_4, 'Update APP-7')));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(fieldOf(post.mock.calls[1], 'lookalikes')).toEqual([{ kind: 'lookalike', line: 4, action: 'update', id: 'app-7', state: 's7' }]);
  });

  it('starts a new file with no choice', async () => {
    post.mockResolvedValueOnce({ data: result() }).mockResolvedValueOnce({ data: result() }).mockResolvedValueOnce({ data: result() });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await waitFor(() => choice(ROW_3, 'Create anyway')));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await screen.findByRole('group', { name: ROW_3 });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    pickFile('other.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(fieldOf(post.mock.calls[2], 'lookalikes')).toBeNull();
  });
});
