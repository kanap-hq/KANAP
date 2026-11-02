import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import api from '../api';
import DeleteSelectedButton from './DeleteSelectedButton';
import { createAppTheme } from '../config/ThemeContext';
import { NotifyProvider } from './notify/NotifyProvider';

vi.mock('../api', () => ({ default: { delete: vi.fn() } }));

// The list's delete window and its message once done, in the real locale texts: the title and
// the message say the count with the right plural, and the message names what was deleted.

type Row = { id: string; name: string };
const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
const rowsOf = (count: number): Row[] => NAMES.slice(0, count).map((name, i) => ({ id: String(i), name }));

async function openIn(lng: string, rows: Row[], checkDelete?: (ids: string[]) => Promise<any>) {
  await i18n.changeLanguage(lng);
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={createAppTheme('light')}>
        <NotifyProvider>
          <DeleteSelectedButton<Row>
            selectedRows={rows}
            endpoint="/things/bulk"
            getItemId={(row) => row.id}
            getItemName={(row) => row.name}
            onDeleteSuccess={() => undefined}
            checkDelete={checkDelete}
          />
        </NotifyProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );
  fireEvent.click(screen.getAllByRole('button')[0]);
  return { view, dialog: await screen.findByRole('dialog') };
}

const NODES_REFUSAL = { code: 'COST_CENTER_HAS_NODES', usages: [{ type: 'nodes', total: 1 }] };

describe('DeleteSelectedButton in each language', () => {
  beforeEach(() => { vi.mocked(api.delete).mockReset(); });
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it.each([
    ['fr', 1, 'Supprimer Alpha ?'],
    ['fr', 2, 'Supprimer les 2 éléments sélectionnés'],
    ['en', 1, 'Delete Alpha?'],
    ['en', 3, 'Delete the 3 selected items'],
    ['de', 2, '2 ausgewählte Elemente löschen'],
    ['es', 2, 'Eliminar los 2 elementos seleccionados'],
  ])('titles the window in %s for %i items: the item named, or the selection counted', async (lng, count, title) => {
    const { dialog } = await openIn(lng, rowsOf(count));
    expect(dialog).toHaveTextContent(title);
    expect(dialog.textContent ?? '').not.toMatch(/élément sélectionné|selected item\b/);
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

  it.each([
    ['fr', 'Supprimer les 2 éléments sélectionnés', '1 élément supprimé : Alpha. 1 élément conservé : Beta'],
    ['en', 'Delete the 2 selected items', 'Deleted 1 item: Alpha. 1 item kept: Beta'],
    ['de', '2 ausgewählte Elemente löschen', '1 Element gelöscht: Alpha. 1 Element behalten: Beta'],
    ['es', 'Eliminar los 2 elementos seleccionados', '1 elemento eliminado: Alpha. 1 elemento conservado: Beta'],
  ])('in %s, titles a mixed selection by its count and names what was kept once done', async (lng, title, message) => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['0'], failed: [] } } as any);
    const { dialog } = await openIn(lng, rowsOf(2), async () => ({ refused: [{ ...NODES_REFUSAL, id: '1', name: 'Beta' }] }));
    expect(dialog).toHaveTextContent(title);
    const buttons = dialog.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it.each([
    ['fr', 'Supprimer les 2 sociétés sélectionnées', '1 société supprimée : Alpha. 1 société conservée : Beta'],
    ['en', 'Delete the 2 selected companies', '1 company deleted: Alpha. 1 company kept: Beta'],
    ['de', '2 ausgewählte Unternehmen löschen', '1 Unternehmen gelöscht: Alpha. 1 Unternehmen behalten: Beta'],
    ['es', 'Eliminar las 2 empresas seleccionadas', '1 empresa eliminada: Alpha. 1 empresa conservada: Beta'],
  ])('in %s, names companies when the list gives their words', async (lng, title, message) => {
    await i18n.changeLanguage(lng);
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: ['0'], failed: [] } } as any);
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createAppTheme('light')}>
          <NotifyProvider>
          <DeleteSelectedButton<Row>
            selectedRows={rowsOf(2)}
            endpoint="/companies/bulk"
            getItemId={(row) => row.id}
            getItemName={(row) => row.name}
            onDeleteSuccess={() => undefined}
            checkDelete={async () => ({ refused: [{ ...NODES_REFUSAL, id: '1', name: 'Beta' }] })}
            itemLabels={{
              toDelete: (count) => i18n.t('master-data:companies.delete.toDelete', { count }),
              kept: (count) => i18n.t('master-data:companies.delete.kept', { count }),
              deleted: (count) => i18n.t('master-data:companies.delete.deleted', { count }),
              title: (count) => i18n.t('master-data:companies.delete.title', { count }),
              keptDone: (count) => i18n.t('master-data:companies.delete.keptDone', { count }),
            }}
          />
          </NotifyProvider>
        </ThemeProvider>
      </I18nextProvider>,
    );
    fireEvent.click(screen.getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(title);
    const buttons = dialog.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it.each([
    ['fr', 'Ce groupe contient 1 élément. Déplacez-le ou supprimez-le d’abord.'],
    ['en', 'This group contains 1 node. Move or delete it first.'],
    ['de', 'Diese Gruppe enthält 1 Element. Verschieben oder löschen Sie es zuerst.'],
    ['es', 'Este grupo contiene 1 elemento. Muévalo o elimínelo primero.'],
  ])('in %s, words the refusal of a single row in the singular', async (lng, sentence) => {
    const { dialog } = await openIn(lng, rowsOf(1), async () => ({ refused: [{ ...NODES_REFUSAL, id: '0', name: 'Alpha' }] }));
    expect(dialog).toHaveTextContent(sentence);
  });
});
