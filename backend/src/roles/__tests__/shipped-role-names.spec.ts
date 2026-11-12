import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { SHIPPED_ROLE_NAMES, isReservedRoleName } from '../system-roles';

// The names the screen shows for the system and built-in roles (`roleLabel`) are reserved in the
// four languages. The backend copy holds the words of the locale files, and every role they name.

function testTheNamesAreTheScreens() {
  const keys = Object.fromEntries(Object.keys(SHIPPED_ROLE_NAMES.en).map((slug) => [slug, `roles.builtIn.${slug}.name`]));
  assertLocaleLabels('admin', keys, SHIPPED_ROLE_NAMES);
  const screen = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', 'en', 'admin.json'), 'utf8'));
  assert.deepEqual(Object.keys(SHIPPED_ROLE_NAMES.en).sort(), Object.keys(screen.roles.builtIn).sort(), 'every shipped role');
  for (const language of ['fr', 'de', 'es'] as const) {
    assert.deepEqual(Object.keys(SHIPPED_ROLE_NAMES[language]).sort(), Object.keys(SHIPPED_ROLE_NAMES.en).sort(), language);
  }
}

function testReservedWhateverTheCaseAndSpaces() {
  for (const name of ['Administrator', ' administrateur ', 'ADMINISTRADOR', 'Membre budget', 'kontakt', 'Budget member']) {
    assert.equal(isReservedRoleName(name), true, name);
  }
  for (const name of ['Analyst', 'Administrators of finance', 'Budget', '']) {
    assert.equal(isReservedRoleName(name), false, name);
  }
}

testTheNamesAreTheScreens();
testReservedWhateverTheCaseAndSpaces();
console.log('shipped-role-names.spec: ok');
