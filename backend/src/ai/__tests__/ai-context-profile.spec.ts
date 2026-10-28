import * as assert from 'node:assert/strict';
import {
  budgetLineRefFromUrl,
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

function testIncidentWritesChooseTheBusinessRecordTools() {
  for (const prompt of [
    'Crée un incident sur la messagerie',
    'Crée un incident INC-7 sur la messagerie',
    'Mets à jour l’incident INC-7',
    'Clos INC-7',
    'Ferme INC-7',
    'Passe INC-7 en résolu',
    'Ouvre un incident sur la messagerie',
    'Déclare un incident de messagerie',
    'Signale un incident de messagerie',
    'Open an incident on the mail server',
    'Report an incident on the mail server',
    'Log an incident on the mail server',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'write_business', prompt);
    assert.ok(profile.toolNames.includes('create_business_record'), `${prompt}: create tool`);
    assert.ok(profile.toolNames.includes('update_business_record'), `${prompt}: update tool`);
    assert.equal(profile.toolNames.includes('update_task_status'), false, `${prompt}: never a task write`);
  }

  // The journal and the links have their own tools in the business profile.
  for (const prompt of [
    'Ajoute une note à INC-7',
    'Note dans le journal de l’incident de messagerie : bascule effectuée',
    'Ajoute une note sur l’incident mail',
    'Log a note on the mail incident',
    'Lie APP-2 à INC-3',
    'lie l’incident INC-3 à l’application APP-2',
    'Rattache APP-2 à INC-3',
    'Associe APP-2 à INC-3',
    'Ajoute l’incident INC-3 à l’actif AST-12',
    'Link APP-2 to INC-3',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'write_business', prompt);
    assert.ok(profile.toolNames.includes('add_incident_note'), `${prompt}: note tool`);
    assert.ok(profile.toolNames.includes('update_incident_links'), `${prompt}: link tool`);
  }

  // The administrator's reopen, cancel and confidentiality actions live in the business profile.
  for (const prompt of [
    'Rouvre INC-3',
    'Annule INC-3',
    'Reopen INC-3',
    'Cancel INC-3',
    'Lève la confidentialité de INC-3',
    'Rends INC-3 public',
    'Rends INC-3 plus confidentiel',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'write_business', prompt);
    assert.ok(profile.toolNames.includes('change_incident_state'), `${prompt}: state tool`);
    assert.ok(profile.toolNames.includes('set_incident_confidentiality'), `${prompt}: confidentiality tool`);
  }

  // Without an INC reference, a confidentiality phrase is not a confirmed write.
  for (const prompt of ['plus confidentiel', 'lève la confidentialité']) {
    const profile = selectAiContextProfile(prompt);
    assert.notEqual(profile.promptMode, 'write', prompt);
    assert.equal(profile.toolNames.includes('set_incident_confidentiality'), false, prompt);
  }

  // A follow-up task on an incident goes to the task profile, before the incident intent.
  for (const prompt of [
    'Crée une tâche pour suivre l’incident de messagerie',
    'Create a task to follow the mail incident',
    'Crée une tâche sur INC-7',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'write_task', prompt);
    assert.ok(profile.toolNames.includes('create_task'), `${prompt}: create task`);
    assert.equal(profile.toolNames.includes('update_incident_links'), false, `${prompt}: not a link write`);
  }

  // A status word in a question is a read, never a write.
  for (const prompt of [
    'INC-3 est-il clos ?',
    'Quand INC-3 a-t-il été résolu ?',
    'Qui a fermé INC-3 ?',
    'INC-3 a-t-il été rouvert ?',
    'Is INC-3 closed?',
    'When was INC-3 resolved?',
    'Who closed INC-3?',
    'Has INC-3 been reopened?',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'entity_inspection', prompt);
    assert.equal(profile.toolNames.includes('update_business_record'), false, `${prompt}: no incident write`);
    assert.equal(profile.toolNames.includes('update_incident_links'), false, `${prompt}: no link write`);
    assert.equal(profile.toolNames.includes('change_incident_state'), false, `${prompt}: no state write`);
    assert.equal(profile.toolNames.includes('set_incident_confidentiality'), false, `${prompt}: no confidentiality write`);
  }
}

function testIncidentReadsAndLinkVerbsFromReview() {
  // The French unlink verbs (and their infinitives) choose the incident link tool.
  for (const prompt of [
    'Délie APP-2 de INC-3',
    'Retire APP-2 de INC-3',
    'Enlève AST-12 de INC-3',
    'Détache APP-2 de INC-3',
    'Délier APP-2 de INC-3',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'write_business', prompt);
    assert.ok(profile.toolNames.includes('update_incident_links'), `${prompt}: link tool`);
  }

  // Reading the journal, the notes or the record is not a write.
  for (const prompt of [
    'Montre le journal de INC-3',
    'Show the log of INC-3',
    'Quelles notes sur INC-3',
    'Affiche les notes de INC-3',
    'Ouvre la fiche de l’incident INC-3',
    'Open the incident INC-3',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.notEqual(profile.promptMode, 'write', prompt);
    assert.equal(profile.toolNames.includes('add_incident_note'), false, `${prompt}: no note write`);
    assert.equal(profile.toolNames.includes('update_incident_links'), false, `${prompt}: no link write`);
  }

  // A creation followed by a link stays a business write.
  const plan = selectAiContextProfile('Crée l’incident puis lie-le à AST-12 et APP-3');
  assert.equal(plan.name, 'write_business');
  assert.ok(plan.toolNames.includes('create_business_record'));
  assert.ok(plan.toolNames.includes('update_incident_links'));

  // "Résous INC-3" changes the incident status.
  const resolved = selectAiContextProfile('Résous INC-3');
  assert.equal(resolved.name, 'write_business');
  assert.ok(resolved.toolNames.includes('update_business_record'));

  // Closing a task reference goes to the task tools.
  for (const prompt of ['Clos la tâche T-4', 'Clos le ticket T-4']) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'write_task', prompt);
    assert.ok(profile.toolNames.includes('update_task_status'), `${prompt}: task status tool`);
    assert.equal(profile.toolNames.includes('update_business_record'), false, `${prompt}: not an incident write`);
  }

  // No tool closes a GLPI ticket, so the message stays a read request.
  assert.notEqual(selectAiContextProfile('Ferme le ticket GLPI 123').promptMode, 'write');
}

function testDeleteRecordFollowsTheFamilyWriteProfiles() {
  for (const prompt of [
    'Supprime la tâche T-42',
    'Supprime le contact Camille Roux',
    'Supprime la location LOC-1',
    'Supprime la ligne OPEX BL-42',
    "Supprime l'interface INT-7",
    'Supprime la connexion CON-4',
    'Supprime le document DOC-12',
  ]) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.promptMode, 'write', prompt);
    assert.ok(profile.toolNames.includes('delete_record'), prompt);
  }
  // The financial write profile can delete a line too.
  const financial = selectAiContextProfile('Update the notes of [line](/ops/budget/BL-42)');
  assert.equal(financial.name, 'write_financial');
  assert.ok(financial.toolNames.includes('delete_record'));
  console.log('  delete_record follows the task, contact, location, document, budget line, connection and interface write profiles: OK');
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

async function testTechnologyReferencesAndRelatedRecords() {
  const listing = selectAiContextProfile('Which applications use PostgreSQL?');
  assert.equal(listing.name, 'read_query');
  assert.ok(listing.toolNames.includes('get_entity_context'), 'a read question can open the related records of a record it names');

  for (const prompt of ['Summarize TEC-3', 'What runs [TEC-3](/it/technologies/0b6f8f2c-1f2a-4c1e-9f55-2f8a3c1d7e01)?']) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.name, 'entity_inspection', prompt);
    assert.ok(profile.toolNames.includes('get_entity_context'), prompt);
  }

  // Technologies have no write: a write request on one stays generic, never a business write.
  assert.equal(selectAiContextProfile('Update the lifecycle of TEC-3').name, 'write_general');
}

// The maintainer's conversation on dev: Plaid offers to list the users, the reply "oui" got no tool.
const DATA_ACCESS_CONVERSATIONS = [
  {
    question: 'Qui a un accès limité aux données et à quoi ?',
    answer: "Je ne lis pas l'accès aux données : il se règle dans Administration › Accès aux données.\n\n"
      + 'Je peux en revanche lister les utilisateurs et leurs rôles… Dites-moi si vous voulez que je le fasse.',
    replies: ['oui', 'Oui.', 'ok', 'vas-y', "d'accord", 'oui, vas-y'],
  },
  {
    question: 'Who has limited data access, and to what?',
    answer: 'I do not read data access: it is set in Administration › Data access.\n\n'
      + 'I can list the users and their roles instead. Let me know if you want me to.',
    replies: ['yes', 'ok', 'go ahead', 'yes please'],
  },
  {
    question: 'Wer hat eingeschränkten Datenzugriff und worauf?',
    answer: 'Den Datenzugriff lese ich nicht: Er wird unter Administration › Datenzugriff eingestellt.\n\n'
      + 'Ich kann stattdessen die Benutzer und ihre Rollen auflisten. Soll ich das tun?',
    replies: ['ja', 'ok', 'ja, bitte'],
  },
  {
    question: '¿Quién tiene acceso limitado a los datos y a qué?',
    answer: 'No leo el acceso a los datos: se configura en Administración › Acceso a los datos.\n\n'
      + 'Puedo listar los usuarios y sus roles. ¿Quiere que lo haga?',
    replies: ['sí', 'ok', 'vale', 'adelante'],
  },
];

async function testAcceptingAReadOfferKeepsReadTools() {
  for (const conversation of DATA_ACCESS_CONVERSATIONS) {
    for (const reply of conversation.replies) {
      const profile = selectAiContextProfileForTurn([
        { role: 'user', content: conversation.question },
        { role: 'assistant', content: conversation.answer },
        { role: 'user', content: reply },
      ]);
      assert.equal(profile.name, 'read_query', reply);
      assert.ok(profile.toolNames.includes('query_entities'), reply);
    }
  }

  // A greeting, then an offer: the reply takes the profile of what was offered.
  const afterGreeting = selectAiContextProfileForTurn([
    { role: 'user', content: 'bonjour' },
    { role: 'assistant', content: 'Bonjour ! Voulez-vous que je liste vos tâches en retard ?' },
    { role: 'user', content: 'oui' },
  ]);
  assert.equal(afterGreeting.name, 'read_query');

  // A write word that describes the data does not turn the accepted read into a write.
  const describedWrite = selectAiContextProfileForTurn([
    { role: 'user', content: 'Qui a un accès limité aux données et à quoi ?' },
    {
      role: 'assistant',
      content: 'Je peux lister les utilisateurs et leurs rôles, qui disent qui peut modifier le budget. Dites-moi si vous voulez que je le fasse.',
    },
    { role: 'user', content: 'oui' },
  ]);
  assert.equal(describedWrite.promptMode, 'read');
}

async function testAcceptingAWriteOfferGetsTheWriteProfile() {
  // The write the assistant proposed after a read: the confirmation is a write (previews, approval).
  const profile = selectAiContextProfileForTurn([
    { role: 'user', content: 'Liste mes tâches en retard' },
    { role: 'assistant', content: 'Deux tâches sont en retard : T-4 et T-7.\n\nVoulez-vous que je passe T-4 en cours ?' },
    { role: 'user', content: 'oui' },
  ]);
  assert.equal(profile.name, 'write_task');
  assert.ok(profile.toolNames.includes('update_task_status'));

  // The confirmation of an open write request keeps its profile, as before.
  const confirmation = selectAiContextProfileForTurn([
    { role: 'user', content: 'Crée une tâche pour relancer le fournisseur' },
    { role: 'assistant', content: 'Je prépare la tâche « Relancer le fournisseur ». Voulez-vous que je la crée ?' },
    { role: 'user', content: 'oui' },
  ]);
  assert.equal(confirmation.name, 'write_task');
  assert.match(confirmation.reason, /continuation of previous write request/);
}

async function testShortAnswersToAQuestionKeepTheirProfile() {
  // A name: the inspection asked for continues.
  const name = selectAiContextProfileForTurn([
    { role: 'user', content: 'Résume les commentaires de cette application' },
    { role: 'assistant', content: 'Quelle application voulez-vous que je résume ?' },
    { role: 'user', content: 'CheeseTrack' },
  ]);
  assert.equal(name.name, 'entity_inspection');

  // A choice: the document search continues.
  const choice = selectAiContextProfileForTurn([
    { role: 'user', content: 'Trouve les documents sur les sauvegardes' },
    { role: 'assistant', content: "J'en trouve 12. Voulez-vous seulement les publiés ou aussi les brouillons ?" },
    { role: 'user', content: 'les publiés seulement' },
  ]);
  assert.equal(choice.name, 'knowledge');
  assert.ok(choice.toolNames.includes('search_knowledge'));

  // A number: the web lookup keeps the web search.
  const number = selectAiContextProfileForTurn([
    { role: 'user', content: 'What is the latest Windows Server version?' },
    { role: 'assistant', content: 'Which edition do you mean: 1 (Standard), 2 (Datacenter) or 3 (Essentials)?' },
    { role: 'user', content: '2' },
  ]);
  assert.equal(number.name, 'web');
  assert.ok(number.toolNames.includes('web_search'));
}

async function testThanksAndPlainAcknowledgementsStayMinimal() {
  for (const answer of [
    'Deux tâches sont en retard : T-4 et T-7.',
    'Deux tâches sont en retard : T-4 et T-7. Voulez-vous le détail ?',
  ]) {
    const thanks = selectAiContextProfileForTurn([
      { role: 'user', content: 'Liste mes tâches en retard' },
      { role: 'assistant', content: answer },
      { role: 'user', content: 'merci' },
    ]);
    assert.equal(thanks.name, 'minimal', answer);
  }

  // "ok" after an answer that asks nothing and offers nothing.
  const acknowledgement = selectAiContextProfileForTurn([
    { role: 'user', content: 'Liste mes tâches en retard' },
    { role: 'assistant', content: 'Deux tâches sont en retard : T-4 et T-7.' },
    { role: 'user', content: 'ok' },
  ]);
  assert.equal(acknowledgement.name, 'minimal');

  // A new question after an assistant question is a request of its own.
  const question = selectAiContextProfileForTurn([
    { role: 'user', content: 'What is the latest Windows Server version?' },
    { role: 'assistant', content: 'Windows Server 2025. Anything else?' },
    { role: 'user', content: 'Who uses CheeseTrack?' },
  ]);
  assert.equal(question.name, 'read_query');
}

async function run() {
  for (const url of ['/ops/budget/BL-127', '/ops/opex/OPX-7', '/ops/capex/CPX-2']) {
    assert.equal(selectAiContextProfile(`Update the notes of [line](${url})`).name, 'write_financial');
  }
  assert.equal(budgetLineRefFromUrl('/ops/budget/BL-127/budget?year=2027'), 'BL-127');
  assert.equal(budgetLineRefFromUrl('/ops/capex/7/overview'), 'CPX-7');
  assert.equal(budgetLineRefFromUrl('/ops/opex/7/overview'), 'OPX-7');
  assert.equal(budgetLineRefFromUrl('/ops/budget/new'), null);
  await testSelectsMinimalProfileForDirectGreeting();
  await testSelectsKnowledgeProfileForDocumentSearch();
  await testSelectsWriteProfileForDocumentCreationFromEntity();
  await testTaskWriteProfileIncludesBulkAssigneePreviewTool();
  await testSelectsExpectedProfilesForObservedWorkflows();
  await testFiltersProviderToolsForProfile();
  await testNonWebProfilesExposeAllKanapToolsButPrioritizeProfileTools();
  testDeleteRecordFollowsTheFamilyWriteProfiles();
  testIncidentWritesChooseTheBusinessRecordTools();
  testIncidentReadsAndLinkVerbsFromReview();
  await testContinuationInheritsOpenWriteRequestProfile();
  await testPreviewCorrectionInheritsWriteRequestProfile();
  await testTargetSetCorrectionInheritsWriteRequestProfile();
  await testExplicitNewIntentDoesNotInheritOpenWriteRequestProfile();
  await testReadOnlyModifiedDocumentFollowUpKeepsInspectionTools();
  await testTechnologyReferencesAndRelatedRecords();
  await testAcceptingAReadOfferKeepsReadTools();
  await testAcceptingAWriteOfferGetsTheWriteProfile();
  await testShortAnswersToAQuestionKeepTheirProfile();
  await testThanksAndPlainAcknowledgementsStayMinimal();
}

void run();
