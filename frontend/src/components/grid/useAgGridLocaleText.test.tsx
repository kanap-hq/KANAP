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
    ['en', 'Contains', 'Filter…'],
    ['fr', 'Contient', 'Filtrer…'],
    ['de', 'Enthält', 'Filter…'],
    ['es', 'Contiene', 'Filtro…'],
  ])('gives the official texts in %s', async (lng, contains, filter) => {
    const texts = await textsIn(lng);
    expect(texts.contains).toBe(contains);
    expect(texts.filterOoo).toBe(filter);
    expect(Object.keys(texts).length).toBeGreaterThan(400);
  });

  it.each(['en', 'fr', 'de', 'es'])('writes ellipses as one character and key names as people say them in %s', async (lng) => {
    const texts = await textsIn(lng);
    expect(Object.entries(texts).filter(([, value]) => value.includes('...'))).toEqual([]);
    const keyNames = /\b(SPACE|ESPACE|LEERTASTE|ENTER|EINGABETASTE|CTRL|STRG|ALT)\b/;
    // The keyboard hints AG Grid Community reads aloud (the Enterprise ones are not used here).
    const hints = ['ariaFilterColumn', 'ariaMenuColumn', 'ariaRowDeselect', 'ariaRowSelect', 'ariaRowSelectAll',
      'ariaRowToggleSelection', 'ariaSortableColumn', 'ariaToggleCellValue'];
    expect(hints.filter((key) => !texts[key] || keyNames.test(texts[key]))).toEqual([]);
  });

  it('writes the labels people see in sentence case', async () => {
    const es = await textsIn('es');
    expect(es.pageSizeSelectorLabel).toBe('Tamaño de página:');
    expect(es.pinColumn).toBe('Fijar columna');
    expect(es.resetColumns).toBe('Restablecer columnas');
    expect(es.nextPage).toBe('Página siguiente');
    expect((await textsIn('fr')).pageSizeSelectorLabel).toBe('Taille de la page :');
    expect((await textsIn('en')).noRowsToShow).toBe('No rows to show');
  });

  it('keeps our texts where the package has none or a wrong one', async () => {
    const fr = await textsIn('fr');
    expect(fr.ariaHeaderSelection).toBe("Colonne avec sélection dans l'en-tête");
    expect(fr.rowDragRow).toBe('ligne');
    expect(fr.of).toBe('sur');
    expect(fr.ariaFilterColumn).toBe('Appuyez sur Ctrl+Entrée pour ouvrir le filtre');
    const es = await textsIn('es');
    expect(es.ariaHeaderSelection).toBe('Columna con selección en el encabezado');
    expect(es.ariaRowSelect).toBe('Pulse Espacio para seleccionar esta fila');
    expect(es.greaterThanOrEqual).toBe('Mayor o igual que');
    const de = await textsIn('de');
    expect(de.ariaHeaderSelection).toBe('Spalte mit Auswahl in der Kopfzeile');
    expect(de.ariaChecked).toBe('aktiviert');
    expect(de.ariaUnchecked).toBe('nicht aktiviert');
    expect(de.ariaRowDeselect).toBe('Drücken Sie die Leertaste, um diese Zeile abzuwählen');
    expect(de.invalidNumber).toBe('Ungültige Zahl');
  });

  it.each(['en', 'fr', 'de', 'es'])('overrides the same keys in every language (%s)', (lng) => {
    expect(Object.keys(i18n.getResourceBundle(lng, 'grid')).sort()).toEqual(Object.keys(i18n.getResourceBundle('en', 'grid')).sort());
  });

  it('follows the user language', async () => {
    await i18n.changeLanguage('fr');
    const { result } = renderHook(() => useAgGridLocaleText());
    expect(result.current.ariaRowSelect).toBe('Appuyez sur Espace pour sélectionner cette ligne');
    await act(async () => { await i18n.changeLanguage('de'); });
    expect(result.current.ariaRowSelect).toBe('Drücken Sie die Leertaste, um diese Zeile auszuwählen');
  });

  it('is handed to every grid of the app', () => {
    const missing = Object.entries(gridSources)
      .filter(([, source]) => source.includes('<AgGridReact') && !source.includes('useAgGridLocaleText'))
      .map(([file]) => file);
    expect(missing).toEqual([]);
  });
});
