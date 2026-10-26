import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { previewText } from '../components/dataAccess/dataAccess';

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

  it.each([
    ['en', 1, 1, 1, 'With this access: 1 budget line, 1 editable; 1 contract.'],
    ['en', 2, 1, 2, 'With this access: 2 budget lines, 1 editable; 2 contracts.'],
    ['fr', 1, 1, 1, 'Avec cet accès : 1 ligne budgétaire, dont 1 modifiable ; 1 contrat.'],
    ['fr', 2, 1, 2, 'Avec cet accès : 2 lignes budgétaires, dont 1 modifiable ; 2 contrats.'],
  ])('words the data access preview in %s for %i line(s)', (lng, lines, editable, contracts, expected) => {
    const t = i18n.getFixedT(lng);
    expect(previewText({ lines, editable_lines: editable, contracts }, t, lng)).toBe(expected);
  });

  it.each([
    ['en', 1, 'Add their cost center (1)'],
    ['en', 2, 'Add their cost centers (2)'],
    ['fr', 1, 'Ajouter son centre (1)'],
    ['fr', 2, 'Ajouter ses centres (2)'],
  ])('words the owner centers action in %s for %i', (lng, count, expected) => {
    expect(i18n.t('admin:dataAccess.addTheirCenters', { lng, count })).toBe(expected);
  });

  it.each([
    ['fr', 1, 'Personne limitée : 1', 'Ligne budgétaire sans société : 1'],
    ['fr', 2, 'Personnes limitées : 2', 'Lignes budgétaires sans société : 2'],
    ['en', 1, 'Limited person: 1', 'Budget line without a company: 1'],
    ['en', 2, 'Limited people: 2', 'Budget lines without a company: 2'],
  ])('words the administration counters in %s for %i', (lng, count, limited, withoutCompany) => {
    expect(i18n.t('admin:dataAccess.counters.limited', { lng, count, value: String(count) })).toBe(limited);
    expect(i18n.t('admin:dataAccess.counters.withoutCompany', { lng, count, value: String(count) })).toBe(withoutCompany);
  });
});
