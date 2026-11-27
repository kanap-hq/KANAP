import type { CsvLanguage } from '../common/csv-sheet';
import { accentFreeKey } from '../common/name-matching';
import { ACCOUNT_EXPECTED_UNITS, type AccountExpectedUnit, expectedUnitsSetting } from './account.entity';

/**
 * The expected units of an account as people read and write them: the words of a
 * calculation line's unit on the budget tab (`ops:budgetTab.lines.unitNames`, compared with the
 * locales by `ai-code-names.spec.ts` through Kad's list), in the four languages.
 */
export const EXPECTED_UNIT_LABELS: Readonly<Record<CsvLanguage, Readonly<Record<AccountExpectedUnit, string>>>> = {
  en: { people: 'people', days: 'days', pieces: 'pieces' },
  fr: { people: 'personnes', days: 'jours', pieces: 'pièces' },
  de: { people: 'Personen', days: 'Tage', pieces: 'Stück' },
  es: { people: 'personas', days: 'días', pieces: 'piezas' },
};

/** Each unit's code and its word in every language, accents and case aside. */
const UNIT_BY_WORD = new Map<string, AccountExpectedUnit>(ACCOUNT_EXPECTED_UNITS.flatMap((unit) => [
  [unit, unit] as const,
  ...Object.values(EXPECTED_UNIT_LABELS).map((labels) => [accentFreeKey(labels[unit]), unit] as const),
]));

/** The units in a file's language, in the tab's order, joined by ", " ('' without units). */
export function formatExpectedUnitsCell(units: readonly string[] | null | undefined, language: CsvLanguage): string {
  return (expectedUnitsSetting(units) ?? []).map((unit) => EXPECTED_UNIT_LABELS[language][unit]).join(', ');
}

/**
 * A cell of units: the words separated by commas or semicolons, each a unit's code or its word in
 * any of the four languages. `units` null for a blank cell; `unknown` names the first word that is
 * no unit.
 */
export function parseExpectedUnitsCell(raw: string): { units: AccountExpectedUnit[] | null } | { unknown: string } {
  const words = raw.split(/[,;]/).map((word) => word.trim()).filter(Boolean);
  const units: AccountExpectedUnit[] = [];
  for (const word of words) {
    const unit = UNIT_BY_WORD.get(accentFreeKey(word));
    if (!unit) return { unknown: word };
    units.push(unit);
  }
  return { units: expectedUnitsSetting(units) };
}

/** The units joined by "or" in a language, as a sentence names them ("people or days"). */
export function expectedUnitsInWords(units: readonly string[], language: CsvLanguage): string {
  const words = (expectedUnitsSetting(units) ?? []).map((unit) => EXPECTED_UNIT_LABELS[language][unit]);
  return new Intl.ListFormat(language, { type: 'disjunction' }).format(words);
}
