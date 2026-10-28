import * as assert from 'node:assert/strict';
import { selectAiContextProfile } from '../ai-context-profile';
import type { AiContextProfileName, AiContextPromptMode } from '../ai-context-profile';

/**
 * The non-regression table of the context profile (lots 5 and 6 of the incident work).
 *
 * Every line fixes a phrase, the profile the classifier must choose, and the prompt mode that
 * profile must carry. The mode is the point: a write classified as a read loses the preview
 * guidance, the tool hints and the writable fields, whatever its tool list says. A line changes
 * only when the phrase itself changes meaning, never to follow a classifier edit.
 */
type Row = {
  prompt: string;
  profile: AiContextProfileName;
  mode: AiContextPromptMode;
};

const FIXTURE_ROWS: Row[] = [
  // Incident administrator writes: an INC reference and an imperative verb.
  { prompt: 'Rouvre INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Annule INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Reopen INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Cancel INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Lève la confidentialité de INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Rends INC-3 public', profile: 'write_business', mode: 'write' },
  { prompt: 'INC-3 ne doit plus être confidentiel', profile: 'write_business', mode: 'write' },
  { prompt: 'Rends INC-3 plus confidentiel', profile: 'write_business', mode: 'write' },
  { prompt: 'Résous INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Clos INC-7', profile: 'write_business', mode: 'write' },
  { prompt: 'Ferme INC-7', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe INC-3 en résolu', profile: 'write_business', mode: 'write' },
  { prompt: 'Lift the confidentiality of INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Make INC-3 public', profile: 'write_business', mode: 'write' },
  { prompt: 'Make INC-3 confidential', profile: 'write_business', mode: 'write' },
  { prompt: 'Rends INC-3 confidentiel', profile: 'write_business', mode: 'write' },

  // Incident reads: a state word alone is not a write, and a question is a fact.
  { prompt: 'INC-3 a-t-il été rouvert ?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Has INC-3 been reopened?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'La confidentialité de INC-3 est-elle levée ?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Montre le journal de INC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Show the log of INC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Quelles notes sur INC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Affiche les notes de INC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Ouvre la fiche de l\'incident INC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Open the incident INC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Open incident INC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Show INC-3 public page', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Résumé de l\'incident INC-3 clos hier', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'INC-3 clos hier, que s\'est-il passé', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Show the notes of INC-4', profile: 'entity_inspection', mode: 'entity' },

  // Incident reads over a list: counts, groups and averages carry aggregate_entities.
  { prompt: 'Liste les incidents clos du mois', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les incidents clos', profile: 'read_query', mode: 'read' },
  { prompt: 'Show closed incidents', profile: 'read_query', mode: 'read' },
  { prompt: 'Show the resolved incidents of last month', profile: 'read_query', mode: 'read' },
  { prompt: 'List resolved incidents by application', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les incidents résolus', profile: 'read_query', mode: 'read' },
  { prompt: 'Nombre d\'incidents clos en septembre', profile: 'read_query', mode: 'read' },
  { prompt: 'Combien d\'incidents clos ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Montre les incidents confidentiels', profile: 'read_query', mode: 'read' },
  { prompt: 'Montre les incidents publics', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les incidents annulés', profile: 'read_query', mode: 'read' },
  { prompt: 'Show cancelled incidents', profile: 'read_query', mode: 'read' },
  { prompt: 'Export the closed incidents to Excel', profile: 'read_query', mode: 'read' },
  { prompt: 'Délai moyen de résolution des incidents clos', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les incidents publiés', profile: 'read_query', mode: 'read' },
  { prompt: 'Les incidents clos de APP-3', profile: 'read_query', mode: 'read' },
  { prompt: 'incidents closed this week', profile: 'read_query', mode: 'read' },
  { prompt: 'What incidents were closed this week', profile: 'read_query', mode: 'read' },
  { prompt: 'Quels incidents ont été annulés', profile: 'read_query', mode: 'read' },
  { prompt: 'Quels incidents sont confidentiels', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les incidents publics', profile: 'read_query', mode: 'read' },
  { prompt: 'Les incidents ouverts sur APP-3', profile: 'read_query', mode: 'read' },
  { prompt: 'Les incidents résolus de APP-3 en septembre', profile: 'read_query', mode: 'read' },
  { prompt: 'Moyenne du délai de résolution des incidents résolus en septembre', profile: 'read_query', mode: 'read' },
  { prompt: 'Show public incidents', profile: 'read_query', mode: 'read' },
  { prompt: 'Quels incidents ont été clos cette semaine', profile: 'read_query', mode: 'read' },
  { prompt: 'Combien d\'incidents ont été clos cette semaine', profile: 'read_query', mode: 'read' },
  { prompt: 'Temps moyen de résolution des incidents clos par application', profile: 'read_query', mode: 'read' },
  { prompt: 'Average resolution time of closed incidents by month', profile: 'read_query', mode: 'read' },
  { prompt: 'Count closed incidents per asset', profile: 'read_query', mode: 'read' },
  { prompt: 'Group the closed incidents by technology', profile: 'read_query', mode: 'read' },
  { prompt: 'Les incidents fermés de septembre', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les incidents à rouvrir', profile: 'read_query', mode: 'read' },
  { prompt: 'Rapport des incidents clos en 2026', profile: 'read_query', mode: 'read' },
  { prompt: 'Incidents clos sur APP-3 en septembre', profile: 'read_query', mode: 'read' },
  { prompt: 'Combien d\'incidents sur APP-3 sont clos', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les incidents de APP-3', profile: 'read_query', mode: 'read' },

  // Incident writes other than the lifecycle and the administrator actions.
  { prompt: 'Ouvre un incident sur la messagerie', profile: 'write_business', mode: 'write' },
  { prompt: 'Crée l\'incident puis lie-le à AST-12 et APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Délie APP-2 de INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Retire APP-2 de INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Enlève AST-12 de INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Détache AST-12 de INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Ajoute une note à INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Lie APP-2 à INC-3', profile: 'write_business', mode: 'write' },

  // Tasks: a status word in a read stays a read; a write verb names the status tool.
  { prompt: 'Clos la tâche T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Clos le ticket T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Ferme le ticket GLPI 123', profile: 'read_query', mode: 'read' },
  { prompt: 'Ferme la fiche', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les contrats annulés', profile: 'read_query', mode: 'read' },
  { prompt: 'Show cancelled contracts', profile: 'read_query', mode: 'read' },
  { prompt: 'Cancel my last preview', profile: 'write_general', mode: 'write' },
  { prompt: 'Annule la dernière modification', profile: 'write_general', mode: 'write' },
  { prompt: 'Annule ce que tu viens de faire', profile: 'write_general', mode: 'write' },
  { prompt: "Annule l'aperçu", profile: 'write_general', mode: 'write' },
  { prompt: 'Undo that', profile: 'write_general', mode: 'write' },

  { prompt: 'Mets la tâche T-4 en cours', profile: 'write_task', mode: 'write' },
  { prompt: 'Passe T-4 en done', profile: 'write_task', mode: 'write' },
  { prompt: 'Ferme la tâche T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Rouvre la tâche T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Reopen T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Mark T-4 done', profile: 'write_task', mode: 'write' },
  { prompt: 'Passe la tâche T-4 en attente', profile: 'write_task', mode: 'write' },
  { prompt: 'Marque T-4 comme terminée', profile: 'write_task', mode: 'write' },
  { prompt: 'Ajoute une note à la tâche T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Crée une tâche pour suivre l\'incident INC-3', profile: 'write_task', mode: 'write' },
  { prompt: 'Ajoute un commentaire à T-4 : fait', profile: 'write_task', mode: 'write' },
  { prompt: "Retire-moi de l'équipe du projet PRJ-3", profile: 'write_business', mode: 'write' },
  { prompt: 'Retire le responsable de la tâche T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Enlève l\'échéance de T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Open T-4', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Show T-4', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Montre T-4 en cours', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'T-4 est en cours', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'T-4 is done', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Is T-4 done', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Ouvre T-4', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Montre la tâche T-4', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'List open tasks', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les tâches en cours', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les tâches en cours du projet PRJ-3', profile: 'read_query', mode: 'read' },
  { prompt: 'Show open tasks of T-4', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les tâches ouvertes de T-4', profile: 'read_query', mode: 'read' },
  { prompt: 'Combien de tâches ouvertes sur PRJ-3', profile: 'read_query', mode: 'read' },
  { prompt: 'Show the tasks of PRJ-3', profile: 'read_query', mode: 'read' },

  // Projects and requests.
  { prompt: 'Liste les projets en cours', profile: 'read_query', mode: 'read' },
  { prompt: 'Show open projects', profile: 'read_query', mode: 'read' },
  { prompt: 'Passe PRJ-3 en cours', profile: 'write_business', mode: 'write' },
  { prompt: 'Annule le projet PRJ-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Cancel PRJ-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Liste les demandes en attente', profile: 'read_query', mode: 'read' },
  { prompt: 'Show open requests', profile: 'read_query', mode: 'read' },
  { prompt: 'Change the status of REQ-4 to done', profile: 'write_business', mode: 'write' },

  // Applications, assets, contracts and documents.
  { prompt: 'Lève le statut confidentiel de l\'application APP-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Retire le contrat CTR-2 de l\'application APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Retire APP-2 du projet PRJ-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Enlève AST-12 de APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Détache le document DOC-4 du projet PRJ-3', profile: 'write_document', mode: 'write' },
  { prompt: 'Rends le document DOC-4 public', profile: 'write_document', mode: 'write' },
  { prompt: 'Publie le document DOC-4', profile: 'write_document', mode: 'write' },
  { prompt: 'Publie DOC-4', profile: 'write_document', mode: 'write' },
  { prompt: 'Liste les applications critiques', profile: 'read_query', mode: 'read' },
  { prompt: 'Quelles applications sont publiques', profile: 'read_query', mode: 'read' },
  { prompt: 'Montre les applications exposées en public', profile: 'read_query', mode: 'read' },
  { prompt: 'Rends l\'application APP-3 publique', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Les applications en cours de déploiement', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les documents publiés', profile: 'knowledge', mode: 'knowledge' },
  { prompt: 'Show the public documents', profile: 'knowledge', mode: 'knowledge' },
  { prompt: 'Montre le journal des modifications de APP-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Show the audit log of PRJ-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Quelles notes sur PRJ-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Montre les notes de la tâche T-4', profile: 'entity_inspection', mode: 'entity' },
  { prompt: "L'application APP-3 est-elle critique ?", profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Show the applications of the Finance department', profile: 'read_query', mode: 'read' },
  { prompt: 'Which assets run PostgreSQL?', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les actifs critiques', profile: 'read_query', mode: 'read' },
  { prompt: 'Change the owner of AST-12', profile: 'write_business', mode: 'write' },
  { prompt: 'Mets à jour l\'actif AST-12', profile: 'write_business', mode: 'write' },
  { prompt: 'List the contracts that expire this year', profile: 'read_query', mode: 'read' },
  { prompt: 'Show the contracts of Microsoft', profile: 'read_query', mode: 'read' },
  { prompt: 'Add a contract with Microsoft', profile: 'write_business', mode: 'write' },

  // Budget lines.
  { prompt: 'Retire la ligne de budget OPEX-12', profile: 'write_financial', mode: 'write' },
  { prompt: 'Retire 500 euros du budget de OPEX-12', profile: 'write_financial', mode: 'write' },
  { prompt: 'Liste les lignes budgétaires du centre de coût Finance', profile: 'read_query', mode: 'read' },
  { prompt: 'Montre le budget 2026', profile: 'read_query', mode: 'read' },
  { prompt: 'Show the OPEX lines of the Finance cost center', profile: 'read_query', mode: 'read' },
  { prompt: 'Ajoute une ligne de budget pour Microsoft 365', profile: 'write_financial', mode: 'write' },
  { prompt: 'Add a budget line for Microsoft 365', profile: 'write_financial', mode: 'write' },
  { prompt: 'Change le montant de OPEX-12 à 3000', profile: 'write_financial', mode: 'write' },
  { prompt: 'Change the amount of OPEX-12 to 3000', profile: 'write_financial', mode: 'write' },
  { prompt: 'Quel est le budget 2026 du centre de coût Finance ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Combien de lignes budgétaires sont actives ?', profile: 'read_query', mode: 'read' },

  // Master data.
  { prompt: 'Delete contact Camille Roux', profile: 'write_master_data', mode: 'write' },
  { prompt: 'Add a supplier named Fromage Plus', profile: 'write_master_data', mode: 'write' },
  { prompt: 'List the suppliers that are active', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les fournisseurs actifs', profile: 'read_query', mode: 'read' },

  // Deletes and the generic write profile.
  { prompt: 'Delete task T-42', profile: 'write_task', mode: 'write' },
  { prompt: 'Delete budget line OPEX BL-42', profile: 'write_financial', mode: 'write' },
  { prompt: 'Delete document DOC-12', profile: 'write_document', mode: 'write' },
  { prompt: 'Delete the application APP-41', profile: 'write_business', mode: 'write' },
  { prompt: 'Delete the incident INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Create something useful for onboarding', profile: 'write_general', mode: 'write' },
  { prompt: 'Change ABC-12 status to done.', profile: 'write_general', mode: 'write' },
  { prompt: 'Publish DOC-151.', profile: 'write_document', mode: 'write' },
  { prompt: 'Update the content of DOC-12', profile: 'write_document', mode: 'write' },
  { prompt: 'Add a document about backups', profile: 'write_document', mode: 'write' },
  { prompt: 'Update the lifecycle of TEC-3', profile: 'write_general', mode: 'write' },

  // Other probes from the existing profile spec.
  { prompt: 'Show me my overdue tasks', profile: 'read_query', mode: 'read' },
  { prompt: 'Show current tasks', profile: 'read_query', mode: 'read' },
  { prompt: 'How many tasks are in progress by status?', profile: 'read_query', mode: 'read' },
  { prompt: 'Summarize T-48', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Create a task to invent sliced bread.', profile: 'write_task', mode: 'write' },
  { prompt: 'Change T-48 status to done.', profile: 'write_task', mode: 'write' },
  { prompt: 'Add a comment to T-48', profile: 'write_task', mode: 'write' },
  { prompt: 'Réassigne les tâches de Friedrich EVA à Nicolas Bertrand.', profile: 'write_task', mode: 'write' },
  { prompt: 'Assign T-4 to Camille', profile: 'write_task', mode: 'write' },
  { prompt: 'Change [APP-41](/it/applications/41) status to retired.', profile: 'write_business', mode: 'write' },
  { prompt: 'Link APP-41 to PRJ-12.', profile: 'write_relation', mode: 'write' },
  { prompt: 'Lie APP-2 à APP-3', profile: 'write_relation', mode: 'write' },
  { prompt: 'Ajoute AST-12 à APP-3', profile: 'write_relation', mode: 'write' },
  { prompt: 'Change the criticality of APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Create a project for the migration', profile: 'write_business', mode: 'write' },
  { prompt: 'Create a request for a new laptop', profile: 'write_business', mode: 'write' },
  { prompt: 'Change the status of PRJ-3 to done', profile: 'write_business', mode: 'write' },
  { prompt: 'What is the total forecast of OPEX items for 2026?', profile: 'read_query', mode: 'read' },
  { prompt: 'Top 5 OPEX items by forecast in 2026', profile: 'read_query', mode: 'read' },
  { prompt: 'Which applications use PostgreSQL?', profile: 'read_query', mode: 'read' },
  { prompt: 'Summarize TEC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'List the documents published this month', profile: 'knowledge', mode: 'knowledge' },
  { prompt: 'Trouve les documents sur les sauvegardes', profile: 'knowledge', mode: 'knowledge' },
  { prompt: 'Résume le document DOC-12', profile: 'knowledge', mode: 'knowledge' },
  { prompt: 'Combien de projets sont en cours ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Combien de contrats arrivent à échéance cette année ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les applications du fournisseur Microsoft', profile: 'read_query', mode: 'read' },

  // Lot 6: the general "passe/passer" writes, without losing the reflexive past reads.
  { prompt: 'Passe APP-3 en production', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe REQ-4 en validation', profile: 'write_business', mode: 'write' },
  { prompt: 'Peux-tu passer REQ-4 en validation ?', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe la criticité de APP-3 à haute', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe le responsable de APP-3 à Camille', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe INC-3 en cours', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe mes tâches en cours', profile: 'write_task', mode: 'write' },
  { prompt: 'Passe le contrat de Microsoft en résilié', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe le fournisseur Microsoft en inactif', profile: 'write_master_data', mode: 'write' },
  { prompt: 'Passe Camille en administrateur', profile: 'write_general', mode: 'write' },
  { prompt: 'Que s\'est-il passé sur T-4 ?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Qu\'est-ce qui se passe sur APP-3 ?', profile: 'entity_inspection', mode: 'entity' },

  // Lot 6: an incident lifecycle write opens with its imperative, even without an INC reference,
  // in the plural, or with a read word later in the sentence.
  { prompt: 'Ferme tous les incidents de APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Clos tous les incidents résolus de APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Rouvre les incidents clos hier', profile: 'write_business', mode: 'write' },
  { prompt: 'Reopen all incidents closed yesterday on APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Annule les incidents en double de APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe tous les incidents de APP-3 en clos', profile: 'write_business', mode: 'write' },
  { prompt: 'Résous les incidents mineurs de APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Rouvre les incidents de Camille', profile: 'write_business', mode: 'write' },
  { prompt: 'Rouvre l\'incident de ce matin sur APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Cancel INC-3 which duplicates INC-2', profile: 'write_business', mode: 'write' },
  { prompt: 'Clos INC-3, quel soulagement', profile: 'write_business', mode: 'write' },
  { prompt: 'Rouvre INC-3 et montre-moi le résultat', profile: 'write_business', mode: 'write' },
  { prompt: 'Résous INC-3 et liste les actions faites', profile: 'write_business', mode: 'write' },
  { prompt: 'Bonjour, rouvre INC-3 stp', profile: 'write_business', mode: 'write' },
  { prompt: 'Je veux rouvrir INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Il faut rouvrir INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'I want to reopen INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Peux-tu rouvrir INC-3 ?', profile: 'write_business', mode: 'write' },
  { prompt: 'Can you reopen INC-3?', profile: 'write_business', mode: 'write' },
  { prompt: 'Close INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Close incident INC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Explique pourquoi INC-3 doit être confidentiel', profile: 'entity_inspection', mode: 'entity' },

  // Lot 6: a status imperative at the head beats "est"/"is" later in the sentence.
  { prompt: 'Clos T-4, c\'est terminé', profile: 'write_task', mode: 'write' },
  { prompt: 'Ferme T-4 car elle est en doublon', profile: 'write_task', mode: 'write' },
  { prompt: 'Reopen T-4, it is not done', profile: 'write_task', mode: 'write' },
  { prompt: 'Rouvre T-4 : le bug est revenu', profile: 'write_task', mode: 'write' },

  // Lot 6: a confidentiality change without an INC reference is still a write.
  { prompt: 'Lève la confidentialité', profile: 'write_business', mode: 'write' },
  { prompt: 'plus confidentiel', profile: 'write_business', mode: 'write' },

  // Lot 6: tasks have a cancelled status; requests do not, so their cancellation stays a read.
  { prompt: 'Annule la tâche T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Annule T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Cancel T-4', profile: 'write_task', mode: 'write' },
  { prompt: 'Annule la demande REQ-4', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Cancel REQ-4', profile: 'entity_inspection', mode: 'entity' },

  // Lot 6: a task write in bulk, with the family name and no task reference.
  { prompt: 'Close all tasks of PRJ-3', profile: 'write_task', mode: 'write' },
  { prompt: 'Clos toutes les tâches de PRJ-3', profile: 'write_task', mode: 'write' },

  // Lot 6: a BL-n is a budget line only with a budget word; otherwise it may be a delivery note.
  { prompt: 'Supprime le BL-123', profile: 'write_general', mode: 'write' },
  { prompt: 'Le bon de livraison BL-123 est arrivé', profile: 'entity_inspection', mode: 'entity' },
];

function testTheTable() {
  assert.ok(FIXTURE_ROWS.length >= 253, `the table carries ${FIXTURE_ROWS.length} lines`);

  for (const row of FIXTURE_ROWS) {
    const profile = selectAiContextProfile(row.prompt);
    assert.equal(profile.name, row.profile, `${row.prompt}: expected ${row.profile}`);
    assert.equal(profile.promptMode, row.mode, `${row.prompt}: expected prompt mode ${row.mode}`);
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
