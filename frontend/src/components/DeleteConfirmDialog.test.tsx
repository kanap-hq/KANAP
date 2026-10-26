import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { describe, expect, it } from 'vitest';
import DeleteConfirmDialog from './DeleteConfirmDialog';
import { createAppTheme } from '../config/ThemeContext';

const ITEMS = [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }];

async function renderIn(lng: string, count: number) {
  await i18n.changeLanguage(lng);
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={createAppTheme('light')}>
        <DeleteConfirmDialog open onClose={() => undefined} onConfirm={() => undefined} itemCount={count} items={ITEMS.slice(0, count)} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('DeleteConfirmDialog', () => {
  it('speaks of one item in the singular', async () => {
    await renderIn('fr', 1);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent("L'élément suivant sera supprimé");
    expect(dialog).toHaveTextContent("Si l'élément est référencé ailleurs");
  });

  it('speaks of several items in the plural', async () => {
    await renderIn('fr', 2);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('2 éléments seront supprimés');
    expect(dialog).toHaveTextContent('Les éléments référencés ailleurs sont conservés');
    expect(dialog).not.toHaveTextContent("Si l'élément");
  });

  it('has every sentence in each language', async () => {
    for (const lng of ['en', 'fr', 'de', 'es']) {
      for (const count of [1, 2]) {
        const { unmount } = await renderIn(lng, count);
        expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/delete\.|\{\{|\(s\)/);
        unmount();
      }
    }
  });

  it('hides the count line when nothing would be deleted', async () => {
    for (const lng of ['en', 'fr', 'de', 'es']) {
      const { unmount } = await renderIn(lng, 0);
      const text = screen.getByRole('dialog').textContent ?? '';
      // Count 0 uses the plural form in English, German and Spanish, and the singular in French.
      expect(text).not.toMatch(/0 (items|éléments|Elemente|elementos)/);
      expect(text).not.toMatch(/following item will be deleted|L'élément suivant sera supprimé|folgende Element wird gelöscht|siguiente elemento/);
      expect(text).not.toMatch(/delete\.|\{\{/);
      unmount();
    }
  });

  it('hides a caller count of zero and still explains what is kept', async () => {
    await i18n.changeLanguage('en');
    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createAppTheme('light')}>
          <DeleteConfirmDialog
            open
            onClose={() => undefined}
            onConfirm={() => undefined}
            itemCount={0}
            itemsLabel="0 interface will be deleted:"
            confirmDisabled
            kept={{
              label: '1 interface has bindings and is kept:',
              items: [{ id: 'a', name: 'Orders', reason: '2 bindings' }],
            }}
          />
        </ThemeProvider>
      </I18nextProvider>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveTextContent('0 interface will be deleted');
    expect(dialog).toHaveTextContent('1 interface has bindings and is kept:');
    expect(dialog).toHaveTextContent('Orders');
    expect(dialog).toHaveTextContent('2 bindings');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
