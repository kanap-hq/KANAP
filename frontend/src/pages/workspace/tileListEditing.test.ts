import { describe, expect, it, vi } from 'vitest';
import { editTileList } from './tileListEditing';

const tiles = [
  { id: 'a', enabled: true, order: 1, config: {} },
  { id: 'b', enabled: false, order: 2, config: {} },
  { id: 'c', enabled: true, order: 3, config: {} },
  { id: 'x', enabled: false, order: 4, config: {} },
];
const inSection = (id: string) => id !== 'x';
const order = (next: typeof tiles) => next.map((tile) => `${tile.id}${tile.enabled ? '' : '-'}`);

describe('editTileList', () => {
  it('offers the tiles off in the section only', () => {
    expect(editTileList(tiles, vi.fn(), inSection, (id) => id.toUpperCase()).addable).toEqual([{ id: 'b', title: 'B' }]);
  });

  it('turns a tile on at the end, off in place, and moves one before another', () => {
    const onChange = vi.fn();
    const edit = editTileList(tiles, onChange, inSection, (id) => id);
    edit.onAdd('b');
    expect(order(onChange.mock.calls[0][0])).toEqual(['a', 'c', 'x-', 'b']);
    edit.onRemove('a');
    expect(order(onChange.mock.calls[1][0])).toEqual(['a-', 'b-', 'c', 'x-']);
    edit.onMove('c', 'a');
    expect(order(onChange.mock.calls[2][0])).toEqual(['c', 'a', 'b-', 'x-']);
    expect(onChange.mock.calls[2][0].map((tile: { order: number }) => tile.order)).toEqual([1, 2, 3, 4]);
  });
});
