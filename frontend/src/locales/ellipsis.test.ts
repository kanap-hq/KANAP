import { describe, expect, it } from 'vitest';

const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true });

function strings(tree: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof tree === 'string') return [[path.join('.'), tree]];
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => strings(value, [...path, key]));
}

// Texts still written with three dots while the CSV and grid locale changes are in flight.
// Remove an entry once its text uses the ellipsis character.
const PENDING: ReadonlySet<string> = new Set([
  'grid.json loadingOoo',
  'grid.json searchOoo',
  'grid.json filterOoo',
  'common.json csv.andMoreErrors2_one',
  'common.json csv.andMoreErrors2_other',
  'common.json csv.andMoreWarnings_one',
  'common.json csv.andMoreWarnings_other',
]);

describe('locale ellipses', () => {
  it('writes the ellipsis character, never three dots, in every locale', () => {
    const offenders = Object.entries(localeFiles).flatMap(([file, module]) =>
      strings(module.default)
        .filter(([key, text]) => text.includes('...') && !PENDING.has(`${file.split('/').pop()} ${key}`))
        .map(([key, text]) => `${file} ${key}: ${text}`),
    );
    expect(offenders).toEqual([]);
  });
});
