import { describe, expect, it } from 'vitest';

// The three words of the settings vocabulary: Administration (the organisation), Settings (a
// module), My account (the person). Menus and titles name them the same way in every language.
const bundles = import.meta.glob<Record<string, unknown>>('./{en,fr,de,es}/*.json', { import: 'default', eager: true });
const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;
type Language = (typeof LANGUAGES)[number];

function value(language: Language, namespace: string, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundles[`./${language}/${namespace}.json`]);
}

function strings(tree: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof tree === 'string') return [[path.join('.'), tree]];
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, child]) => strings(child, [...path, key]));
}

function valuesOf(language: Language): Array<[string, string]> {
  return Object.entries(bundles)
    .filter(([file]) => file.startsWith(`./${language}/`))
    .flatMap(([file, bundle]) => strings(bundle).map(([key, text]): [string, string] => [`${file.slice(5, -5)}:${key}`, text]));
}

const ADMINISTRATION: Record<Language, string> = { en: 'Administration', fr: 'Administration', de: 'Administration', es: 'Administración' };
const SETTINGS: Record<Language, string> = { en: 'Settings', fr: 'Paramètres', de: 'Einstellungen', es: 'Configuración' };
const MY_ACCOUNT: Record<Language, string> = { en: 'My account', fr: 'Mon compte', de: 'Mein Konto', es: 'Mi cuenta' };
const CLEAR_COLUMN: Record<Language, string> = {
  en: 'Clear a budget column',
  fr: 'Vider une colonne budgétaire',
  de: 'Budgetspalte leeren',
  es: 'Vaciar una columna presupuestaria',
};

const EXPECTED: Array<{ namespace: string; key: string; words: Record<Language, string> }> = [
  { namespace: 'nav', key: 'workspaces.admin', words: ADMINISTRATION },
  { namespace: 'nav', key: 'userMenu.myProfile', words: MY_ACCOUNT },
  { namespace: 'settings', key: 'pageTitle', words: MY_ACCOUNT },
  { namespace: 'nav', key: 'breadcrumbs.settings', words: MY_ACCOUNT },
  { namespace: 'nav', key: 'sidebar.ops.administration', words: SETTINGS },
  { namespace: 'ops', key: 'operations.title', words: SETTINGS },
  { namespace: 'ops', key: 'operations.cards.resetColumnTitle', words: CLEAR_COLUMN },
];

// Spanish "ajustes" also means adjustments: the overrides of a planning scenario keep it.
const SPANISH_ADJUSTMENTS = /^portfolio:planning\.roadmap\./;

describe('settings vocabulary', () => {
  for (const { namespace, key, words } of EXPECTED) {
    it(`names ${namespace}:${key} with the vocabulary in the four languages`, () => {
      expect(Object.fromEntries(LANGUAGES.map((language) => [language, value(language, namespace, key)]))).toEqual(words);
    });
  }

  it('writes no "Admin >" path in English', () => {
    expect(valuesOf('en').filter(([, text]) => /\bAdmin ?(>|›|→)/.test(text))).toEqual([]);
  });

  it('writes no plural "réglages" in French', () => {
    expect(valuesOf('fr').filter(([, text]) => /\bréglages\b/i.test(text))).toEqual([]);
  });

  it('writes no "ajustes" for settings in Spanish', () => {
    expect(valuesOf('es').filter(([key, text]) => /\bajustes\b/i.test(text) && !SPANISH_ADJUSTMENTS.test(key))).toEqual([]);
  });

  it('keeps the words that name something else', () => {
    // The section of the IT landscape menu that groups Locations and Technologies.
    expect(value('fr', 'nav', 'sidebar.it.sections.referenceData')).toBe('Référentiels');
    // A level of a right, a shipped role, the administration zones of the IT landscape.
    expect(value('en', 'admin', 'roles.levels.admin')).toBe('Admin');
    expect(value('en', 'admin', 'roles.builtIn.agentAdmin.name')).toBe('Agent Admin');
    expect(value('en', 'nav', 'sidebar.it.administrationView')).toBe('Administration zones');
  });
});
