import '../../i18n';
import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BULK_SELECTION_COLUMN, BulkSelectionScope, useBulkSelection } from './bulkSelection';

type Row = { id: string; name: string };
const row = (id: string): Row => ({ id, name: `Line ${id}` });
const request = (params: Record<string, unknown>, total: number) => ({ params, total });

function useSelection() {
  return useBulkSelection<Row>({
    rowLabel: (r) => `Select ${r.name}`,
    scopeKey: ({ q, filters }) => ({ q, filters }),
  });
}

describe('useBulkSelection', () => {
  it('takes the ticked rows, by id, with their data', () => {
    const { result } = renderHook(useSelection);
    act(() => result.current.onListRequestChange(request({ q: '', filters: '', sort: 'name:ASC' }, 40)));
    act(() => result.current.toggleRow(row('a')));
    act(() => result.current.toggleRow(row('b')));
    act(() => result.current.toggleRow(row('a')));
    expect(result.current.count).toBe(1);
    expect(result.current.tickedRows).toEqual([row('b')]);
    expect(result.current.body).toEqual({ ids: ['b'] });
  });

  it('takes every row of the filter less the unticked ones, and names none for a delete', () => {
    const { result } = renderHook(useSelection);
    act(() => result.current.onListRequestChange(request({ q: 'srv', filters: '{"nature":1}', status: 'enabled', sort: 'name:ASC', shape: 'grid' }, 40)));
    act(() => result.current.toggleRow(row('a')));
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(40);
    expect(result.current.scope.whole).toBe(true);
    act(() => result.current.toggleRow(row('c')));
    expect(result.current.count).toBe(39);
    expect(result.current.scope.whole).toBe(false);
    expect(result.current.scope.isSelected('c')).toBe(false);
    expect(result.current.scope.isSelected('d')).toBe(true);
    expect(result.current.tickedRows).toEqual([]);
    // The list's parameters without its sort.
    expect(result.current.body).toEqual({
      all: true,
      filters: { q: 'srv', filters: '{"nature":1}', status: 'enabled', shape: 'grid' },
      exclude_ids: ['c'],
    });
    // The header again: every row; and again: none.
    act(() => result.current.toggleAll());
    expect(result.current.body).toEqual({ all: true, filters: { q: 'srv', filters: '{"nature":1}', status: 'enabled', shape: 'grid' } });
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
  });

  it('is cleared by a change of the filter or search, kept by a sort or a reload', () => {
    const { result } = renderHook(useSelection);
    act(() => result.current.onListRequestChange(request({ q: '', filters: '', sort: 'name:ASC' }, 40)));
    act(() => result.current.toggleAll());
    act(() => result.current.onListRequestChange(request({ q: '', filters: '', sort: 'name:DESC', fte: 'x' }, 40)));
    expect(result.current.count).toBe(40);
    act(() => result.current.onListRequestChange(request({ q: '', filters: '{"supplier_name":1}', sort: 'name:DESC' }, 12)));
    expect(result.current.count).toBe(0);
    expect(result.current.body).toEqual({ ids: [] });
    act(() => result.current.toggleRow(row('a')));
    act(() => result.current.onListRequestChange(request({ q: 'x', filters: '{"supplier_name":1}' }, 3)));
    expect(result.current.count).toBe(0);
  });

  it('draws the column: the header takes the filter, a row box ticks its row, a totals row has none', () => {
    function Harness() {
      const bulk = useSelection();
      React.useEffect(() => { bulk.onListRequestChange(request({ q: '' }, 5)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      const Header = bulk.column.headerComponent as React.ComponentType;
      const Cell = bulk.column.cellRenderer as React.ComponentType<any>;
      return (
        <BulkSelectionScope value={bulk.scope}>
          <Header />
          <Cell data={row('a')} node={{}} />
          <Cell data={{ id: '__totals__' }} node={{ rowPinned: 'bottom' }} />
          <span data-testid="count">{bulk.count}</span>
        </BulkSelectionScope>
      );
    }
    render(<Harness />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Line a' }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect((screen.getByRole('checkbox', { name: 'Select every row of the filter' }) as HTMLInputElement).dataset.indeterminate).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every row of the filter' }));
    expect(screen.getByTestId('count')).toHaveTextContent('5');
    expect((screen.getByRole('checkbox', { name: 'Select Line a' }) as HTMLInputElement).checked).toBe(true);
  });

  it('ticks a row from a click beside its box, never from another column or the totals row', () => {
    const { result } = renderHook(useSelection);
    const cellOf = (colId: string, data: unknown, pinned?: string) => ({ data, node: { rowPinned: pinned }, column: { getColId: () => colId }, event: { target: document.createElement('div') } });
    act(() => result.current.onCellClicked(cellOf('product_name', row('a'))));
    act(() => result.current.onCellClicked(cellOf(BULK_SELECTION_COLUMN, { id: '__totals__' }, 'bottom')));
    expect(result.current.count).toBe(0);
    act(() => result.current.onCellClicked(cellOf(BULK_SELECTION_COLUMN, row('a'))));
    expect(result.current.tickedRows).toEqual([row('a')]);
  });
});
