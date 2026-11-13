/**
 * What a draft's fields became after the draft was sent (`useDraftCreation`): the person goes on
 * typing while the record is written, and the write carried only what was there when it started.
 */

/** The fields of `now` that differ from `sent`, or null when none does. */
export function changedFields<T extends object, K extends keyof T>(
  sent: T,
  now: T,
  fields: readonly K[],
): { [P in K]?: T[P] } | null {
  const changed: { [P in K]?: T[P] } = {};
  let any = false;
  for (const field of fields) {
    if (Object.is(sent[field], now[field])) continue;
    changed[field] = now[field];
    any = true;
  }
  return any ? changed : null;
}

/**
 * Saves, on the record the draft has just created, what changed in the draft since it was sent,
 * and looks again until nothing is left: a field edited while a save is under way is saved as
 * well. The last look and the page's move to the record follow each other with no event between,
 * so no edit falls in the gap. `save` rejects when the record refuses the edits: they stay on
 * screen and the caller shows why.
 */
export async function saveEditsSince<T extends object, K extends keyof T>({ sent, now, fields, save }: {
  sent: T;
  now: () => T;
  fields: readonly K[];
  save: (edits: { [P in K]?: T[P] }) => Promise<void>;
}): Promise<void> {
  let known = sent;
  for (;;) {
    const current = now();
    const edits = changedFields(known, current, fields);
    if (!edits) return;
    known = current;
    await save(edits);
  }
}
