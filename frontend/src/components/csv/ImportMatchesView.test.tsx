import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import ImportMatchesView from './ImportMatchesView';
import type { CsvImportMatch, CsvImportRefusedProposal } from './csv.types';

// Lot I3 of 26.11.9, correctifs G: the tooltip of a match line (its lines in the file) opened under
// the text and covered its Undo once the action wrapped under a long line. A line with an action
// opens its tooltip above the text, and the tooltip never holds the pointer, so that it never stands
// between the person and an action. A line without an action keeps its tooltip under it.

const match: CsvImportMatch = {
  column: 'related_object_name', name: null, value: 'Deploiement mondial de Workday', target: 'Déploiement mondial de Workday',
  ref: 'PRJ-5', origin: 'server', reason: 'accents', lines: [2], count: 1, undoable: true,
};
const refused: CsvImportRefusedProposal = {
  column: 'company_name', name: null, value: 'Fromage SA', target: 'Fromage & Co SA', reason: 'missing', lines: [3], count: 1,
};

const view = (onUndo?: (entry: { column: string; value: string }) => void) => render(
  <ImportMatchesView
    matches={[match]}
    refusedProposals={[refused]}
    columnName={(column) => column}
    open
    onToggle={() => undefined}
    onUndo={onUndo}
  />,
);

/** The tooltip of the report line whose text contains `text`, once hovered. */
async function tooltipOf(text: string): Promise<HTMLElement> {
  fireEvent.mouseOver(screen.getByText((content) => content.includes(text)));
  return screen.findByRole('tooltip');
}

describe('ImportMatchesView, the tooltip of a line', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
  });
  afterEach(() => cleanup());

  it('opens above a line that has its Undo, and never holds the pointer', async () => {
    const onUndo = vi.fn();
    view(onUndo);
    const popper = await tooltipOf('Deploiement mondial de Workday');
    expect(popper.textContent).toContain('2');
    expect(popper.className).not.toContain('MuiTooltip-popperInteractive');
    expect(popper.querySelector('.MuiTooltip-tooltip')!.className).toContain('MuiTooltip-tooltipPlacementTop');
    fireEvent.click(screen.getByRole('button', { name: 'Défaire' }));
    expect(onUndo).toHaveBeenCalledWith(match);
  });

  it('keeps a line without an action with its tooltip under it', async () => {
    view();
    const popper = await tooltipOf('Fromage SA');
    expect(popper.querySelector('.MuiTooltip-tooltip')!.className).toContain('MuiTooltip-tooltipPlacementBottom');
  });
});
