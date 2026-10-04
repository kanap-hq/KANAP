/** Lower case, with spaces, underscores and hyphens removed, so `Item Number` and `item-number` match `item_number`. */
export function looseKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** The same tolerance, with one underscore left between parts (`Budget 2027` becomes `budget_2027`). */
export function separatorNormalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '_').replace(/^_+|_+$/g, '');
}
