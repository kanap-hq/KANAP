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
});
