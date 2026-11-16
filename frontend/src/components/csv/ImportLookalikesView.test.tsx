import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import ImportLookalikesView from './ImportLookalikesView';
import type { ImportLookalike, ImportLookalikeChoice, ImportLookalikes } from './csv.types';

// Lot I3 of 26.11.9, pass 3b: the rows that look like a stored record, drawn by one view for the
// budget file and the applications. Each row offers its three choices as a selection; the choices
// for all rows set every row; an update that changes nothing says so on its row.

type Choice = ImportLookalikeChoice | { kind: 'unmatch'; column: string; value: string };

const look = (line: number, id: string, over: Partial<ImportLookalike> = {}): ImportLookalike => ({
  line,
  name: `Comptabilite ${line}`,
  target: { id, ref: `APP-${line}`, name: `Comptabilité ${line}`, state: `s-${id}` },
  reason: 'name_accents',
  outcome: 'ignored',
  updatable: true,
  ...over,
});

const lookalikes = (lines: ImportLookalike[], over: Partial<ImportLookalikes> = {}): ImportLookalikes => ({
  lines,
  targets: Object.fromEntries(lines.map((entry) => [String(entry.line), { id: entry.target.id, state: entry.target.state }])),
  count: lines.length,
  ignored: lines.filter((entry) => entry.outcome === 'ignored').length,
  created: lines.filter((entry) => entry.outcome === 'created').length,
  updated: lines.filter((entry) => entry.outcome === 'updated').length,
  ...over,
});

const undone: Choice = { kind: 'unmatch', column: 'supplier_name', value: 'Cegid' };

function view(value: ImportLookalikes, choices: Choice[] = [undone], onChoices: ((next: Choice[]) => void) | null = vi.fn()) {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ImportLookalikesView<ImportLookalike, Choice>
        lookalikes={value}
        title="Looks like an existing application"
        choices={choices}
        updateChoice={(entry) => ({ kind: 'lookalike', line: entry.line, action: 'update', id: entry.target.id, state: entry.target.state })}
        onChoices={onChoices ?? undefined}
        reasonText={() => null}
        targetUrl={(entry) => `/it/applications/${entry.target.ref}`}
        fieldName={(field) => field}
      />
    </ThemeProvider>,
  );
  return onChoices as ReturnType<typeof vi.fn>;
}

/** The group of a row's choices, named by the row's sentence. */
const choicesOf = (text: string) => screen.getByRole('group', { name: text });

describe('ImportLookalikesView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('names each row and its target with its reference as a link, and shows its three choices, the current one pressed', () => {
    view(lookalikes([look(3, 'a3'), look(4, 'a4', { outcome: 'created' })]));
    expect(screen.getByText('Looks like an existing application')).toBeInTheDocument();
    expect(screen.getByText('1 left out, 1 created anyway, 0 updated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'APP-3' })).toHaveAttribute('href', '/it/applications/APP-3');
    const row = choicesOf('Line 3: Comptabilite 3 → APP-3 Comptabilité 3');
    expect(within(row).getByRole('button', { name: 'Leave out' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row).getByRole('button', { name: 'Create anyway' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(row).getByRole('button', { name: 'Update APP-3' })).toBeInTheDocument();
    expect(within(choicesOf('Line 4: Comptabilite 4 → APP-4 Comptabilité 4')).getByRole('button', { name: 'Create anyway' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('sends the whole list with a row created anyway, then with a row updated by its id and state', () => {
    const onChoices = view(lookalikes([look(3, 'a3'), look(4, 'a4')]));
    fireEvent.click(within(choicesOf('Line 3: Comptabilite 3 → APP-3 Comptabilité 3')).getByRole('button', { name: 'Create anyway' }));
    expect(onChoices).toHaveBeenLastCalledWith([undone, { kind: 'lookalike', line: 3, action: 'create' }]);
    fireEvent.click(within(choicesOf('Line 4: Comptabilite 4 → APP-4 Comptabilité 4')).getByRole('button', { name: 'Update APP-4' }));
    expect(onChoices).toHaveBeenLastCalledWith([undone, { kind: 'lookalike', line: 4, action: 'update', id: 'a4', state: 's-a4' }]);
  });

  it('leaves a row out again by dropping its own choice', () => {
    const own: Choice = { kind: 'lookalike', line: 3, action: 'create' };
    const onChoices = view(lookalikes([look(3, 'a3', { outcome: 'created' })]), [undone, own]);
    fireEvent.click(within(choicesOf('Line 3: Comptabilite 3 → APP-3 Comptabilité 3')).getByRole('button', { name: 'Leave out' }));
    expect(onChoices).toHaveBeenLastCalledWith([undone]);
  });

  it('creates all, updates all and leaves all out, every row\'s own choice replaced, the matches undone kept', () => {
    const own: Choice = { kind: 'lookalike', line: 3, action: 'update', id: 'a3', state: 's-a3' };
    const value = lookalikes([look(3, 'a3', { outcome: 'updated', fields: ['description'] }), look(4, 'a4', { updatable: false })]);
    const onChoices = view(value, [undone, own]);
    fireEvent.click(screen.getByRole('button', { name: 'Create all anyway' }));
    expect(onChoices).toHaveBeenLastCalledWith([undone, { kind: 'lookalikes', action: 'create', targets: value.targets }]);
    fireEvent.click(screen.getByRole('button', { name: 'Leave all out' }));
    expect(onChoices).toHaveBeenLastCalledWith([undone, { kind: 'lookalikes', action: 'ignore', targets: value.targets }]);
    cleanup();
    // "Update all" leaves a row it cannot update as it is: created anyway stays created.
    const created = lookalikes([look(3, 'a3'), look(4, 'a4', { updatable: false, outcome: 'created' })]);
    const next = view(created, [undone]);
    fireEvent.click(screen.getByRole('button', { name: 'Update all' }));
    expect(next).toHaveBeenLastCalledWith([
      undone,
      { kind: 'lookalike', line: 4, action: 'create' },
      { kind: 'lookalikes', action: 'update', targets: created.targets },
    ]);
  });

  it('says on its row an update that changes nothing', () => {
    view(lookalikes([look(3, 'a3', { outcome: 'updated', fields: [] })]));
    expect(screen.getByText('Nothing changes on APP-3')).toBeVisible();
  });

  it('shows what becomes of each row in words, with no choice, when read only', () => {
    view(lookalikes([look(3, 'a3', { outcome: 'created' })]), [], null);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByText((content) => content.includes('Created anyway'))).toBeInTheDocument();
  });
});
