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
 *
 * A creation deleted by Cancel is remembered by every id the description editor may call with
 * (`deletedRecords`): the uuid Cancel knows, a reference the creation was given, and the address
 * the editor actually uses when the page opened the record by its reference (`PRJ-3`). The editor
 * then sends no lock release for that record. The lock went with it.
 */

export type CreationEntry = { token: string; returnTo: string };

const entries = new Map<string, CreationEntry>();
/** Another key of an entry (the record's reference) → the key the entry is kept under (its uuid). */
const aliases = new Map<string, string>();
const listeners = new Set<() => void>();
const pendingClears = new Map<string, ReturnType<typeof setTimeout>>();
/** Lowercased ids of records Cancel deleted in this tab. A reload forgets them. */
const deletedRecords = new Set<string>();
/**
 * An address the description editor calls with (`projects:prj-3`) → the uuid of the one creation
 * of that family. Separate from `aliases`: it must not make another record look like it is being
 * created. Copied into `deletedRecords` when that creation is deleted, then dropped with the entry.
 */
const editorAddresses = new Map<string, string>();

function bareId(key: string): string {
  const colon = key.indexOf(':');
  return (colon === -1 ? key : key.slice(colon + 1)).toLowerCase();
}

function rememberDeleted(id: string): void {
  const bare = id.trim().toLowerCase();
  if (bare) deletedRecords.add(bare);
}

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

/** Drops an entry, its other keys and the editor addresses remembered for it; true when there was one. */
function dropEntry(key: string): boolean {
  aliases.forEach((target, alias) => {
    if (target === key) aliases.delete(alias);
  });
  const id = bareId(key);
  editorAddresses.forEach((owner, address) => {
    if (owner === id) editorAddresses.delete(address);
  });
  return entries.delete(key);
}

/**
 * The description editor's address, when one record of this family is being created and the editor
 * calls it by another id (a project or a request opened as `PRJ-3` while Cancel holds the uuid).
 * With several creations, nothing is remembered: the address cannot be told apart.
 */
export function noteCreationAddress(family: string, entityId: string): void {
  const id = entityId.trim().toLowerCase();
  if (!family || !id) return;
  const prefix = `${family}:`;
  let match: string | undefined;
  for (const entryKey of entries.keys()) {
    if (!entryKey.startsWith(prefix)) continue;
    if (match) return;
    match = entryKey;
  }
  if (!match || bareId(match) === id) return;
  editorAddresses.set(`${prefix}${id}`, bareId(match));
}

/** Cancel deleted this record. Every id the editor may use for it is marked, before the entry goes. */
export function markRecordDeleted(recordId: string): void {
  const id = recordId.trim().toLowerCase();
  if (!id) return;
  rememberDeleted(id);
  for (const key of entries.keys()) {
    if (bareId(key) !== id) continue;
    aliases.forEach((target, alias) => {
      if (target === key) rememberDeleted(bareId(alias));
    });
  }
  editorAddresses.forEach((owner, address) => {
    if (owner === id) rememberDeleted(bareId(address));
  });
}

/** True when Cancel has deleted this record (uuid or the address the editor uses). */
export function isRecordDeleted(recordId: string | null | undefined): boolean {
  if (!recordId) return false;
  return deletedRecords.has(recordId.trim().toLowerCase());
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
  editorAddresses.clear();
  deletedRecords.clear();
  emit();
}
