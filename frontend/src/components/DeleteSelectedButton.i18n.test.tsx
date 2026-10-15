import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import api from '../api';
import DeleteSelectedButton from './DeleteSelectedButton';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('../api', () => ({ default: { delete: vi.fn() } }));

// The list's delete window and its message once done, in the real locale texts: the title and
// the message say the count with the right plural, and the message names what was deleted.

type Row = { id: string; name: string };
const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
const rowsOf = (count: number): Row[] => NAMES.slice(0, count).map((name, i) => ({ id: String(i), name }));

async function openIn(lng: string, rows: Row[]) {
  await i18n.changeLanguage(lng);
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteSelectedButton<Row>
          selectedRows={rows}
          endpoint="/things/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          onDeleteSuccess={() => undefined}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getAllByRole('button')[0]);
  return { view, dialog: await screen.findByRole('dialog') };
}

describe('DeleteSelectedButton in each language', () => {
  beforeEach(() => { vi.mocked(api.delete).mockReset(); });
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it.each([
    ['fr', 1, "Supprimer l'élément sélectionné"],
    ['fr', 2, 'Supprimer les 2 éléments sélectionnés'],
    ['en', 1, 'Delete the selected item'],
    ['en', 3, 'Delete the 3 selected items'],
    ['de', 2, '2 ausgewählte Elemente löschen'],
    ['es', 2, 'Eliminar los 2 elementos seleccionados'],
  ])('titles the window in %s for %i items with the right plural', async (lng, count, title) => {
    const { dialog } = await openIn(lng, rowsOf(count));
    expect(dialog).toHaveTextContent(title);
    expect(dialog.textContent ?? '').not.toMatch(/delete\.|\{\{/);
  });

  it.each([
    ['fr', 2, '2 éléments supprimés : Alpha et Beta'],
    ['fr', 5, '5 éléments supprimés : Alpha, Beta, Gamma et 2 autres'],
    ['en', 2, 'Deleted 2 items: Alpha and Beta'],
    ['de', 4, '4 Elemente gelöscht: Alpha, Beta, Gamma und 1 weiteres'],
    ['es', 5, '5 elementos eliminados: Alpha, Beta, Gamma y 2 más'],
  ])('names what was deleted in %s for %i items', async (lng, count, message) => {
    const rows = rowsOf(count);
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: rows.map((row) => row.id), failed: [] } } as any);
    const { dialog } = await openIn(lng, rows);
    const buttons = dialog.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
