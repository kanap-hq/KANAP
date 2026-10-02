import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import type { EditConflict } from '../../hooks/editConflicts';
import EditConflictBanner from './EditConflictBanner';

// The conflict banner (plan planning/perf-scale, lot 3C, decision D3), in
// French: « Marie Dupont a modifié ce champ à 14:02 pendant que vous le
// modifiiez. Sa valeur : … Votre valeur : … [Garder sa valeur] [Appliquer la vôtre] ».

/** Today at 14:02, local time: the message shows the time only. */
function todayAt(hours: number, minutes: number) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function conflict(overrides: Partial<EditConflict> & { field: string }): EditConflict {
  return {
    base: null, current: null, mine: null,
    labels: { base: null, current: null, mine: null },
    changed_by: { id: 'marie', name: 'Marie Dupont' },
    changed_at: todayAt(14, 2),
    ...overrides,
  };
}

const LABELS: Record<string, string> = { notes: 'Notes', supplier_id: 'Fournisseur', effective_start: 'Début' };

function renderBanner(conflicts: EditConflict[], extra: Partial<React.ComponentProps<typeof EditConflictBanner>> = {}) {
  const onResolve = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <EditConflictBanner
        conflicts={conflicts}
        fieldLabel={(field) => LABELS[field] ?? field}
        isLongText={(field) => field === 'notes'}
        onResolve={onResolve}
        {...extra}
      />
    </ThemeProvider>,
  );
  return { onResolve };
}

describe('EditConflictBanner', () => {
  beforeEach(async () => { await i18n.changeLanguage('fr'); });
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('says who changed the field and when, both values, and offers the two choices', () => {
    const { onResolve } = renderBanner([conflict({
      field: 'supplier_id', base: 's0', current: 's1', mine: 's2',
      labels: { base: 'Ancien', current: 'Acme', mine: 'Globex' },
    })]);
    expect(screen.getByText('Une autre personne a modifié un champ que vous modifiiez')).toBeInTheDocument();
    expect(screen.getByText('Marie Dupont a modifié ce champ à 14:02 pendant que vous le modifiiez.')).toBeInTheDocument();
    const row = screen.getByTestId('edit-conflict-supplier_id');
    expect(within(row).getByText('Fournisseur')).toBeInTheDocument();
    // Names, never the ids.
    expect(within(row).getByText('Sa valeur')).toBeInTheDocument();
    expect(within(row).getByText('Acme')).toBeInTheDocument();
    expect(within(row).getByText('Votre valeur')).toBeInTheDocument();
    expect(within(row).getByText('Globex')).toBeInTheDocument();
    expect(within(row).queryByText('s1')).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'Garder sa valeur: Fournisseur' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Appliquer la vôtre: Fournisseur' }));
    expect(onResolve.mock.calls).toEqual([['supplier_id', 'theirs'], ['supplier_id', 'mine']]);
  });

  it('shows both long texts side by side, an empty value as such, and a date from another day', () => {
    renderBanner([
      conflict({ field: 'notes', base: 'Start', current: 'Texte de Marie\nsur deux lignes', mine: '' }),
      conflict({ field: 'effective_start', current: '2026-02-01', mine: '2026-03-01', changed_by: null, changed_at: '2026-01-15T09:30:00.000Z' }),
    ], { formatValue: (field, value) => (field === 'effective_start' ? `le ${String(value)}` : undefined) });
    expect(screen.getByText('Une autre personne a modifié 2 champs que vous modifiiez')).toBeInTheDocument();
    const notes = screen.getByTestId('edit-conflict-notes');
    expect(within(notes).getByText(/Texte de Marie/)).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(within(notes).getByText('Vide')).toBeInTheDocument();
    const start = screen.getByTestId('edit-conflict-effective_start');
    expect(within(start).getByText(/^Ce champ a été modifié le .+ à .+ pendant que vous le modifiiez\.$/)).toBeInTheDocument();
    expect(within(start).getByText('le 2026-02-01')).toBeInTheDocument();
  });

  it('waits for a running save before a choice', () => {
    renderBanner([conflict({ field: 'notes', current: 'a', mine: 'b' })], { busy: true });
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('renders nothing when there is no conflict', () => {
    const { container } = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <EditConflictBanner conflicts={[]} fieldLabel={(f) => f} onResolve={() => undefined} />
      </ThemeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
