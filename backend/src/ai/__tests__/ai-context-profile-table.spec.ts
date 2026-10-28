import * as assert from 'node:assert/strict';
import { selectAiContextProfile } from '../ai-context-profile';
import type { AiContextProfileName } from '../ai-context-profile';
import type { AiToolName } from '../ai.types';

/**
 * The non-regression table of the context profile (lot 5 of the incident work).
 *
 * Every line fixes a phrase, the profile the classifier must choose, and the tool the request
 * needs when the profile is not enough by itself. A read that counts, groups or averages asks
 * for `aggregate_entities`; a write names the tool that executes it. A line changes only when
 * the phrase itself changes meaning, never to follow a classifier edit.
 */
type Row = {
  prompt: string;
  profile: AiContextProfileName;
  tools?: AiToolName[];
};

const FIXTURE_ROWS: Row[] = [
  // Incident administrator writes: an INC reference and an imperative verb.
  { prompt: 'Rouvre INC-3', profile: 'write_business', tools: ['change_incident_state'] },
  { prompt: 'Annule INC-3', profile: 'write_business', tools: ['change_incident_state'] },
  { prompt: 'Reopen INC-3', profile: 'write_business', tools: ['change_incident_state'] },
  { prompt: 'Cancel INC-3', profile: 'write_business', tools: ['change_incident_state'] },
  { prompt: 'Lève la confidentialité de INC-3', profile: 'write_business', tools: ['set_incident_confidentiality'] },
  { prompt: 'Rends INC-3 public', profile: 'write_business', tools: ['set_incident_confidentiality'] },
  { prompt: 'INC-3 ne doit plus être confidentiel', profile: 'write_business', tools: ['set_incident_confidentiality'] },
  { prompt: 'Rends INC-3 plus confidentiel', profile: 'write_business', tools: ['set_incident_confidentiality'] },
  { prompt: 'Résous INC-3', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Clos INC-7', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Ferme INC-7', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Passe INC-3 en résolu', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Lift the confidentiality of INC-3', profile: 'write_business', tools: ['set_incident_confidentiality'] },
  { prompt: 'Make INC-3 public', profile: 'write_business', tools: ['set_incident_confidentiality'] },
  { prompt: 'Make INC-3 confidential', profile: 'write_business', tools: ['set_incident_confidentiality'] },
  { prompt: 'Rends INC-3 confidentiel', profile: 'write_business', tools: ['set_incident_confidentiality'] },

  // Incident reads: a state word alone is not a write, and a question is a fact.
  { prompt: 'INC-3 a-t-il été rouvert ?', profile: 'entity_inspection' },
  { prompt: 'Has INC-3 been reopened?', profile: 'entity_inspection' },
  { prompt: 'La confidentialité de INC-3 est-elle levée ?', profile: 'entity_inspection' },
  { prompt: 'Montre le journal de INC-3', profile: 'entity_inspection' },
  { prompt: 'Show the log of INC-3', profile: 'entity_inspection' },
  { prompt: 'Quelles notes sur INC-3', profile: 'entity_inspection' },
  { prompt: 'Affiche les notes de INC-3', profile: 'entity_inspection' },
  { prompt: 'Ouvre la fiche de l\'incident INC-3', profile: 'entity_inspection' },
  { prompt: 'Open the incident INC-3', profile: 'entity_inspection' },
  { prompt: 'Open incident INC-3', profile: 'entity_inspection' },
  { prompt: 'Show INC-3 public page', profile: 'entity_inspection' },
  { prompt: 'Résumé de l\'incident INC-3 clos hier', profile: 'entity_inspection' },
  { prompt: 'INC-3 clos hier, que s\'est-il passé', profile: 'entity_inspection' },
  { prompt: 'Show the notes of INC-4', profile: 'entity_inspection', tools: ['get_entity_comments'] },

  // Incident reads over a list: counts, groups and averages carry aggregate_entities.
  { prompt: 'Liste les incidents clos du mois', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les incidents clos', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Show closed incidents', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Show the resolved incidents of last month', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'List resolved incidents by application', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les incidents résolus', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Nombre d\'incidents clos en septembre', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Combien d\'incidents clos ?', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Montre les incidents confidentiels', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Montre les incidents publics', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les incidents annulés', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Show cancelled incidents', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Export the closed incidents to Excel', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Délai moyen de résolution des incidents clos', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les incidents publiés', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Les incidents clos de APP-3', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'incidents closed this week', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'What incidents were closed this week', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Quels incidents ont été annulés', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Quels incidents sont confidentiels', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les incidents publics', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Les incidents ouverts sur APP-3', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Les incidents résolus de APP-3 en septembre', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Moyenne du délai de résolution des incidents résolus en septembre', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Show public incidents', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Quels incidents ont été clos cette semaine', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Combien d\'incidents ont été clos cette semaine', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Temps moyen de résolution des incidents clos par application', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Average resolution time of closed incidents by month', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Count closed incidents per asset', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Group the closed incidents by technology', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Les incidents fermés de septembre', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les incidents à rouvrir', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Rapport des incidents clos en 2026', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Incidents clos sur APP-3 en septembre', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Combien d\'incidents sur APP-3 sont clos', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les incidents de APP-3', profile: 'read_query', tools: ['aggregate_entities'] },

  // Incident writes other than the lifecycle and the administrator actions.
  { prompt: 'Ouvre un incident sur la messagerie', profile: 'write_business', tools: ['create_business_record'] },
  { prompt: 'Crée l\'incident puis lie-le à AST-12 et APP-3', profile: 'write_business', tools: ['create_business_record', 'update_incident_links'] },
  { prompt: 'Délie APP-2 de INC-3', profile: 'write_business', tools: ['update_incident_links'] },
  { prompt: 'Retire APP-2 de INC-3', profile: 'write_business', tools: ['update_incident_links'] },
  { prompt: 'Enlève AST-12 de INC-3', profile: 'write_business', tools: ['update_incident_links'] },
  { prompt: 'Détache AST-12 de INC-3', profile: 'write_business', tools: ['update_incident_links'] },
  { prompt: 'Ajoute une note à INC-3', profile: 'write_business', tools: ['add_incident_note'] },
  { prompt: 'Lie APP-2 à INC-3', profile: 'write_business', tools: ['update_incident_links'] },

  // Tasks: a status word in a read stays a read; a write verb names the status tool.
  { prompt: 'Clos la tâche T-4', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Clos le ticket T-4', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Ferme le ticket GLPI 123', profile: 'read_query' },
  { prompt: 'Ferme la fiche', profile: 'read_query' },
  { prompt: 'Liste les contrats annulés', profile: 'read_query' },
  { prompt: 'Show cancelled contracts', profile: 'read_query' },
  { prompt: 'Cancel my last preview', profile: 'read_query' },
  { prompt: 'Annule la dernière modification', profile: 'read_query' },
  { prompt: 'Annule ce que tu viens de faire', profile: 'read_query' },
  { prompt: "Annule l'aperçu", profile: 'read_query' },
  { prompt: 'Undo that', profile: 'read_query' },

  { prompt: 'Mets la tâche T-4 en cours', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Passe T-4 en done', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Ferme la tâche T-4', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Rouvre la tâche T-4', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Reopen T-4', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Mark T-4 done', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Passe la tâche T-4 en attente', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Marque T-4 comme terminée', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Ajoute une note à la tâche T-4', profile: 'write_task', tools: ['add_task_comment'] },
  { prompt: 'Crée une tâche pour suivre l\'incident INC-3', profile: 'write_task', tools: ['create_task'] },
  { prompt: 'Ajoute un commentaire à T-4 : fait', profile: 'write_task', tools: ['add_task_comment'] },
  { prompt: "Retire-moi de l'équipe du projet PRJ-3", profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Retire le responsable de la tâche T-4', profile: 'write_task', tools: ['update_task_assignee'] },
  { prompt: 'Enlève l\'échéance de T-4', profile: 'write_task', tools: ['update_task_fields'] },
  { prompt: 'Open T-4', profile: 'entity_inspection' },
  { prompt: 'Show T-4', profile: 'entity_inspection' },
  { prompt: 'Montre T-4 en cours', profile: 'entity_inspection' },
  { prompt: 'T-4 est en cours', profile: 'entity_inspection' },
  { prompt: 'T-4 is done', profile: 'entity_inspection' },
  { prompt: 'Is T-4 done', profile: 'entity_inspection' },
  { prompt: 'Ouvre T-4', profile: 'entity_inspection' },
  { prompt: 'Montre la tâche T-4', profile: 'entity_inspection' },
  { prompt: 'List open tasks', profile: 'read_query' },
  { prompt: 'Liste les tâches en cours', profile: 'read_query' },
  { prompt: 'Liste les tâches en cours du projet PRJ-3', profile: 'read_query' },
  { prompt: 'Show open tasks of T-4', profile: 'read_query' },
  { prompt: 'Liste les tâches ouvertes de T-4', profile: 'read_query' },
  { prompt: 'Combien de tâches ouvertes sur PRJ-3', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Show the tasks of PRJ-3', profile: 'read_query' },

  // Projects and requests.
  { prompt: 'Liste les projets en cours', profile: 'read_query' },
  { prompt: 'Show open projects', profile: 'read_query' },
  { prompt: 'Passe PRJ-3 en cours', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Annule le projet PRJ-3', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Cancel PRJ-3', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Liste les demandes en attente', profile: 'read_query' },
  { prompt: 'Show open requests', profile: 'read_query' },
  { prompt: 'Change the status of REQ-4 to done', profile: 'write_business', tools: ['update_business_record'] },

  // Applications, assets, contracts and documents.
  { prompt: 'Lève le statut confidentiel de l\'application APP-3', profile: 'entity_inspection' },
  { prompt: 'Retire le contrat CTR-2 de l\'application APP-3', profile: 'write_business', tools: ['update_entity_relations'] },
  { prompt: 'Retire APP-2 du projet PRJ-3', profile: 'write_business', tools: ['update_entity_relations'] },
  { prompt: 'Enlève AST-12 de APP-3', profile: 'write_business', tools: ['update_entity_relations'] },
  { prompt: 'Détache le document DOC-4 du projet PRJ-3', profile: 'write_document', tools: ['update_document_relations'] },
  { prompt: 'Rends le document DOC-4 public', profile: 'knowledge', tools: ['get_document'] },
  { prompt: 'Publie le document DOC-4', profile: 'knowledge', tools: ['get_document'] },
  { prompt: 'Liste les applications critiques', profile: 'read_query' },
  { prompt: 'Quelles applications sont publiques', profile: 'read_query' },
  { prompt: 'Montre les applications exposées en public', profile: 'read_query' },
  { prompt: 'Rends l\'application APP-3 publique', profile: 'entity_inspection' },
  { prompt: 'Les applications en cours de déploiement', profile: 'read_query' },
  { prompt: 'Liste les documents publiés', profile: 'knowledge', tools: ['search_knowledge'] },
  { prompt: 'Show the public documents', profile: 'knowledge', tools: ['search_knowledge'] },
  { prompt: 'Montre le journal des modifications de APP-3', profile: 'entity_inspection' },
  { prompt: 'Show the audit log of PRJ-3', profile: 'entity_inspection' },
  { prompt: 'Quelles notes sur PRJ-3', profile: 'entity_inspection' },
  { prompt: 'Montre les notes de la tâche T-4', profile: 'entity_inspection' },
  { prompt: "L'application APP-3 est-elle critique ?", profile: 'entity_inspection' },
  { prompt: 'Show the applications of the Finance department', profile: 'read_query' },
  { prompt: 'Which assets run PostgreSQL?', profile: 'read_query', tools: ['get_entity_context'] },
  { prompt: 'Liste les actifs critiques', profile: 'read_query' },
  { prompt: 'Change the owner of AST-12', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Mets à jour l\'actif AST-12', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'List the contracts that expire this year', profile: 'read_query' },
  { prompt: 'Show the contracts of Microsoft', profile: 'read_query' },
  { prompt: 'Add a contract with Microsoft', profile: 'write_business', tools: ['create_business_record'] },

  // Budget lines.
  { prompt: 'Retire la ligne de budget OPEX-12', profile: 'write_financial', tools: ['delete_record'] },
  { prompt: 'Retire 500 euros du budget de OPEX-12', profile: 'write_financial', tools: ['write_financial_plan'] },
  { prompt: 'Liste les lignes budgétaires du centre de coût Finance', profile: 'read_query' },
  { prompt: 'Montre le budget 2026', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Show the OPEX lines of the Finance cost center', profile: 'read_query' },
  { prompt: 'Ajoute une ligne de budget pour Microsoft 365', profile: 'write_financial', tools: ['write_financial_plan'] },
  { prompt: 'Add a budget line for Microsoft 365', profile: 'write_financial', tools: ['write_financial_plan'] },
  { prompt: 'Change le montant de OPEX-12 à 3000', profile: 'write_financial', tools: ['write_financial_plan'] },
  { prompt: 'Change the amount of OPEX-12 to 3000', profile: 'write_financial', tools: ['write_financial_plan'] },
  { prompt: 'Quel est le budget 2026 du centre de coût Finance ?', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Combien de lignes budgétaires sont actives ?', profile: 'read_query', tools: ['aggregate_entities'] },

  // Master data.
  { prompt: 'Delete contact Camille Roux', profile: 'write_master_data', tools: ['delete_record'] },
  { prompt: 'Add a supplier named Fromage Plus', profile: 'write_master_data', tools: ['create_master_data_record'] },
  { prompt: 'List the suppliers that are active', profile: 'read_query' },
  { prompt: 'Liste les fournisseurs actifs', profile: 'read_query' },

  // Deletes and the generic write profile.
  { prompt: 'Delete task T-42', profile: 'write_task', tools: ['delete_record'] },
  { prompt: 'Delete budget line OPEX BL-42', profile: 'write_financial', tools: ['delete_record'] },
  { prompt: 'Delete document DOC-12', profile: 'write_document', tools: ['delete_record'] },
  { prompt: 'Delete the application APP-41', profile: 'write_business', tools: ['delete_record'] },
  { prompt: 'Delete the incident INC-3', profile: 'write_business', tools: ['delete_record'] },
  { prompt: 'Create something useful for onboarding', profile: 'write_general' },
  { prompt: 'Change ABC-12 status to done.', profile: 'write_general' },
  { prompt: 'Publish DOC-151.', profile: 'write_document', tools: ['update_document_metadata'] },
  { prompt: 'Update the content of DOC-12', profile: 'write_document', tools: ['update_document_content'] },
  { prompt: 'Add a document about backups', profile: 'write_document', tools: ['create_document'] },
  { prompt: 'Update the lifecycle of TEC-3', profile: 'write_general' },

  // Other probes from the existing profile spec.
  { prompt: 'Show me my overdue tasks', profile: 'read_query' },
  { prompt: 'Show current tasks', profile: 'read_query' },
  { prompt: 'How many tasks are in progress by status?', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Summarize T-48', profile: 'entity_inspection' },
  { prompt: 'Create a task to invent sliced bread.', profile: 'write_task', tools: ['create_task'] },
  { prompt: 'Change T-48 status to done.', profile: 'write_task', tools: ['update_task_status'] },
  { prompt: 'Add a comment to T-48', profile: 'write_task', tools: ['add_task_comment'] },
  { prompt: 'Réassigne les tâches de Friedrich EVA à Nicolas Bertrand.', profile: 'write_task', tools: ['update_task_assignees'] },
  { prompt: 'Assign T-4 to Camille', profile: 'write_task', tools: ['update_task_assignee'] },
  { prompt: 'Change [APP-41](/it/applications/41) status to retired.', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Link APP-41 to PRJ-12.', profile: 'write_relation', tools: ['update_entity_relations'] },
  { prompt: 'Lie APP-2 à APP-3', profile: 'write_relation', tools: ['update_entity_relations'] },
  { prompt: 'Ajoute AST-12 à APP-3', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Change the criticality of APP-3', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'Create a project for the migration', profile: 'write_business', tools: ['create_business_record'] },
  { prompt: 'Create a request for a new laptop', profile: 'write_business', tools: ['create_business_record'] },
  { prompt: 'Change the status of PRJ-3 to done', profile: 'write_business', tools: ['update_business_record'] },
  { prompt: 'What is the total forecast of OPEX items for 2026?', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Top 5 OPEX items by forecast in 2026', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Which applications use PostgreSQL?', profile: 'read_query', tools: ['get_entity_context'] },
  { prompt: 'Summarize TEC-3', profile: 'entity_inspection', tools: ['get_entity_context'] },
  { prompt: 'List the documents published this month', profile: 'knowledge', tools: ['search_knowledge'] },
  { prompt: 'Trouve les documents sur les sauvegardes', profile: 'knowledge', tools: ['search_knowledge'] },
  { prompt: 'Résume le document DOC-12', profile: 'knowledge', tools: ['get_document'] },
  { prompt: 'Combien de projets sont en cours ?', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Combien de contrats arrivent à échéance cette année ?', profile: 'read_query', tools: ['aggregate_entities'] },
  { prompt: 'Liste les applications du fournisseur Microsoft', profile: 'read_query' },
];

function testTheTable() {
  assert.ok(FIXTURE_ROWS.length >= 139 + 40, `the table carries ${FIXTURE_ROWS.length} lines`);

  for (const row of FIXTURE_ROWS) {
    const profile = selectAiContextProfile(row.prompt);
    assert.equal(profile.name, row.profile, `${row.prompt}: expected ${row.profile}`);
    for (const tool of row.tools ?? []) {
      assert.ok(profile.toolNames.includes(tool), `${row.prompt}: expected ${tool}`);
    }
  }
}

function testTheFixturePhrasesAreAllPresent() {
  // The 120 phrases of phrases.txt and the 19 of p2.txt, as reviewed at lot 4.
  const expectedFixtureCount = 139;
  const fixturePrompts = [
    'Rouvre INC-3', 'Annule INC-3', 'Reopen INC-3', 'Cancel INC-3',
    'Lève la confidentialité de INC-3', 'Rends INC-3 public',
    'INC-3 ne doit plus être confidentiel', 'Rends INC-3 plus confidentiel',
    'INC-3 a-t-il été rouvert ?', 'Has INC-3 been reopened?', 'Résous INC-3',
    'Clos la tâche T-4', 'Clos le ticket T-4', 'Ferme le ticket GLPI 123',
    'Délie APP-2 de INC-3', 'Retire APP-2 de INC-3', 'Enlève AST-12 de INC-3',
    'Détache AST-12 de INC-3', 'Montre le journal de INC-3', 'Show the log of INC-3',
    'Quelles notes sur INC-3', 'Affiche les notes de INC-3',
    'Ouvre la fiche de l\'incident INC-3', 'Ouvre un incident sur la messagerie',
    'Crée l\'incident puis lie-le à AST-12 et APP-3', 'Liste les incidents clos du mois',
    'Liste les incidents clos', 'Show closed incidents',
    'Show the resolved incidents of last month', 'List resolved incidents by application',
    'Liste les incidents résolus', 'Nombre d\'incidents clos en septembre',
    'Combien d\'incidents clos ?', 'Montre les incidents confidentiels',
    'Montre les incidents publics', 'Liste les incidents annulés',
    'Show cancelled incidents', 'Export the closed incidents to Excel',
    'Délai moyen de résolution des incidents clos', 'Liste les incidents publiés',
    'Les incidents clos de APP-3', 'incidents closed this week',
    'What incidents were closed this week', 'Quels incidents ont été annulés',
    'Rends le document DOC-4 public', 'Publie le document DOC-4',
    'Mets la tâche T-4 en cours', 'Passe T-4 en done', 'Open T-4', 'Show T-4',
    'Montre T-4 en cours', 'List open tasks', 'Liste les tâches en cours',
    'Liste les tâches en cours du projet PRJ-3', 'Show open tasks of T-4',
    'T-4 est en cours', 'T-4 is done', 'Mark T-4 done', 'Ouvre T-4',
    'Montre la tâche T-4', 'Ferme la tâche T-4', 'Rouvre la tâche T-4',
    'Reopen T-4', 'Combien de tâches ouvertes sur PRJ-3', 'Liste les projets en cours',
    'Show open projects', 'Passe PRJ-3 en cours', 'Annule le projet PRJ-3',
    'Cancel PRJ-3', 'Lève le statut confidentiel de l\'application APP-3',
    'Retire le contrat CTR-2 de l\'application APP-3', 'Retire APP-2 du projet PRJ-3',
    'Enlève AST-12 de APP-3', 'Détache le document DOC-4 du projet PRJ-3',
    'Retire la ligne de budget OPEX-12', 'Retire 500 euros du budget de OPEX-12',
    'Liste les lignes budgétaires du centre de coût Finance', 'Montre le budget 2026',
    'Ajoute une ligne de budget pour Microsoft 365',
    'Change le montant de OPEX-12 à 3000', 'Liste les applications critiques',
    'Quelles applications sont publiques', 'Montre les applications exposées en public',
    'Rends l\'application APP-3 publique', 'Les applications en cours de déploiement',
    'Liste les documents publiés', 'Show the public documents',
    'Montre le journal des modifications de APP-3', 'Show the audit log of PRJ-3',
    'Quelles notes sur PRJ-3', 'Montre les notes de la tâche T-4',
    'Ajoute une note à INC-3', 'Ajoute une note à la tâche T-4',
    'Crée une tâche pour suivre l\'incident INC-3', 'Ajoute un commentaire à T-4 : fait',
    'Clos INC-7', 'Ferme INC-7', 'Passe INC-3 en résolu', 'Lie APP-2 à INC-3',
    'La confidentialité de INC-3 est-elle levée ?', 'Quels incidents sont confidentiels',
    'Liste les incidents publics', 'Les incidents ouverts sur APP-3',
    'Retire-moi de l\'équipe du projet PRJ-3', 'Retire le responsable de la tâche T-4',
    'Enlève l\'échéance de T-4', 'Lift the confidentiality of INC-3',
    'Make INC-3 public', 'Make INC-3 confidential', 'Rends INC-3 confidentiel',
    'Ferme la fiche', 'Liste les contrats annulés', 'Show cancelled contracts',
    'Cancel my last preview', 'Annule la dernière modification',
    'Annule ce que tu viens de faire', 'Annule l\'aperçu', 'Undo that',
    'Les incidents résolus de APP-3 en septembre',
    'Moyenne du délai de résolution des incidents résolus en septembre',
    'Show public incidents', 'Quels incidents ont été clos cette semaine',
    'Combien d\'incidents ont été clos cette semaine',
    'Temps moyen de résolution des incidents clos par application',
    'Average resolution time of closed incidents by month',
    'Count closed incidents per asset', 'Group the closed incidents by technology',
    'Les incidents fermés de septembre', 'Liste les incidents à rouvrir',
    'Rapport des incidents clos en 2026', 'Incidents clos sur APP-3 en septembre',
    'Combien d\'incidents sur APP-3 sont clos', 'Open the incident INC-3',
    'Open incident INC-3', 'Show INC-3 public page',
    'Résumé de l\'incident INC-3 clos hier', 'INC-3 clos hier, que s\'est-il passé',
    'Liste les tâches ouvertes de T-4', 'Is T-4 done',
  ];
  assert.equal(fixturePrompts.length, expectedFixtureCount);
  const table = new Set(FIXTURE_ROWS.map((row) => row.prompt));
  for (const prompt of fixturePrompts) {
    assert.ok(table.has(prompt), `the table holds the fixture phrase: ${prompt}`);
  }
}

function run() {
  testTheTable();
  testTheFixturePhrasesAreAllPresent();
  console.log(`  context profile table: ${FIXTURE_ROWS.length} lines, OK`);
}

run();
