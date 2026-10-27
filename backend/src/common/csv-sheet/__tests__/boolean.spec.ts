import * as assert from 'node:assert/strict';
import { formatCsvBoolean, parseCsvBoolean } from '../boolean';
import type { CsvLanguage } from '../types';

/**
 * The yes/no cell of the shared CSV layer: every language's word, the adjective forms a hand-made
 * file writes, whatever the case. Writing keeps the words the exports have always used.
 */

const YES = ['yes', 'oui', 'vrai', 'ja', 'wahr', 'sí', 'si', 'verdadero', 'true', '1', 'y', 'on', 't'];
const NO = ['no', 'non', 'faux', 'nein', 'falsch', 'falso', 'false', '0', 'n', 'off', 'f'];
const LANGUAGES: Array<[CsvLanguage, string, string]> = [
  ['en', 'yes', 'no'],
  ['fr', 'oui', 'non'],
  ['de', 'ja', 'nein'],
  ['es', 'sí', 'no'],
];

for (const word of YES) {
  assert.equal(parseCsvBoolean(word), true, word);
  assert.equal(parseCsvBoolean(`  ${word.toUpperCase()} `), true, `${word} in capitals, trimmed`);
}
for (const word of NO) {
  assert.equal(parseCsvBoolean(word), false, word);
  assert.equal(parseCsvBoolean(`  ${word.toUpperCase()} `), false, `${word} in capitals, trimmed`);
}
assert.equal(parseCsvBoolean(''), null);
assert.equal(parseCsvBoolean('   '), null);
for (const word of ['vraiment', 'falschlich', 'verdad', 'faux pas', 'yesno']) {
  assert.equal(parseCsvBoolean(word), undefined, word);
}
for (const [language, yes, no] of LANGUAGES) {
  assert.equal(formatCsvBoolean(true, language), yes, language);
  assert.equal(formatCsvBoolean(false, language), no, language);
}
console.log('boolean.spec: ok');
