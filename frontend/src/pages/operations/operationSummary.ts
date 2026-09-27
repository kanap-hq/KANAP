import type { TFunction } from 'i18next';

/** "Copied 12 items. 3 items skipped." with plural forms; counts at zero are left out, except the first. */
export function operationSummary(t: TFunction, doneKey: string, done: number, skipped: number, errors: number): string {
  const parts = [t(doneKey, { count: done })];
  if (skipped > 0) parts.push(t('operations.results.skipped', { count: skipped }));
  if (errors > 0) parts.push(t('operations.results.failed', { count: errors }));
  return parts.join(' ');
}
