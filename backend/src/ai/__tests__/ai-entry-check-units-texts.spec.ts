import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { quantityPriceExpectedWarning } from '../ai-write-texts';

/**
 * Kad's warning of the units an account expects says them in the words of the Budget
 * tab's dot (`ops:budgetTab.entryCheck`), in the four languages: the unit problem as the dot of a
 * column that lacks only a unit (`unitsConsolidationNamed`, from the account on), the entry mode with
 * the units as the dot of a column not built as quantity × price (`withUnits`), and the units as the
 * calculation lines name them (`budgetTab.lines.unitNames`), never by their codes.
 * It reads files outside its own folder (`frontend/src/locales/<lang>/ops.json`): `backendPath()`, and
 * the rule of `.github/scripts/ci-changes.sh` on those files.
 */

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;

function ops(language: string): any {
  return JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', language, 'ops.json'), 'utf8'));
}

function testSameWordsAsTheDot() {
  for (const language of LANGUAGES) {
    const texts = ops(language).budgetTab;
    const names = texts.lines.unitNames;
    const words = new Intl.ListFormat(language, { type: 'disjunction' }).format([names.people, names.days]);
    const account = '621100 - Temporary staff';
    // The dot of a column that lacks only a unit, from the account on.
    const lacking = String(texts.entryCheck.unitsConsolidationNamed).split('{{account}}')[1].replace('{{units}}', words);
    const units = quantityPriceExpectedWarning(language, 'units', account, false, ['people', 'days']);
    assert.ok(units.includes(`${account}${lacking}`), `${language}: the unit problem in the dot's words: ${units}`);
    // The dot of a column not built as quantity × price, with the units.
    const clause = String(texts.entryCheck.withUnits).split('{{reason}}')[1].replace('{{units}}', words);
    for (const kind of ['account', 'amounts'] as const) {
      const text = quantityPriceExpectedWarning(language, kind, account, false, ['people', 'days']);
      assert.ok(text.includes(clause), `${language} ${kind}: the units in the dot's words: ${text}`);
      if (language !== 'en') assert.doesNotMatch(text, /\b(people|days|pieces)\b/, `${language}: never the codes`);
    }
    // Without units, the warning is unchanged.
    assert.equal(quantityPriceExpectedWarning(language, 'account', account), quantityPriceExpectedWarning(language, 'account', account, false, null));
    assert.ok(!quantityPriceExpectedWarning(language, 'account', account).includes(clause), `${language}: no units, no clause`);
  }
  console.log('  Kad says the units as the Budget tab\'s dot, in the four languages: OK');
}

testSameWordsAsTheDot();
console.log('ai-entry-check-units-texts.spec: ok');
