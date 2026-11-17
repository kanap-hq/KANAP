import { BadRequestException } from '@nestjs/common';
import { MATCH_LIST_LIMIT, foldKey } from '../name-matching';

/** The longest value and column an undone match may name, as the budget file's choices. */
const VALUE_MAX = 200;
const COLUMN_MAX = 120;

/**
 * The matches the person undid on an import screen (lot I3 of 26.11.9), sent as the `unmatched` field
 * of the form, a JSON list of `{ column, value }`, never in the address: they hold values of the file.
 * The load receives the same list as the check it follows. As many as a result lists matches at most;
 * a value or a column too long, or anything else, is refused.
 */
export function csvUnmatched(raw: unknown): Array<{ column: string; value: string }> {
  if (raw === undefined || raw === null || raw === '') return [];
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new BadRequestException('The undone matches are not valid.');
    }
  }
  if (!Array.isArray(value) || value.length > MATCH_LIST_LIMIT) throw new BadRequestException('The undone matches are not valid.');
  const undone: Array<{ column: string; value: string }> = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    if (typeof item.column !== 'string' || typeof item.value !== 'string' || item.column.trim() === '' || item.value.trim() === ''
      || item.column.length > COLUMN_MAX || item.value.length > VALUE_MAX) {
      throw new BadRequestException('The undone matches are not valid.');
    }
    const key = `${item.column}\u0000${foldKey(item.value)}`;
    if (!seen.has(key)) undone.push({ column: item.column, value: item.value.trim() });
    seen.add(key);
  }
  return undone;
}
