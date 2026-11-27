import React from 'react';

/**
 * The rows a list editor shows, and how it changes them. A change applies at once to the rows on screen, then
 * goes to the page inside a transition, from the event that made it: never from a render, where it would set
 * the page's state while the editor renders. Rows coming back from the page replace the local ones, except a
 * list the editor sent itself (the rows typed since are newer than it).
 */
export function useEditorRows<T>(items: T[], onChange: (rows: T[]) => void) {
  const [rows, setRows] = React.useState(items);
  const rowsRef = React.useRef(rows);
  const sentRef = React.useRef(new WeakSet<object>());

  React.useEffect(() => {
    if (sentRef.current.has(items)) return;
    rowsRef.current = items;
    setRows(items);
  }, [items]);

  const changeRows = React.useCallback((update: (current: T[]) => T[]) => {
    const next = update(rowsRef.current);
    if (next === rowsRef.current) return;
    rowsRef.current = next;
    setRows(next);
    sentRef.current.add(next);
    React.startTransition(() => onChange(next));
  }, [onChange]);

  return [rows, changeRows] as const;
}
