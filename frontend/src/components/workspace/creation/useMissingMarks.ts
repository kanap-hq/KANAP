import React from 'react';
import { notifyFieldsMarked } from './missingAnnouncement';

type Options = {
  /** The record shown: its marks go when another one shows. */
  recordKey: string | null | undefined;
  /** The fields the screen itself sees missing now, by key. */
  missingNow: () => string[];
  /** The value a field holds now, by key: compared with the one it held when it was marked. */
  valueOf: (key: string) => unknown;
};

const snapshot = (value: unknown) => JSON.stringify(value ?? null);

/**
 * The fields a check found missing (Create or Done on a record being created, a refusal of the
 * server on a field), marked on their label until each one gets a value. A field stays marked
 * while the screen still sees it missing, or while it keeps the value it held when it was marked:
 * an account the server refused (another chart, another type) stays marked until it is changed.
 */
export default function useMissingMarks({ recordKey, missingNow, valueOf }: Options) {
  const [marks, setMarks] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const latest = React.useRef(valueOf);
  latest.current = valueOf;
  React.useEffect(() => { setMarks(new Map()); }, [recordKey]);

  /** Marks these fields, with the value each one holds now; `add` keeps the marks already there. The page's announcement then names the marked fields (`CreationActions`). */
  const mark = React.useCallback((fields: readonly string[], options?: { add?: boolean }) => {
    if (fields.length > 0) notifyFieldsMarked();
    setMarks((current) => {
      const next = new Map(options?.add ? current : []);
      for (const field of fields) next.set(field, snapshot(latest.current(field)));
      return next;
    });
  }, []);

  const missing = marks.size > 0 ? new Set(missingNow()) : null;
  const marked = new Set<string>();
  for (const [field, held] of marks) {
    if (missing?.has(field) || snapshot(valueOf(field)) === held) marked.add(field);
  }
  return { marked: marked as ReadonlySet<string>, mark };
}
