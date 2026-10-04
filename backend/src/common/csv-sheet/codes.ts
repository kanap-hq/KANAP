export type CodeMatch =
  | { kind: 'blank' }
  | { kind: 'exact'; code: string }
  | { kind: 'stripped'; code: string }
  | { kind: 'none' }
  | { kind: 'ambiguous' };

/**
 * Match a code cell to a stored code. Exact text wins. A digits-only cell
 * with no exact match then matches the one stored digits-only code that is
 * the same once leading zeros are stripped. `0` and `000` are the same code.
 * Two stored codes that strip to the same value are ambiguous, not a guess.
 */
export function matchCode(cell: string, stored: readonly string[]): CodeMatch {
  const text = cell.trim();
  if (text === '') return { kind: 'blank' };
  if (stored.includes(text)) return { kind: 'exact', code: text };
  if (!/^\d+$/.test(text)) return { kind: 'none' };
  const needle = stripZeros(text);
  const matches: string[] = [];
  for (const code of stored) {
    if (!/^\d+$/.test(code)) continue;
    if (stripZeros(code) !== needle) continue;
    if (!matches.includes(code)) matches.push(code);
  }
  if (matches.length === 1) return { kind: 'stripped', code: matches[0] };
  if (matches.length > 1) return { kind: 'ambiguous' };
  return { kind: 'none' };
}

function stripZeros(digits: string): string {
  const stripped = digits.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}
