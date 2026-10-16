import { render, screen, waitFor } from '@testing-library/react';
import { AgGridReact } from 'ag-grid-react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { countValueFormatter } from './countValueFormatter';
import { useAgGridLocaleText } from './useAgGridLocaleText';

// French groups thousands with a narrow no-break space, as Intl writes it.
const FR_SPACE = ' ';

function PagedGrid({ total }: { total: number }) {
  const localeText = useAgGridLocaleText();
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return (
    <div style={{ height: 400, width: 600 }}>
      <AgGridReact rowData={rows} columnDefs={[{ field: 'id' }]} pagination paginationPageSize={100} localeText={localeText} />
    </div>
  );
}

describe('numbers in grids follow the user language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['en', '7,486 results', 'Total (7,486)'],
    ['fr', `7${FR_SPACE}486 résultats`, `Total (7${FR_SPACE}486)`],
    ['de', '7.486 Ergebnisse', 'Gesamt (7.486)'],
    ['es', '7.486 resultados', 'Total (7.486)'],
  ])('formats the row count of the list header in %s', async (lng, results, total) => {
    await i18n.changeLanguage(lng);
    expect(i18n.t('common:filters.resultCount', { count: 7486 })).toBe(results);
    expect(i18n.t('common:labels.totalWithCount', { count: 7486 })).toBe(total);
  });

  it('keeps plurals and small counts as they were', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('common:filters.resultCount', { count: 1 })).toBe('1 résultat');
    expect(i18n.t('common:filters.resultCount', { count: 42 })).toBe('42 résultats');
  });

  it.each([
    ['fr', `1 à 100 sur 1${FR_SPACE}500`],
    ['de', '1 bis 100 von 1.500'],
    ['en', '1 to 100 of 1,500'],
  ])('formats the pagination of AG Grid in %s', async (lng, summary) => {
    await i18n.changeLanguage(lng);
    const { container } = render(<PagedGrid total={1500} />);
    await waitFor(() => {
      const panel = container.querySelector('.ag-paging-row-summary-panel');
      expect(panel?.textContent?.replace(/\s+/g, (s) => (s.includes(FR_SPACE) ? FR_SPACE : ' ')).trim()).toBe(summary);
    });
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
  });

  it.each([
    ['en', '12,000'],
    ['fr', `12${FR_SPACE}000`],
    ['de', '12.000'],
    ['es', '12.000'],
  ])('formats integer cells in %s', async (lng, text) => {
    await i18n.changeLanguage(lng);
    expect(countValueFormatter({ value: 12000 } as any)).toBe(text);
    expect(countValueFormatter({ value: null } as any)).toBe('');
  });
});
