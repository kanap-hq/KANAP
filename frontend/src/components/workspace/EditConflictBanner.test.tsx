import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import type { EditConflict } from '../../hooks/editConflicts';
import EditConflictBanner, { OtherConflictsNotice } from './EditConflictBanner';

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
    // A region named by its title; the title alone goes to the polite live region.
    const region = screen.getByRole('region', { name: 'Une autre personne a modifié un champ que vous modifiiez' });
    expect(screen.getByRole('status')).toHaveTextContent(/^Une autre personne a modifié un champ que vous modifiiez$/);
    expect(within(region).getByText('Marie Dupont a modifié ce champ à 14:02 pendant que vous le modifiiez.')).toBeInTheDocument();
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
    expect(screen.getByRole('region', { name: 'Une autre personne a modifié 2 champs que vous modifiiez' })).toBeInTheDocument();
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

  it('renders no banner when there is no conflict, only an empty live region', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <EditConflictBanner conflicts={[]} fieldLabel={(f) => f} onResolve={() => undefined} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says so when the change is the user\'s own, from another window', () => {
    renderBanner([conflict({ field: 'notes', current: 'a', mine: 'b', changed_by: { id: 'me', name: 'Moi Même' } })], { currentUserId: 'me' });
    expect(screen.getByRole('region', { name: 'Vous avez modifié un champ dans une autre fenêtre' })).toBeInTheDocument();
    expect(screen.getByText('Vous avez modifié ce champ dans une autre fenêtre à 14:02.')).toBeInTheDocument();
    expect(screen.queryByText(/Moi Même/)).toBeNull();
  });

  it('a user without a name is "a user", never an e-mail', () => {
    renderBanner([conflict({ field: 'notes', current: 'a', mine: 'b', changed_by: { id: 'u-9', name: null } })]);
    expect(screen.getByText('Un utilisateur a modifié ce champ à 14:02 pendant que vous le modifiiez.')).toBeInTheDocument();
  });

  it('names nobody when the server cannot say who, and gives the time of the line\'s last change', () => {
    renderBanner([conflict({ field: 'supplier_id', current: null, mine: 's2', changed_by: null, labels: { base: null, current: null, mine: 'Globex' } })]);
    expect(screen.getByText('Ce champ a été modifié à 14:02 pendant que vous le modifiiez.')).toBeInTheDocument();
  });

  it('never shows an id: a record gone is said so, a value picked after the answer points to the field', () => {
    renderBanner([
      conflict({ field: 'supplier_id', base: 's0', current: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', mine: '7f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }),
      conflict({ field: 'account_id', current: { id: 'x' }, mine: '8f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', mineEdited: true }),
    ]);
    const supplier = screen.getByTestId('edit-conflict-supplier_id');
    expect(within(supplier).getAllByText('Valeur plus disponible')).toHaveLength(2);
    expect(supplier).not.toHaveTextContent('6f1c2a3b');
    const account = screen.getByTestId('edit-conflict-account_id');
    expect(within(account).getByText('Valeur plus disponible')).toBeInTheDocument();
    expect(within(account).getByText('Votre nouveau choix, affiché dans le champ')).toBeInTheDocument();
  });

  it('gives the page the conflict to format a value with (two ends of validity on the same day)', () => {
    const formatValue = vi.fn(() => 'formatted');
    const entry = conflict({ field: 'disabled_at', current: '2026-10-02T08:00:00.000Z', mine: '2026-10-02T09:00:00.000Z' });
    renderBanner([entry], { formatValue });
    expect(formatValue).toHaveBeenCalledWith('disabled_at', '2026-10-02T08:00:00.000Z', entry);
  });

  it('scrolls its rows instead of growing past 40% of the screen', () => {
    renderBanner([conflict({ field: 'notes', current: 'a', mine: 'b' }), conflict({ field: 'supplier_id', current: 'x', mine: 'y' })]);
    // 40vh, which jsdom computes in pixels.
    expect(screen.getByRole('region')).toHaveStyle({ maxHeight: `${(window.innerHeight * 40) / 100}px` });
    expect(screen.getByTestId('edit-conflict-rows')).toHaveStyle({ overflowY: 'auto' });
  });

  it('hands the focus on after the last choice only', () => {
    const returnFocus = vi.fn();
    const two = [conflict({ field: 'notes', current: 'a', mine: 'b' }), conflict({ field: 'supplier_id', current: 'x', mine: 'y' })];
    const { onResolve } = renderBanner(two, { returnFocus });
    fireEvent.click(within(screen.getByTestId('edit-conflict-notes')).getByRole('button', { name: 'Garder sa valeur: Notes' }));
    expect(onResolve).toHaveBeenCalledWith('notes', 'theirs');
    expect(returnFocus).not.toHaveBeenCalled();
  });

  it('hands the focus on once the banner goes', () => {
    const returnFocus = vi.fn();
    renderBanner([conflict({ field: 'notes', current: 'a', mine: 'b' })], { returnFocus });
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer la vôtre: Notes' }));
    expect(returnFocus).toHaveBeenCalledWith('notes');
  });

  it('in Spanish, the user\'s own value is "mi valor"', async () => {
    await i18n.changeLanguage('es');
    renderBanner([conflict({ field: 'notes', current: 'a', mine: 'b' })]);
    expect(screen.getByText('Mi valor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar mi valor: Notes' })).toBeInTheDocument();
  });

  it('names the other lines a choice waits on, with a link to each', () => {
    const onOpen = vi.fn();
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <OtherConflictsNotice items={[{ id: 'a', label: 'OPX-1' }]} onOpen={onOpen} />
      </ThemeProvider>,
    );
    expect(screen.getByText('OPX-1 a une modification qui attend votre choix.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir OPX-1' }));
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});

describe('EditConflictBanner for a budget column or an allocation (lots 3D, 3E)', () => {
  beforeEach(async () => { await i18n.changeLanguage('fr'); });
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('names the column and offers to reload it or overwrite it', () => {
    const { onResolve } = renderBanner(
      [conflict({ field: 'planned', current: 'planned', mine: 'planned', labels: { base: null, current: '12 000 sur l\'année', mine: '15 000 sur l\'année' } })],
      { wording: 'column', fieldLabel: () => 'Budget' },
    );
    const region = screen.getByRole('region', { name: 'Une autre personne a modifié une colonne que vous modifiiez' });
    expect(within(region).getByText('Marie Dupont a modifié cette colonne à 14:02 pendant que vous la modifiiez.')).toBeInTheDocument();
    expect(within(region).getByText('12 000 sur l\'année')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Recharger la colonne: Budget' }));
    expect(onResolve).toHaveBeenCalledWith('planned', 'theirs');
    fireEvent.click(within(region).getByRole('button', { name: 'Écraser: Budget' }));
    expect(onResolve).toHaveBeenCalledWith('planned', 'mine');
  });

  it('names the allocation, and says so when the change is the user\'s own', () => {
    renderBanner(
      [conflict({ field: 'allocations', current: 'x', mine: 'y', labels: { base: null, current: 'Effectif', mine: 'Manuel' }, changed_by: { id: 'me', name: 'Moi' } })],
      { wording: 'allocation', fieldLabel: () => 'Ventilation', currentUserId: 'me' },
    );
    const region = screen.getByRole('region', { name: 'Vous avez modifié cette ventilation dans une autre fenêtre' });
    expect(within(region).getByText('Vous avez modifié cette ventilation dans une autre fenêtre à 14:02.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Recharger la ventilation: Ventilation' })).toBeInTheDocument();
  });
});
