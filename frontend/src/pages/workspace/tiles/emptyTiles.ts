import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/** Set by the home page around each tile: the tile says through it whether it has anything to show. */
export const TileEmptyContext = createContext<((empty: boolean) => void) | null>(null);

/**
 * Tells the slot around the tile whether the tile is empty; a tile still loading or in error is not.
 * Nothing is reported on unmount: the page only reads the state of the tiles it shows.
 */
export function useReportEmpty(empty: boolean) {
  const report = useContext(TileEmptyContext);
  useEffect(() => {
    report?.(empty);
  }, [report, empty]);
}

/**
 * The ids of the tiles that said they are empty, and a stable reporter per id to hand them through
 * `TileEmptyContext`.
 */
export function useEmptyTiles() {
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set());
  const reporters = useRef(new Map<string, (isEmpty: boolean) => void>());
  const reporter = useCallback((id: string) => {
    let report = reporters.current.get(id);
    if (!report) {
      report = (isEmpty: boolean) => setEmpty((prev) => {
        if (prev.has(id) === isEmpty) return prev;
        const next = new Set(prev);
        if (isEmpty) next.add(id);
        else next.delete(id);
        return next;
      });
      reporters.current.set(id, report);
    }
    return report;
  }, []);
  return { empty, reporter };
}
