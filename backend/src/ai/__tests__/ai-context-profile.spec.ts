import * as assert from 'node:assert/strict';
import {
  filterProviderToolsForProfile,
  selectAiContextProfile,
  selectAiContextProfileForTurn,
} from '../ai-context-profile';
import type { AiProviderToolDef } from '../providers/ai-provider.types';

function tool(name: string): AiProviderToolDef {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
  };
}

async function testSelectsMinimalProfileForDirectGreeting() {
  const profile = selectAiContextProfile('salut');
  assert.equal(profile.name, 'minimal');
  assert.deepEqual(profile.toolNames, []);
}

async function testSelectsKnowledgeProfileForDocumentSearch() {
  const profile = selectAiContextProfile('Find documents about backups');
  assert.equal(profile.name, 'knowledge');
  assert.ok(profile.toolNames.includes('search_knowledge'));
  assert.ok(profile.toolNames.includes('get_document'));
  assert.ok(!profile.toolNames.includes('create_document'));
}

async function testSelectsWriteProfileForDocumentCreationFromEntity() {
  const profile = selectAiContextProfile('create a document from T-48');
  assert.equal(profile.name, 'write_document');
  assert.ok(profile.toolNames.includes('get_entity_detail'));
  assert.ok(profile.toolNames.includes('create_document'));
  assert.ok(!profile.toolNames.includes('web_search'));
}

async function testTaskWriteProfileIncludesBulkAssigneePreviewTool() {
  const profile = selectAiContextProfile('Réassigne les tâches de Friedrich EVA à Nicolas Bertrand.');
  assert.equal(profile.name, 'write_task');
  assert.ok(profile.toolNames.includes('update_task_assignee'));
  assert.ok(profile.toolNames.includes('update_task_assignees'));
  assert.ok(profile.toolNames.includes('prepare_mutation_plan'));
}

async function testSelectsExpectedProfilesForObservedWorkflows() {
  const cases = [
    ['Show me my overdue tasks', 'read_query'],
    ['Show current tasks', 'read_query'],
    ['How many tasks are in progress by status?', 'read_query'],
    ['quel est le dernier document modifié ?', 'knowledge'],
    ['et tu es capable de me dire ce qui a été modifié ?', 'entity_inspection'],
    ["sur la base de ce que tu connais de KANAP, quelle serait LA fonctionnalité à ajouter ou améliorer ?", 'read_query'],
    ['Quelles applications ont été modifiées récemment ?', 'read_query'],
    ['Summarize T-48', 'entity_inspection'],
    ['Create a task to invent sliced bread.', 'write_task'],
    ['Change T-48 status to done.', 'write_task'],
    ['Add a comment to T-48', 'write_task'],
    ['tu peux réassigner les 3 tâches de "Friedrich EVA" à Nicolas Bertrand ?', 'write_task'],
    ['Réassigne les tâches de Friedrich EVA à Nicolas Bertrand.', 'write_task'],
    ['tu peux passer la @T-49 en "en cours" ?', 'write_task'],
    ['tu peux passer la [T-49](/portfolio/tasks/123) en "en cours" ?', 'write_task'],
    ['Change [APP-41](/it/applications/41) status to retired.', 'write_business'],
    ['Publish DOC-151.', 'write_document'],
    ['Link APP-41 to PRJ-12.', 'write_relation'],
    ['Create something useful for onboarding', 'write_general'],
    ['Change ABC-12 status to done.', 'write_general'],
    ["cherche la météo d'obernai pour demain sur internet", 'web'],
    ['What is the latest Windows Server version?', 'web'],
    ['What is the weather forecast for tomorrow?', 'web'],
    // Forecast is a budget column: these are data questions.
    ['What is the total forecast of OPEX items for 2026?', 'read_query'],
    ['Top 5 OPEX items by forecast in 2026', 'read_query'],
  ] as const;

  for (const [prompt, expectedProfile] of cases) {
    assert.equal(selectAiContextProfile(prompt).name, expectedProfile, prompt);
  }
}

async function testFiltersProviderToolsForProfile() {
  const profile = selectAiContextProfile('cherche la meteo pour demain sur internet');
  const selected = filterProviderToolsForProfile(
    [
      tool('web_search'),
      tool('query_entities'),
      tool('create_task'),
    ],
    profile,
  );
  assert.deepEqual(selected.map((item) => item.name), ['web_search']);
}

async function testNonWebProfilesExposeAllKanapToolsButPrioritizeProfileTools() {
  const profile = selectAiContextProfile('Show me overdue tasks');
  const selected = filterProviderToolsForProfile(
    [
      tool('web_search'),
      tool('create_task'),
      tool('query_entities'),
      tool('search_all'),
    ],
    profile,
  );

  assert.deepEqual(
    selected.map((item) => item.name),
    ['search_all', 'query_entities', 'create_task'],
  );
}

async function testContinuationInheritsOpenWriteRequestProfile() {
  const profile = selectAiContextProfileForTurn([
    { role: 'user', content: 'tu peux ajouter un commentaire à la [T-49](/portfolio/tasks/123) ?' },
    { role: 'assistant', content: 'Je peux ajouter un commentaire à la tâche T-49. Quel contenu souhaitez-vous y inscrire ?' },
    { role: 'user', content: '"Jalopeno for the win"' },
  ]);

  assert.equal(profile.name, 'write_task');
  assert.ok(profile.toolNames.includes('add_task_comment'));
}

async function testPreviewCorrectionInheritsWriteRequestProfile() {
  const profile = selectAiContextProfileForTurn([
    { role: 'user', content: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard' },
    { role: 'assistant', content: 'Veuillez approuver les 21 previews ci-dessus et rejeter les 6 previews correspondantes aux tâches done.' },
    { role: 'user', content: "mais... là il n'y en avait qu'une !" },
  ]);

  assert.equal(profile.name, 'write_task');
  assert.ok(profile.toolNames.includes('prepare_mutation_plan'));
  assert.ok(profile.toolNames.includes('add_task_comment'));
}

async function testTargetSetCorrectionInheritsWriteRequestProfile() {
  const examples = [
    'Exclus les tâches déjà fermées.',
    "c'est une relance ! je ne veux mettre ce message qu'aux tâches qui sont encore en cours.",
  ];

  for (const prompt of examples) {
    const profile = selectAiContextProfileForTurn([
      { role: 'user', content: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard' },
      { role: 'assistant', content: 'Les 27 previews sont prêtes. Voulez-vous les approuver toutes pour exécution ?' },
      { role: 'user', content: prompt },
    ]);

    assert.equal(profile.name, 'write_task', prompt);
    assert.ok(profile.toolNames.includes('prepare_mutation_plan'), prompt);
    assert.ok(profile.toolNames.includes('add_task_comment'), prompt);
  }
}

async function testExplicitNewIntentDoesNotInheritOpenWriteRequestProfile() {
  const profile = selectAiContextProfileForTurn([
    { role: 'user', content: 'tu peux ajouter un commentaire à la [T-49](/portfolio/tasks/123) ?' },
    { role: 'assistant', content: 'Quel contenu souhaitez-vous y inscrire ?' },
    { role: 'user', content: 'Show me overdue tasks' },
  ]);

  assert.equal(profile.name, 'read_query');
  assert.ok(!profile.toolNames.includes('add_task_comment'));
}

async function testReadOnlyModifiedDocumentFollowUpKeepsInspectionTools() {
  const profile = selectAiContextProfileForTurn([
    { role: 'user', content: 'quel est le dernier document modifié ?' },
    {
      role: 'assistant',
      content: 'Le dernier document modifié est DOC-161 — "INT-5 - O365 to SAP - Specification".',
    },
    { role: 'user', content: 'et tu es capable de me dire ce qui a été modifié ?' },
  ]);

  assert.equal(profile.name, 'entity_inspection');
  assert.ok(profile.toolNames.includes('get_document'));
  assert.ok(!profile.toolNames.includes('update_document_content'));
}

async function run() {
  await testSelectsMinimalProfileForDirectGreeting();
  await testSelectsKnowledgeProfileForDocumentSearch();
  await testSelectsWriteProfileForDocumentCreationFromEntity();
  await testTaskWriteProfileIncludesBulkAssigneePreviewTool();
  await testSelectsExpectedProfilesForObservedWorkflows();
  await testFiltersProviderToolsForProfile();
  await testNonWebProfilesExposeAllKanapToolsButPrioritizeProfileTools();
  await testContinuationInheritsOpenWriteRequestProfile();
  await testPreviewCorrectionInheritsWriteRequestProfile();
  await testTargetSetCorrectionInheritsWriteRequestProfile();
  await testExplicitNewIntentDoesNotInheritOpenWriteRequestProfile();
  await testReadOnlyModifiedDocumentFollowUpKeepsInspectionTools();
}

void run();
