import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { CsvImportMatch, CsvImportResult, ImportLookalike, ImportLookalikeChoice, ImportLookalikes } from './csv.types';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { importXlsx: false } }, isLoading: false }) }));

import api from '../../api';
import CsvImportDialogV2 from './CsvImportDialogV2';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// Lot I3 of 26.11.9, pass 3b: the import dialog of the applications shows, under the matches, the
// rows that look like an existing application. A choice checks the file again with the `lookalikes`
// form field; the load sends the same choices; a new file starts with none.

// The server's shape (pass 3a): ids, 16-character states, and the choices the check followed, the
// targets of the rows it left out included.
const ID_4 = '4b0e6a5c-3f1d-4c2b-9a8e-7d6f5e4c3b2a';
const ID_7 = '7c1f2e3d-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const accents: ImportLookalike = {
  line: 3, name: 'Comptabilite', target: { id: ID_4, ref: 'APP-4', name: 'Comptabilité', state: '0123456789abcdef' },
  reason: 'name_accents', outcome: 'ignored', updatable: true,
};
const close: ImportLookalike = {
  line: 4, name: 'Cegid XRP Flex', target: { id: ID_7, ref: 'APP-7', name: 'Cegid XRP', state: 'fedcba9876543210' },
  reason: 'close_name', outcome: 'ignored', updatable: true,
};
/** As the server gives them: the rows chosen, then the choice for all rows with every row's target. */
const lookalikes = (lines: ImportLookalike[], rowChoices: ImportLookalikeChoice[] = []): ImportLookalikes => {
  const targets = Object.fromEntries(lines.map((entry) => [String(entry.line), { id: entry.target.id, state: entry.target.state }]));
  return {
    lines,
    targets,
    count: lines.length,
    ignored: lines.filter((entry) => entry.outcome === 'ignored').length,
    created: lines.filter((entry) => entry.outcome === 'created').length,
    updated: lines.filter((entry) => entry.outcome === 'updated').length,
    choices: [...rowChoices, { kind: 'lookalikes', action: 'ignore', targets }],
  };
};
const match: CsvImportMatch = {
  column: 'supplier_name', name: null, value: 'Cegid', target: 'Cegid', ref: 'SUP-4',
  origin: 'editor', reason: 'editor', lines: [4], count: 1, undoable: true,
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

  it('checks the file again with each choice from the choices the check gave back, then loads with those of the check shown', async () => {
    const created: ImportLookalikeChoice = { kind: 'lookalike', line: 3, action: 'create' };
    const checked = lookalikes([{ ...accents, outcome: 'created' }, close], [created]);
    post
      .mockResolvedValueOnce({ data: result() })
      .mockResolvedValueOnce({ data: result({ lookalikes: checked }) })
      .mockResolvedValueOnce({ data: result({ matches: undefined, matchesTotal: undefined, lookalikes: checked }) })
      .mockResolvedValueOnce({ data: result({ dryRun: false, matches: undefined, matchesTotal: undefined, lookalikes: undefined }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await waitFor(() => choice(ROW_3, 'Create anyway')));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][2]).toEqual({ params: expect.objectContaining({ dryRun: true }) });
    // The first check's choices, the row's own choice added: the targets of the rows left out go with them.
    expect(fieldOf(post.mock.calls[1], 'lookalikes')).toEqual([...result().lookalikes!.choices, created]);
    // Undo a match: the rows keep the choices of the check shown.
    fireEvent.click(await screen.findByRole('button', { name: /^1 value matched/ }));
    fireEvent.click(within(screen.getByText(/Cegid → SUP-4/).parentElement!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(fieldOf(post.mock.calls[2], 'lookalikes')).toEqual(checked.choices);
    expect(fieldOf(post.mock.calls[2], 'unmatched')).toEqual([{ column: 'supplier_name', value: 'Cegid' }]);
    await screen.findByRole('group', { name: ROW_3 });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(4));
    expect(post.mock.calls[3][2]).toEqual({ params: expect.objectContaining({ dryRun: false }) });
    expect(fieldOf(post.mock.calls[3], 'lookalikes')).toEqual(checked.choices);
    expect(fieldOf(post.mock.calls[3], 'unmatched')).toEqual([{ column: 'supplier_name', value: 'Cegid' }]);
  });

  it('checks, updates APP-7, checks again, then loads with the choices the second check gave back, the row left out included', async () => {
    const update: ImportLookalikeChoice = { kind: 'lookalike', line: 4, action: 'update', id: ID_7, state: 'fedcba9876543210' };
    const second = lookalikes([accents, { ...close, outcome: 'updated', fields: ['supplier_name', 'editor'] }], [update]);
    post
      .mockResolvedValueOnce({ data: result() })
      .mockResolvedValueOnce({ data: result({ lookalikes: second }) })
      .mockResolvedValueOnce({ data: result({ dryRun: false, lookalikes: undefined }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await waitFor(() => choice(ROW_4, 'Update APP-7')));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(fieldOf(post.mock.calls[1], 'lookalikes')).toEqual([...result().lookalikes!.choices, update]);
    // The fields an update changes, by the titles of their columns.
    const row = await screen.findByRole('group', { name: ROW_4 });
    fireEvent.mouseOver(row.parentElement!.previousSibling as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Changes: Supplier, Publisher');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    const sent = fieldOf(post.mock.calls[2], 'lookalikes');
    expect(sent).toEqual(second.choices);
    // Row 3, left out by default, goes with its target: renamed in between, it stays left out.
    expect(sent).toContainEqual({ kind: 'lookalikes', action: 'ignore', targets: expect.objectContaining({ 3: { id: ID_4, state: '0123456789abcdef' } }) });
  });

  it('reads the refusal and the warning of a row on its line, translated, the row refused shown in error', async () => {
    post.mockResolvedValueOnce({
      data: result({
        ok: false,
        errors: [{ row: 4, message: 'APP-7 changed since the check.', code: 'CSV_LOOKALIKE_CHANGED', params: { ref: 'APP-7' } }],
        warnings: [{ row: 3, message: 'Looks like APP-4, already updated by line 2. Left out.', code: 'CSV_LOOKALIKE_SAME_RECORD', params: { ref: 'APP-4', other: 2 } }],
        lookalikes: lookalikes([accents, { ...close, outcome: 'updated' }]),
      }),
    });
    await i18n.changeLanguage('fr');
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByText(/APP-7 a changé depuis la vérification/)).toBeInTheDocument();
    expect(screen.getByText(/Ressemble à APP-4, déjà mise à jour par la ligne 2/)).toBeInTheDocument();
    // The row refused is drawn in error, and its update may be chosen again.
    expect(within(screen.getByRole('group', { name: /^Ligne 4/ })).getByRole('button', { name: 'Mettre à jour APP-7' })).toBeInTheDocument();
  });

  it('sends a row updated by its id and the state of the check', async () => {
    post.mockResolvedValueOnce({ data: result() }).mockResolvedValueOnce({ data: result() });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await waitFor(() => choice(ROW_4, 'Update APP-7')));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(fieldOf(post.mock.calls[1], 'lookalikes')).toEqual([...result().lookalikes!.choices, { kind: 'lookalike', line: 4, action: 'update', id: ID_7, state: 'fedcba9876543210' }]);
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
