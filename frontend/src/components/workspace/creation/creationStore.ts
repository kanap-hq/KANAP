/**
 * The records being created in this tab: per record, the creation token the create route handed
 * back and the address the creation started from. In memory only (module state): a reload loses
 * it, and the record then stays as any other.
 *
 * A record page clears its entry when the person leaves it (`useRecordCreation`). The clear waits
 * one tick, so React's development double mount (StrictMode) does not drop an entry it remounts.
 *
 * An entry is kept under the record's uuid and may have other keys (`aliases`): the business
 * reference of the record (`companies:comp-5`), so that a page whose address names the record by
 * its reference finds the same entry. Every function takes either key; clearing one clears both.
 */

export type CreationEntry = { token: string; returnTo: string };

const entries = new Map<string, CreationEntry>();
/** Another key of an entry (the record's reference) → the key the entry is kept under (its uuid). */
const aliases = new Map<string, string>();
const listeners = new Set<() => void>();
const pendingClears = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function creationKey(family: string, recordId: string): string {
  return `${family}:${recordId.toLowerCase()}`;
}

/** The key an entry is kept under, from any of its keys. */
function keptUnder(key: string): string {
  return aliases.get(key) ?? key;
}

/** Drops an entry and its other keys; true when there was one. */
function dropEntry(key: string): boolean {
  aliases.forEach((target, alias) => {
    if (target === key) aliases.delete(alias);
  });
  return entries.delete(key);
}

export function getCreation(key: string): CreationEntry | undefined {
  return entries.get(keptUnder(key));
}

/** `otherKeys`: the same entry under other keys (the record's reference, `creationKey(family, 'COMP-5')`). */
export function setCreation(key: string, entry: CreationEntry, otherKeys: string[] = []): void {
  const kept = keptUnder(key);
  cancelCreationClear(kept);
  entries.set(kept, entry);
  otherKeys.filter((other) => other !== kept).forEach((other) => aliases.set(other, kept));
  emit();
}

export function clearCreation(key: string): void {
  const kept = keptUnder(key);
  cancelCreationClear(kept);
  if (dropEntry(kept)) emit();
}

export function scheduleCreationClear(key: string): void {
  const kept = keptUnder(key);
  cancelCreationClear(kept);
  pendingClears.set(kept, setTimeout(() => {
    pendingClears.delete(kept);
    if (dropEntry(kept)) emit();
  }, 0));
}

export function cancelCreationClear(key: string): void {
  const kept = keptUnder(key);
  const pending = pendingClears.get(kept);
  if (pending === undefined) return;
  clearTimeout(pending);
  pendingClears.delete(kept);
}

export function subscribeCreations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget every entry. */
export function resetCreationStore(): void {
  pendingClears.forEach((pending) => clearTimeout(pending));
  pendingClears.clear();
  entries.clear();
  aliases.clear();
  emit();
}
