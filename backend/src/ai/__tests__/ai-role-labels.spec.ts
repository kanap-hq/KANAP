import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { RESOURCES } from '../../permissions/permissions.service';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { backendPath } from '../../common/__tests__/backend-root';
import { PERMISSION_GROUPS } from '../../../../frontend/src/pages/admin/rolePermissionGroups';
import {
  AI_PERMISSION_LEVEL_LABELS,
  AI_RESOURCE_LABELS,
  AI_SCREEN_RESOURCES,
  aiPermissionLevelLabel,
  aiResourceLabel,
} from '../ai-role-labels';

// The rights and levels of Admin › Roles, as Plaid and the MCP server name them: the words of the
// screen's locale files, never a second wording (Plaid L7, lot D).

function testTheWordsAreTheScreens() {
  const resourceKeys = Object.fromEntries(Object.keys(AI_RESOURCE_LABELS.en).map((resource) => [resource, `roles.resources.${resource}`]));
  assertLocaleLabels('admin', resourceKeys, AI_RESOURCE_LABELS);
  const levelKeys = Object.fromEntries(Object.keys(AI_PERMISSION_LEVEL_LABELS.en).map((level) => [level, `roles.levels.${level}`]));
  assertLocaleLabels('admin', levelKeys, AI_PERMISSION_LEVEL_LABELS);

  // Every right the screen names has its word here, and no other.
  const screen = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', 'en', 'admin.json'), 'utf8'));
  assert.deepEqual(Object.keys(AI_RESOURCE_LABELS.en).sort(), Object.keys(screen.roles.resources).sort());
  for (const language of ['fr', 'de', 'es'] as const) {
    assert.deepEqual(Object.keys(AI_RESOURCE_LABELS[language]).sort(), Object.keys(AI_RESOURCE_LABELS.en).sort(), language);
  }
  // The rights of the server the screen does not show: `projects` only.
  assert.deepEqual(RESOURCES.filter((resource) => aiResourceLabel(resource, 'en') === null), ['projects']);
}

/** Plaid reads the rights the Roles screen shows, and no other (Plaid L7, lot E). */
function testTheRightsAreTheScreens() {
  const screen = Object.values(PERMISSION_GROUPS).flat() as string[];
  assert.deepEqual([...AI_SCREEN_RESOURCES].sort(), [...screen].sort(), 'the rights of the Roles screen');
  assert.equal(new Set(AI_SCREEN_RESOURCES).size, AI_SCREEN_RESOURCES.length, 'each once');
  assert.deepEqual(AI_SCREEN_RESOURCES, RESOURCES.filter((resource) => screen.includes(resource)), 'in the server order');
}

function testTheLanguageOfThePerson() {
  assert.equal(aiResourceLabel('portfolio_projects', 'fr'), 'Projets du portefeuille');
  assert.equal(aiResourceLabel('budget', 'es'), 'Presupuesto');
  assert.equal(aiPermissionLevelLabel('admin', 'fr'), 'Administrateur');
  assert.equal(aiPermissionLevelLabel('contributor', 'de'), 'Mitwirkender');
  assert.equal(aiPermissionLevelLabel('member', 'es'), 'Miembro');
  // No profile language: the four words, for the answer to pick the person's.
  assert.equal(aiResourceLabel('budget', null), 'en: Budget; fr: Budget; de: Budget; es: Presupuesto');
  assert.equal(aiPermissionLevelLabel('reader', null), 'en: Reader; fr: Lecteur; de: Leser; es: Lector');
}

function run() {
  testTheWordsAreTheScreens();
  testTheRightsAreTheScreens();
  testTheLanguageOfThePerson();
  console.log('ai-role-labels.spec: ok');
}

run();
