import { CsvLanguage } from './types';

/** Yes and no as each language writes them in a file. */
const WORDS: Record<CsvLanguage, readonly [string, string]> = {
  en: ['yes', 'no'],
  fr: ['oui', 'non'],
  de: ['ja', 'nein'],
  es: ['sí', 'no'],
};

// Read whatever the screen language: yes or no of every language, the adjective forms a hand-made
// file writes (vrai, wahr, verdadero), and the forms older files wrote. Spanish verdadero and
// falso carry no accent.
const TRUE = new Set(['yes', 'oui', 'vrai', 'ja', 'wahr', 'sí', 'si', 'verdadero', 'true', '1', 'y', 'on', 't']);
const FALSE = new Set(['no', 'non', 'faux', 'nein', 'falsch', 'falso', 'false', '0', 'n', 'off', 'f']);

/** A yes or no cell, in the file's language. */
export function formatCsvBoolean(value: boolean, language: CsvLanguage): string {
  return WORDS[language][value ? 0 : 1];
}

/**
 * A yes or no cell: null when it is blank, undefined when it is neither. Yes and no are read in
 * every language, with vrai/faux, wahr/falsch, verdadero/falso, true/false, 1/0, y/n, on/off and
 * t/f, whatever the case. Writing keeps the words of `WORDS`.
 */
export function parseCsvBoolean(raw: string): boolean | null | undefined {
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  if (TRUE.has(text)) return true;
  if (FALSE.has(text)) return false;
  return undefined;
}
