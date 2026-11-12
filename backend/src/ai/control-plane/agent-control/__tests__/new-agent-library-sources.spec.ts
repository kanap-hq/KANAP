import * as assert from 'node:assert/strict';
import {
  newAgentScopePolicy,
  normalizeKnowledgeSources,
  readAgentKnowledgeSources,
} from '../agent-control-definition.util';
import { helpdeskAgentDefaults, sreAgentDefaults } from '../../agent/agent-definition-defaults';
import type { AiAgentDefinition } from '../../entities/ai-agent-definition.entity';

/**
 * A new agent does not search the knowledge base, and cites no library, until an
 * administrator turns the search on and opens one, some or all of them. An agent saved
 * before keeps its setting.
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

async function testHelpdeskDefaultsSearchNoKnowledge() {
  const defaults = helpdeskAgentDefaults({ ticketingProviderKey: 'glpi' });
  assert.deepEqual(knowledgeBlock(defaults.scope_policy_json), { enabled: false, all_libraries: false, library_ids: [] });
  const read = readAgentKnowledgeSources(definitionWithScope(defaults.scope_policy_json));
  assert.equal(read.knowledgeEnabled, false);
  assert.deepEqual(read.knowledgeLibraryIds, []);
}

async function testSreDefaultsSearchNoKnowledgeAndKeepKanapData() {
  const defaults = sreAgentDefaults({ monitoringProviderKey: 'prtg' });
  assert.deepEqual(knowledgeBlock(defaults.scope_policy_json), { enabled: false, all_libraries: false, library_ids: [] });
  const read = readAgentKnowledgeSources(definitionWithScope(defaults.scope_policy_json));
  assert.equal(read.knowledgeEnabled, false);
  assert.deepEqual(read.knowledgeLibraryIds, []);
  assert.equal(read.kanapData.enabled, true);
}

async function testANewAgentWithoutKnowledgeSettingSearchesNoKnowledge() {
  const scope = newAgentScopePolicy({ mode: 'manual_safe_target', provider_key: 'mock' });
  assert.equal(scope.mode, 'manual_safe_target');
  assert.equal(scope.provider_key, 'mock');
  assert.deepEqual(knowledgeBlock(scope), { enabled: false, all_libraries: false, library_ids: [] });
  const read = readAgentKnowledgeSources(definitionWithScope(scope));
  assert.equal(read.knowledgeEnabled, false);
  assert.deepEqual(read.knowledgeLibraryIds, []);
  assert.equal(read.webEnabled, false);
  assert.equal(read.kanapData.enabled, false);
}

async function testANewAgentSearchesTheKnowledgeBaseOnlyWhenAsked() {
  const asked = newAgentScopePolicy({ knowledge_sources: { knowledge: { enabled: true } } });
  assert.deepEqual(knowledgeBlock(asked), { enabled: true, all_libraries: false, library_ids: [] });
  assert.equal(readAgentKnowledgeSources(definitionWithScope(asked)).knowledgeEnabled, true);

  for (const enabled of [undefined, false, null, 'true', 1]) {
    const scope = newAgentScopePolicy({ knowledge_sources: { knowledge: { enabled, library_ids: [LIBRARY_A] } } });
    assert.equal(knowledgeBlock(scope).enabled, false, `enabled ${String(enabled)}`);
    assert.equal(readAgentKnowledgeSources(definitionWithScope(scope)).knowledgeEnabled, false);
  }
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
  // An agent stored without any knowledge setting keeps searching every library it can access.
  for (const scope of [{ mode: 'manual_safe_target' }, null]) {
    const read = readAgentKnowledgeSources(definitionWithScope(scope));
    assert.equal(read.knowledgeEnabled, true);
    assert.equal(read.knowledgeLibraryIds, null);
  }
  // An agent stored with the search on and no library keeps searching none.
  const openNone = readAgentKnowledgeSources(definitionWithScope({
    knowledge_sources: { knowledge: { enabled: true, all_libraries: false, library_ids: [] } },
  }));
  assert.equal(openNone.knowledgeEnabled, true);
  assert.deepEqual(openNone.knowledgeLibraryIds, []);
}

async function testTheThreeChoicesAreSavedAsChosen() {
  const none = normalizeKnowledgeSources({ knowledge: { enabled: true, all_libraries: false, library_ids: [] } });
  assert.deepEqual(readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: none })).knowledgeLibraryIds, []);

  const some = normalizeKnowledgeSources({ knowledge: { enabled: true, all_libraries: false, library_ids: [LIBRARY_A, LIBRARY_B, LIBRARY_A] } });
  assert.deepEqual((some.knowledge as any).library_ids, [LIBRARY_A, LIBRARY_B]);
  assert.deepEqual(readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: some })).knowledgeLibraryIds, [LIBRARY_A, LIBRARY_B]);

  const all = normalizeKnowledgeSources({ knowledge: { enabled: true, all_libraries: true, library_ids: [LIBRARY_A] } });
  assert.equal(readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: all })).knowledgeLibraryIds, null);
}

// "All libraries" keeps the chosen libraries for a later return to "Chosen libraries", and the
// agent still searches and cites every library it can access.
async function testAllLibrariesKeepsTheChosenOnes() {
  const all = normalizeKnowledgeSources({ knowledge: { enabled: true, all_libraries: true, library_ids: [LIBRARY_A, LIBRARY_B, LIBRARY_A] } });
  assert.deepEqual(all.knowledge, { enabled: true, all_libraries: true, library_ids: [LIBRARY_A, LIBRARY_B] });
  const read = readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: all }));
  assert.equal(read.knowledgeEnabled, true);
  assert.equal(read.knowledgeLibraryIds, null);

  const back = normalizeKnowledgeSources({ knowledge: { ...(all.knowledge as Record<string, unknown>), all_libraries: false } });
  assert.deepEqual(readAgentKnowledgeSources(definitionWithScope({ knowledge_sources: back })).knowledgeLibraryIds, [LIBRARY_A, LIBRARY_B]);
}

async function run() {
  const tests = [
    testHelpdeskDefaultsSearchNoKnowledge,
    testSreDefaultsSearchNoKnowledgeAndKeepKanapData,
    testANewAgentWithoutKnowledgeSettingSearchesNoKnowledge,
    testANewAgentSearchesTheKnowledgeBaseOnlyWhenAsked,
    testANewAgentOpensAllLibrariesOnlyWhenAsked,
    testANewSreAgentKeepsItsKanapDataChoice,
    testAnAgentSavedBeforeKeepsItsLibraries,
    testTheThreeChoicesAreSavedAsChosen,
    testAllLibrariesKeepsTheChosenOnes,
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
