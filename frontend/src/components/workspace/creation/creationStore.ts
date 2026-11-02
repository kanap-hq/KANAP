/**
 * The records being created in this tab: per record, the creation token the create route handed
 * back and the address the creation started from. In memory only (module state): a reload loses
 * it, and the record then stays as any other.
 *
 * A record page clears its entry when the person leaves it (`useRecordCreation`). The clear waits
 * one tick, so React's development double mount (StrictMode) does not drop an entry it remounts.
 */

export type CreationEntry = { token: string; returnTo: string };

const entries = new Map<string, CreationEntry>();
const listeners = new Set<() => void>();
const pendingClears = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function creationKey(family: string, recordId: string): string {
  return `${family}:${recordId.toLowerCase()}`;
}

export function getCreation(key: string): CreationEntry | undefined {
  return entries.get(key);
}

export function setCreation(key: string, entry: CreationEntry): void {
  cancelCreationClear(key);
  entries.set(key, entry);
  emit();
}

export function clearCreation(key: string): void {
  cancelCreationClear(key);
  if (entries.delete(key)) emit();
}

export function scheduleCreationClear(key: string): void {
  cancelCreationClear(key);
  pendingClears.set(key, setTimeout(() => {
    pendingClears.delete(key);
    if (entries.delete(key)) emit();
  }, 0));
}

export function cancelCreationClear(key: string): void {
  const pending = pendingClears.get(key);
  if (pending === undefined) return;
  clearTimeout(pending);
  pendingClears.delete(key);
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
  emit();
}
