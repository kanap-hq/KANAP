import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { useAgGridLocaleText } from './useAgGridLocaleText';

const gridSources = import.meta.glob<string>(['../../**/*.tsx', '!../../**/*.test.tsx'], { eager: true, query: '?raw', import: 'default' });

async function textsIn(lng: string) {
  await i18n.changeLanguage(lng);
  const { result } = renderHook(() => useAgGridLocaleText());
  return result.current;
}

describe('AG Grid texts', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  // The official AG Grid translations (@ag-grid-community/locale), not a hand-written subset.
  it.each([
    ['en', 'Press SPACE to select this row', 'Page Size:', 'Filter…'],
    ['fr', 'Appuyez sur ESPACE pour sélectionner cette ligne', 'Taille de la Page :', 'Filtrer…'],
    ['de', 'Drücken Sie LEERTASTE, um diese Zeile auszuwählen', 'Seitengröße:', 'Filter…'],
    ['es', 'Presiona SPACE para seleccionar esta fila', 'Tamaño de Página:', 'Filtro…'],
  ])('gives the official texts in %s', async (lng, rowSelect, pageSize, filter) => {
    const texts = await textsIn(lng);
    expect(texts.ariaRowSelect).toBe(rowSelect);
    expect(texts.pageSizeSelectorLabel).toBe(pageSize);
    expect(texts.filterOoo).toBe(filter);
    expect(Object.keys(texts).length).toBeGreaterThan(400);
  });

  it.each(['en', 'fr', 'de', 'es'])('writes ellipses as one character in %s', async (lng) => {
    const texts = await textsIn(lng);
    expect(Object.entries(texts).filter(([, value]) => value.includes('...'))).toEqual([]);
  });

  it('keeps our texts where the package has none or a wrong one', async () => {
    expect((await textsIn('fr')).ariaHeaderSelection).toBe("Colonne avec sélection dans l'en-tête");
    expect((await textsIn('es')).ariaHeaderSelection).toBe('Columna con selección en el encabezado');
    const de = await textsIn('de');
    expect(de.ariaHeaderSelection).toBe('Spalte mit Auswahl in der Kopfzeile');
    expect(de.ariaChecked).toBe('aktiviert');
    expect(de.ariaUnchecked).toBe('nicht aktiviert');
    expect(de.ariaRowDeselect).toBe('Drücken Sie LEERTASTE, um diese Zeile abzuwählen');
  });

  it('follows the user language', async () => {
    await i18n.changeLanguage('fr');
    const { result } = renderHook(() => useAgGridLocaleText());
    expect(result.current.ariaRowSelect).toBe('Appuyez sur ESPACE pour sélectionner cette ligne');
    await act(async () => { await i18n.changeLanguage('de'); });
    expect(result.current.ariaRowSelect).toBe('Drücken Sie LEERTASTE, um diese Zeile auszuwählen');
  });

  it('is handed to every grid of the app', () => {
    const missing = Object.entries(gridSources)
      .filter(([, source]) => source.includes('<AgGridReact') && !source.includes('useAgGridLocaleText'))
      .map(([file]) => file);
    expect(missing).toEqual([]);
  });
});
