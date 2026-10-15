import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { useAgGridLocaleText } from './useAgGridLocaleText';

const gridLocales = import.meta.glob<{ default: Record<string, string> }>('../../locales/*/grid.json', { eager: true });
const gridSources = import.meta.glob<string>(['../../**/*.tsx', '!../../**/*.test.tsx'], { eager: true, query: '?raw', import: 'default' });

// The texts AG Grid Community 32 reads aloud or shows on its own (keyboard hints, filter
// inputs, pagination): without them a French screen reader hears "Press Space to toggle row selection".
const AG_GRID_KEYS = [
  'ariaChecked', 'ariaColumnFiltered', 'ariaDateFilterInput', 'ariaFilterColumn', 'ariaFilterFromValue',
  'ariaFilterInput', 'ariaFilterMenuOpen', 'ariaFilterToValue', 'ariaFilterValue', 'ariaFilteringOperator',
  'ariaHeaderSelection', 'ariaIndeterminate', 'ariaInputEditor', 'ariaLabelCellEditor', 'ariaLabelColumnFilter',
  'ariaLabelColumnMenu', 'ariaLabelSelectField', 'ariaLabelTooltip', 'ariaMenuColumn', 'ariaPageSizeSelectorLabel',
  'ariaRowDeselect', 'ariaRowSelect', 'ariaRowSelectAll', 'ariaRowSelectionDisabled', 'ariaRowToggleSelection',
  'ariaSkeletonCellLoading', 'ariaSkeletonCellLoadingFailed', 'ariaSortableColumn', 'ariaToggleCellValue', 'ariaUnchecked',
  'firstPage', 'lastPage', 'nextPage', 'previousPage', 'pageSizeSelectorLabel', 'invalidDate', 'invalidNumber',
  'clearFilter', 'resetFilter', 'cancelFilter', 'lessThan', 'greaterThan', 'lessThanOrEqual', 'greaterThanOrEqual',
  'inRange', 'inRangeStart', 'inRangeEnd',
];

describe('AG Grid texts', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each(['en', 'fr', 'de', 'es'])('has every AG Grid text in %s', (lng) => {
    const bundle = gridLocales[`../../locales/${lng}/grid.json`].default;
    expect(AG_GRID_KEYS.filter((key) => !bundle[key])).toEqual([]);
  });

  it('hands the grid the texts of the user language', async () => {
    await i18n.changeLanguage('fr');
    const { result } = renderHook(() => useAgGridLocaleText());
    expect(result.current.ariaRowToggleSelection).toBe('Appuyez sur Espace pour sélectionner ou désélectionner la ligne');
    await act(async () => { await i18n.changeLanguage('de'); });
    expect(result.current.ariaHeaderSelection).toBe('Spalte mit Auswahl in der Kopfzeile');
  });

  it('is handed to every grid of the app', () => {
    const missing = Object.entries(gridSources)
      .filter(([, source]) => source.includes('<AgGridReact') && !source.includes('useAgGridLocaleText'))
      .map(([file]) => file);
    expect(missing).toEqual([]);
  });
});
