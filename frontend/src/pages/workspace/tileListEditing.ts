import { arrayMove } from '@dnd-kit/sortable';
import type { DashboardTileConfig } from './hooks/useDashboardConfig';
import type { SectionEditing } from './TileSection';

/** The tiles in display order, renumbered from 1. */
export function inOrder(tiles: DashboardTileConfig[]): DashboardTileConfig[] {
  return tiles.slice().sort((a, b) => a.order - b.order).map((tile, index) => ({ ...tile, order: index + 1 }));
}

/**
 * The customize actions on the tiles of one section, within the whole saved list (`tiles`, in
 * display order): turn a tile on (it comes last), off, or move it before or after another one.
 * `inSection` tells the tiles of the section the person may see.
 */
export function editTileList(
  tiles: DashboardTileConfig[],
  onChange: (next: DashboardTileConfig[]) => void,
  inSection: (id: string) => boolean,
  titleOf: (id: string) => string,
): Pick<SectionEditing, 'addable' | 'onAdd' | 'onRemove' | 'onMove'> {
  const ordered = inOrder(tiles);
  return {
    addable: ordered.filter((tile) => !tile.enabled && inSection(tile.id)).map((tile) => ({ id: tile.id, title: titleOf(tile.id) })),
    onAdd: (id) => {
      const tile = ordered.find((entry) => entry.id === id);
      if (tile) onChange(inOrder([...ordered.filter((entry) => entry.id !== id), { ...tile, enabled: true, order: ordered.length + 1 }]));
    },
    onRemove: (id) => onChange(ordered.map((tile) => (tile.id === id ? { ...tile, enabled: false } : tile))),
    onMove: (activeId, overId) => {
      const from = ordered.findIndex((tile) => tile.id === activeId);
      const to = ordered.findIndex((tile) => tile.id === overId);
      if (from >= 0 && to >= 0) onChange(inOrder(arrayMove(ordered, from, to).map((tile, index) => ({ ...tile, order: index + 1 }))));
    },
  };
}
