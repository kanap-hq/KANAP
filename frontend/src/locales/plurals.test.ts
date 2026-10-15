import { describe, expect, it } from 'vitest';
import i18n from '../i18n';

const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true });

function strings(tree: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof tree === 'string') return [[path.join('.'), tree]];
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => strings(value, [...path, key]));
}

// "item(s)", "élément(s)", "Element(e)", "Datei(en)", "selección(es)": a count gets real plural
// forms (`_one` / `_other`), and a text without a count is worded without the parenthesis.
const PARENTHESISED_PLURAL = /\p{L}\((?:s|e|es|en|n|x)\)/u;

describe('locale plurals', () => {
  it('holds no parenthesised plural in any locale', () => {
    const offenders = Object.entries(localeFiles).flatMap(([file, module]) =>
      strings(module.default).filter(([, text]) => PARENTHESISED_PLURAL.test(text)).map(([key, text]) => `${file} ${key}: ${text}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['fr', 1, '1 élément supprimé'],
    ['fr', 3, '3 éléments supprimés'],
    ['en', 1, 'Deleted 1 item'],
    ['en', 2, 'Deleted 2 items'],
    ['de', 1, '1 Element gelöscht'],
    ['es', 2, '2 elementos eliminados'],
  ])('words the bulk deletion message in %s for %i', (lng, count, expected) => {
    expect(i18n.t('common:delete.successAll', { lng, count })).toBe(expected);
  });
});
