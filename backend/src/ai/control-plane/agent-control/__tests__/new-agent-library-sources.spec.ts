import * as assert from 'node:assert/strict';
import {
  newAgentScopePolicy,
  normalizeKnowledgeSources,
  readAgentKnowledgeSources,
} from '../agent-control-definition.util';
import { helpdeskAgentDefaults, sreAgentDefaults } from '../../agent/agent-definition-defaults';
import type { AiAgentDefinition } from '../../entities/ai-agent-definition.entity';

/**
 * A new agent cites no library until an administrator opens one, some or all of them.
 * An agent saved before keeps its setting.
 */

const LIBRARY_A = '11111111-1111-4111-8111-111111111111';
const LIBRARY_B = '22222222-2222-4222-8222-222222222222';

function definitionWithScope(scope: Record<string, unknown> | null): AiAgentDefinition {
  return { scope_policy_json: scope } as AiAgentDefinition;
}

function knowledgeBlock(scope: Record<string, unknown>): Record<string, unknown> {
  const sources = scope.knowledge_sources as Record<string, unknown>;
  return sources.knowledge as Record<string, unknown>;
}

async function testHelpdeskDefaultsOpenNoLibrary() {
  const defaults = helpdeskAgentDefaults({ ticketingProviderKey: 'glpi' });
  assert.deepEqual(knowledgeBlock(defaults.scope_policy_json), { enabled: true, all_libraries: false, library_ids: [] });
  assert.deepEqual(readAgentKnowledgeSources(definitionWithScope(defaults.scope_policy_json)).knowledgeLibraryIds, []);
}

async function testSreDefaultsOpenNoLibraryAndKeepKanapData() {
  const defaults = sreAgentDefaults({ monitoringProviderKey: 'prtg' });
  assert.deepEqual(knowledgeBlock(defaults.scope_policy_json), { enabled: true, all_libraries: false, library_ids: [] });
  const read = readAgentKnowledgeSources(definitionWithScope(defaults.scope_policy_json));
  assert.deepEqual(read.knowledgeLibraryIds, []);
  assert.equal(read.kanapData.enabled, true);
}

async function testANewAgentWithoutKnowledgeSettingOpensNoLibrary() {
  const scope = newAgentScopePolicy({ mode: 'manual_safe_target', provider_key: 'mock' });
  assert.equal(scope.mode, 'manual_safe_target');
  assert.equal(scope.provider_key, 'mock');
  assert.deepEqual(knowledgeBlock(scope), { enabled: true, all_libraries: false, library_ids: [] });
  const read = readAgentKnowledgeSources(definitionWithScope(scope));
  assert.equal(read.knowledgeEnabled, true);
  assert.deepEqual(read.knowledgeLibraryIds, []);
  assert.equal(read.webEnabled, false);
  assert.equal(read.kanapData.enabled, false);
}

async function testANewAgentOpensAllLibrariesOnlyWhenAsked() {
  const unstated = newAgentScopePolicy({ knowledge_sources: { knowledge: { enabled: true }, web: { enabled: true } } });
  assert.deepEqual(knowledgeBlock(unstated), { enabled: true, all_libraries: false, library_ids: [] });
  assert.equal((unstated.knowledge_sources as any).web.enabled, true);

  const all = newAgentScopePolicy({ knowledge_sources: { knowledge: { enabled: true, all_libraries: true } } });
  assert.equal(readAgentKnowledgeSources(definitionWithScope(all)).knowledgeLibraryIds, null);

  const chosen = newAgentScopePolicy({ knowledge_sources: { knowledge: { library_ids: [LIBRARY_A, 'not-a-library'] } } });
  assert.deepEqual(readAgentKnowledgeSources(definitionWithScope(chosen)).knowledgeLibraryIds, [LIBRARY_A]);
}

async function testANewSreAgentKeepsItsKanapDataChoice() {
  const scope = newAgentScopePolicy({
    knowledge_sources: {
      knowledge: { enabled: true, all_libraries: false, library_ids: [] },
      kanap_data: { enabled: true, domains: { applications: true, assets: false } },
    },
  });
  const read = readAgentKnowledgeSources(definitionWithScope(scope));
  assert.equal(read.kanapData.enabled, true);
  assert.equal(read.kanapData.domains.assets, false);
  assert.equal(read.kanapData.domains.applications, true);
}

async function testAnAgentSavedBeforeKeepsItsLibraries() {
  const explicitAll = definitionWithScope({
    knowledge_sources: { knowledge: { enabled: true, all_libraries: true, library_ids: [] } },
  });
  assert.equal(readAgentKnowledgeSources(explicitAll).knowledgeLibraryIds, null);
  // An agent stored without any knowledge setting keeps reading every library it can access.
  assert.equal(readAgentKnowledgeSources(definitionWithScope({ mode: 'manual_safe_target' })).knowledgeLibraryIds, null);
  assert.equal(readAgentKnowledgeSources(definitionWithScope(null)).knowledgeLibraryIds, null);
}

async function testTheThreeChoicesAreSavedAsChosen() {
  const none = normalizeKnowledgeSources({ knowledge: { enabled: true, all_libraries: false, library_ids: [] } });
  assert.deepEqual(readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: none })).knowledgeLibraryIds, []);

  const some = normalizeKnowledgeSources({ knowledge: { enabled: true, all_libraries: false, library_ids: [LIBRARY_A, LIBRARY_B, LIBRARY_A] } });
  assert.deepEqual((some.knowledge as any).library_ids, [LIBRARY_A, LIBRARY_B]);
  assert.deepEqual(readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: some })).knowledgeLibraryIds, [LIBRARY_A, LIBRARY_B]);

  const all = normalizeKnowledgeSources({ knowledge: { enabled: true, all_libraries: true, library_ids: [LIBRARY_A] } });
  assert.deepEqual(all.knowledge, { enabled: true, all_libraries: true, library_ids: [] });
  assert.equal(readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: all })).knowledgeLibraryIds, null);
}

async function run() {
  const tests = [
    testHelpdeskDefaultsOpenNoLibrary,
    testSreDefaultsOpenNoLibraryAndKeepKanapData,
    testANewAgentWithoutKnowledgeSettingOpensNoLibrary,
    testANewAgentOpensAllLibrariesOnlyWhenAsked,
    testANewSreAgentKeepsItsKanapDataChoice,
    testAnAgentSavedBeforeKeepsItsLibraries,
    testTheThreeChoicesAreSavedAsChosen,
  ];
  let failures = 0;
  for (const test of tests) {
    try {
      await test();
      console.log(`ok ${test.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${test.name}`, error);
    }
  }
  if (failures > 0) process.exit(1);
}

void run();
