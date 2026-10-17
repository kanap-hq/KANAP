/**
 * The order in which a technology's versions are shown: newest number first, then the labels
 * without a number, alphabetically.
 *
 * A label is read on its numeric prefix (digits separated by dots, an optional leading `v`), as
 * the vulnerability matching reads versions: `11.0` > `10.1` > `10.0` > `9.0` > `8.5`, `2019` >
 * `2016`, a missing segment counting as 0 (`9` = `9.0`). Equal numbers keep a stable order on
 * the whole label, the one with a qualifier first (`2016 SP3` before `2016`). Labels without a
 * numeric prefix (`Current`, `SQL Server 2019`) come last, in alphabetical order.
 */

/** The numeric segments of a label's prefix (`9.0.85` → [9, 0, 85], `19c` → [19]), or null. */
export function versionNumber(label: string | null | undefined): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)/i.exec(String(label ?? '').trim());
  if (!match) return null;
  const segments = match[1].split('.').map((part) => Number(part));
  return segments.every((n) => Number.isSafeInteger(n)) ? segments : null;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Comparator of the display order: negative when `a` comes before `b`. */
export function compareVersionLabels(a: string | null | undefined, b: string | null | undefined): number {
  const left = versionNumber(a);
  const right = versionNumber(b);
  if (left && !right) return -1;
  if (!left && right) return 1;
  const textA = String(a ?? '').trim();
  const textB = String(b ?? '').trim();
  if (!left || !right) return collator.compare(textA, textB) || (textA < textB ? -1 : textA > textB ? 1 : 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return collator.compare(textB, textA) || (textA > textB ? -1 : textA < textB ? 1 : 0);
}

/** A copy of the versions in display order. */
export function sortVersions<T extends { label: string | null }>(versions: readonly T[]): T[] {
  return [...versions].sort((a, b) => compareVersionLabels(a.label, b.label));
}
