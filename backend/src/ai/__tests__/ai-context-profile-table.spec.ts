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
  /** The tool the write must offer, when the row fixes it. */
  tools?: string[];
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
  // The technology record is a business write now; the tool that changes its fields arrives in lot 4.
  { prompt: 'Update the lifecycle of TEC-3', profile: 'write_business', mode: 'write' },

  // Lot 4 review: "installé" and "déclaré" are past participles, not imperatives, and a question
  // never writes; every one of these words stays a read.
  { prompt: 'Sur quels serveurs nginx est-il installé ?', profile: 'read_query', mode: 'read' },
  { prompt: 'PostgreSQL est-il déclaré sur CheeseTrack ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Où nginx est-il installé ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Sur quel serveur Java 8 est-il installé ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Quel est le dernier serveur installé ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Java 21 est installé sur combien de serveurs ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste ce qui est déclaré sur CheeseTrack', profile: 'read_query', mode: 'read' },
  { prompt: 'Comment installer nginx sur un serveur ?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'How do I install PostgreSQL on a server?', profile: 'read_query', mode: 'read' },
  { prompt: 'Which applications declare PostgreSQL 14?', profile: 'read_query', mode: 'read' },
  { prompt: 'Le serveur AST-12 est installé dans quelle salle ?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'CheeseTrack est déclaré sur quels serveurs ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Show the install base of Java 8', profile: 'read_query', mode: 'read' },
  { prompt: 'Quand Java 21 a-t-il été installé sur AST-12 ?', profile: 'entity_inspection', mode: 'entity' },

  // Lot 4 review: a technology link verb at the head writes; the link tool is in every write profile.
  { prompt: 'Remove Java 8 from APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Remove nginx from AST-13', profile: 'write_business', mode: 'write' },
  { prompt: 'Detach Java 8 from APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Désinstalle nginx de AST-13', profile: 'write_business', mode: 'write' },
  { prompt: 'Uninstall nginx from srv-web-01', profile: 'write_general', mode: 'write' },
  { prompt: 'Remplace Java 8 par Java 21 sur APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Replace Java 8 with Java 21 on APP-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Mets PostgreSQL 16 sur CheeseTrack', profile: 'write_general', mode: 'write' },
  { prompt: 'Enregistre Tomcat 9 sur le serveur srv-app-01', profile: 'write_business', mode: 'write' },
  { prompt: 'Upgrade CheeseTrack from PostgreSQL 14 to 16', profile: 'write_general', mode: 'write' },
  { prompt: 'CheeseTrack utilise maintenant Java 21', profile: 'write_general', mode: 'write' },

  // Lot 4: the record and its versions write through the business profile.
  { prompt: 'Crée la technologie Redis', profile: 'write_business', mode: 'write' },
  { prompt: 'Ajoute la technologie Kafka (famille middleware)', profile: 'write_business', mode: 'write' },
  { prompt: 'Passe TEC-3 en fin de vie', profile: 'write_business', mode: 'write' },
  { prompt: 'Update the lifecycle of TEC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'Mets l\'éditeur de TEC-3 à Oracle', profile: 'write_business', mode: 'write' },
  { prompt: 'Ajoute la version 17 à TEC-3', profile: 'write_business', mode: 'write' },
  { prompt: 'La version 16 de PostgreSQL finit son support le 31/12/2028', profile: 'write_business', mode: 'write' },
  { prompt: 'Add version 3.8 to Kafka with end of support 2027-06-30', profile: 'write_business', mode: 'write' },
  { prompt: 'Renomme la version 16 de TEC-3 en 16.4', profile: 'write_business', mode: 'write' },

  // Lot 4: the version and end-of-support questions stay reads.
  { prompt: 'Quelle est la fin de support de PostgreSQL 16 ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Quand la version 14 de TEC-3 finit-elle son support ?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Liste les versions de TEC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Quelles technologies sont en fin de vie ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Qui est responsable de TEC-3 ?', profile: 'entity_inspection', mode: 'entity' },

  // Lot 5: people, web links and vulnerability alerts, with the tool each request needs.
  { prompt: 'Mets Paul Martin responsable IT de TEC-3', profile: 'write_business', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Ajoute Camille Roux comme responsable métier de PostgreSQL', profile: 'write_general', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Retire Paul Martin des responsables de TEC-3', profile: 'write_business', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Ajoute le contact Oracle Support au support de TEC-3', profile: 'write_business', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Add the release notes link https://www.postgresql.org/docs/release/ to PostgreSQL', profile: 'write_relation', mode: 'write', tools: ['update_technology_web_links'] },
  { prompt: 'Supprime le lien https://example.com de TEC-3', profile: 'write_business', mode: 'write', tools: ['update_technology_web_links'] },
  { prompt: 'Désactive les alertes de failles de TEC-3', profile: 'write_business', mode: 'write', tools: ['set_technology_vulnerability_alerts'] },
  { prompt: 'Turn vulnerability alerts back on for PostgreSQL', profile: 'write_business', mode: 'write', tools: ['set_technology_vulnerability_alerts'] },
  { prompt: 'Exclus la version 14 de TEC-3 des alertes', profile: 'write_business', mode: 'write', tools: ['set_technology_vulnerability_alerts'] },
  { prompt: 'Quels liens a la fiche de PostgreSQL ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Les alertes de failles sont-elles actives sur TEC-3 ?', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Who supports PostgreSQL?', profile: 'read_query', mode: 'read' },
  { prompt: "Quelles technologies n'ont pas de responsable IT ?", profile: 'read_query', mode: 'read' },

  // Lot 6: the state verbs need a technology complement; these are reports, not writes.
  { prompt: 'Active applications using PostgreSQL', profile: 'read_query', mode: 'read' },
  { prompt: 'Active technologies with no IT owner', profile: 'read_query', mode: 'read' },
  { prompt: 'Active servers running Windows Server 2012', profile: 'read_query', mode: 'read' },
  { prompt: 'Clear summary of PostgreSQL versions in use', profile: 'read_query', mode: 'read' },
  { prompt: 'Clear list of technologies without an owner, please', profile: 'read_query', mode: 'read' },
  { prompt: 'Exclude retired applications and list those using Java 8', profile: 'read_query', mode: 'read' },

  // Lot 6: the people, web-link and alert writes the lot 5 review reproduced.
  { prompt: 'Make Paul Martin the IT owner of PostgreSQL', profile: 'write_general', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Paul Martin devient responsable IT de TEC-3', profile: 'write_business', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Retire le contact Sage Support de PostgreSQL', profile: 'write_general', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Ajoute Jean Dupont aux contacts de support de Redis avec le rôle Éditeur', profile: 'write_general', mode: 'write', tools: ['update_technology_people'] },
  { prompt: 'Ajoute un lien vers la documentation https://nginx.org/en/docs/ sur nginx', profile: 'write_general', mode: 'write', tools: ['update_technology_web_links'] },
  { prompt: 'Réactive les alertes de failles sur PostgreSQL', profile: 'write_business', mode: 'write', tools: ['set_technology_vulnerability_alerts'] },
  { prompt: 'Stop vulnerability alerts on Windows Server 2012', profile: 'write_business', mode: 'write', tools: ['set_technology_vulnerability_alerts'] },
  { prompt: 'Remets la version 14 de TEC-3 sur le réglage de la technologie pour les alertes', profile: 'write_business', mode: 'write', tools: ['set_technology_vulnerability_alerts'] },

  // Lot 7: "make" opens a write only as "make <name> the IT owner/support contact of"; a
  // determiner or a pronoun after it opens a report.
  { prompt: 'Make a list of technologies without an IT owner', profile: 'read_query', mode: 'read' },
  { prompt: 'Make a report of the business owners of each technology', profile: 'read_query', mode: 'read' },
  { prompt: 'Make a table of the support contacts of Redis', profile: 'read_query', mode: 'read' },
  { prompt: 'Make me a summary of PostgreSQL versions with their IT owner', profile: 'read_query', mode: 'read' },

  // Lot 7: the contact of a technology names the support or a technology; these name a master
  // data contact, so they are master data writes.
  { prompt: 'Retire le contact Marie Durand de ACME', profile: 'write_master_data', mode: 'write', tools: ['update_master_data_record'] },
  { prompt: 'Remove the contact Jane Doe from Acme Corp', profile: 'write_master_data', mode: 'write', tools: ['update_master_data_record'] },
  { prompt: 'Add contact John Smith from Oracle', profile: 'write_master_data', mode: 'write', tools: ['update_master_data_record'] },
  { prompt: 'Change le contact principal de Fromagerie Durand', profile: 'write_master_data', mode: 'write', tools: ['update_master_data_record'] },
  { prompt: 'Mets à jour le contact de Fournisseur Lactalis', profile: 'write_master_data', mode: 'write', tools: ['update_master_data_record'] },

  // Lot 7: the six phrases that came back to their pre-lot 5 profile. A state verb that clears a
  // task field is a task write, and a user account change is a generic write with no AI tool. A
  // location has no disabled state and a portfolio exclusion is a roadmap scenario, so those two
  // name no writable field and stay reads.
  { prompt: 'Efface la description de la tâche T-4', profile: 'write_task', mode: 'write', tools: ['update_task_fields'] },
  { prompt: 'Clear the due date of task T-12', profile: 'write_task', mode: 'write', tools: ['update_task_fields'] },
  { prompt: 'Disable the location LOC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Exclus le projet PRJ-2 du portefeuille', profile: 'entity_inspection', mode: 'entity' },
  { prompt: "Désactive l'utilisateur Paul Martin", profile: 'write_general', mode: 'write' },
  { prompt: 'Active le compte de Julie Bernard', profile: 'write_general', mode: 'write' },

  // Lot 4 review: a noun after upgrade, replace, record or install stays a read; so do a review
  // and the question of who changed a value.
  { prompt: 'Upgrade path for PostgreSQL 12', profile: 'read_query', mode: 'read' },
  { prompt: "Upgrade options for CheeseTrack's database", profile: 'read_query', mode: 'read' },
  { prompt: 'Replace candidates for Java 8 in the portfolio', profile: 'read_query', mode: 'read' },
  { prompt: 'Record the end of support dates of all Java versions in a table', profile: 'read_query', mode: 'read' },
  { prompt: 'Install base of Java 8 per application', profile: 'read_query', mode: 'read' },
  { prompt: 'Passe en revue les technologies en fin de vie', profile: 'read_query', mode: 'read' },
  { prompt: 'Qui a changé la fin de support de PostgreSQL 16 ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Adopte PostgreSQL depuis le catalogue KANAP', profile: 'write_business', mode: 'write', tools: ['create_business_record'] },
  { prompt: 'Adopt Redis from the KANAP catalog', profile: 'write_business', mode: 'write', tools: ['create_business_record'] },
  { prompt: 'Marque TEC-5 comme obsolète', profile: 'write_business', mode: 'write', tools: ['update_business_record'] },
  { prompt: 'Indique que TEC-3 est remplacée par TEC-7', profile: 'write_business', mode: 'write', tools: ['update_business_record'] },
  { prompt: 'Efface la date de fin de support étendu de la version 14 de TEC-3', profile: 'write_business', mode: 'write', tools: ['update_technology_versions'] },

  // Plaid L6: the state of vulnerability rows is a business write; a question or a state word
  // alone stays a read. "Acceptée" is not a state: the model sees the tool and refuses in words.
  // The alert phrases above keep set_technology_vulnerability_alerts.
  { prompt: 'Passe la faille CVE-2024-3094 à traitée', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Marque CVE-2024-1234 comme corrigée sur PostgreSQL 14', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Mets CVE-2024-1234 en non concernée sur TEC-3', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Remets CVE-2024-1234 à traiter', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Traite toutes les failles critiques de TEC-3', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Mark CVE-2024-3094 as handled', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Set CVE-2024-1234 to not affected on nginx 1.24', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Passe la faille CVE-2026-59310 à acceptée', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: 'Passe CVE-2026-1 et CVE-2026-2 à traitée', profile: 'write_business', mode: 'write', tools: ['change_vulnerability_state'] },
  { prompt: "Quel est l'état de CVE-2024-3094 ?", profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Combien de failles sont traitées ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Failles non concernées de TEC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Liste les failles traitées sur PostgreSQL', profile: 'read_query', mode: 'read' },
  { prompt: 'How many vulnerabilities are handled?', profile: 'read_query', mode: 'read' },
  { prompt: 'Which CVEs are not affected on nginx?', profile: 'read_query', mode: 'read' },
  { prompt: 'Combien de failles critiques, en CVE distinctes ?', profile: 'read_query', mode: 'read' },
  // Lot E review: a task phrase stays a task write, whatever vulnerability it names, and
  // "résolue" / "resolved" is not a vulnerability state.
  { prompt: 'Mark the task T-5 about CVE-2024-3094 as resolved', profile: 'write_task', mode: 'write' },
  { prompt: 'Set the task "Patch the vulnerabilities" to resolved', profile: 'write_task', mode: 'write' },
  { prompt: 'Mark task T-12 on the vulnerability scan as handled', profile: 'write_task', mode: 'write' },
  { prompt: 'Passe la tâche T-5 sur la faille CVE-2024-3094 à résolue', profile: 'write_task', mode: 'write' },
  { prompt: 'Mets la tâche « Corriger les failles » en résolue', profile: 'write_task', mode: 'write' },
  // Lot E review: a handle verb on a report, a list or a question reads.
  { prompt: 'Traite les failles de TEC-3 dans un rapport', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Handle this list of CVEs as a CSV', profile: 'read_query', mode: 'read' },
  { prompt: 'Rouvre la liste des failles', profile: 'read_query', mode: 'read' },
  { prompt: 'Traite la question des failles de TEC-3', profile: 'entity_inspection', mode: 'entity' },
  { prompt: 'Handle the vulnerabilities report for TEC-3', profile: 'entity_inspection', mode: 'entity' },

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

  // Technologies: versions, owners and support are read queries (lot L5 technologies).
  { prompt: 'Quelles versions de PostgreSQL ne sont plus utilisées ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Which technology versions reach end of support in 2027?', profile: 'read_query', mode: 'read' },
  { prompt: 'Technologies dont Paul est responsable IT', profile: 'read_query', mode: 'read' },
  { prompt: 'Liste les technologies en version 16', profile: 'read_query', mode: 'read' },
  { prompt: 'Nombre de versions par état de support', profile: 'read_query', mode: 'read' },
  // The technology links (lot L5 lot 3): the flagship phrase, both sides, a version, a removal.
  { prompt: "Ajoute la technologie PostgreSQL en version 16 sur l'application CheeseTrack", profile: 'write_business', mode: 'write' },
  { prompt: 'Ajoute TEC-3 à APP-36', profile: 'write_relation', mode: 'write' },
  { prompt: 'Installe nginx 1.26 sur AST-12', profile: 'write_relation', mode: 'write' },
  { prompt: 'Retire PostgreSQL 14 de CheeseTrack', profile: 'write_general', mode: 'write' },
  { prompt: 'Add PostgreSQL 16 to CheeseTrack and its servers', profile: 'write_business', mode: 'write' },
  { prompt: 'Déclare Java 21 sur APP-36', profile: 'write_relation', mode: 'write' },
  // The End of support report and the application dates (lot L5 lot 2).
  { prompt: 'Quelles applications ont une fin de support dans les six mois ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Quelles fiches faut-il compléter pour le rapport de fin de support ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Which servers have no host?', profile: 'read_query', mode: 'read' },
  { prompt: 'Échéances de fin de support des douze prochains mois par type', profile: 'read_query', mode: 'read' },
  { prompt: 'Applications mises en service en 2025', profile: 'read_query', mode: 'read' },

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

  // Plaid L7, lot C: the history of one record is a read that carries get_record_history. An
  // application has no History tab: the phrase keeps the tool, which answers so.
  { prompt: 'Historique de OPEX-12', profile: 'entity_inspection', mode: 'entity', tools: ['get_record_history'] },
  { prompt: 'Qui a modifié AST-3 ?', profile: 'read_query', mode: 'read', tools: ['get_record_history'] },
  { prompt: 'What changed on TEC-3 last week?', profile: 'entity_inspection', mode: 'entity', tools: ['get_record_history'] },
  { prompt: 'Historique de APP-36', profile: 'entity_inspection', mode: 'entity', tools: ['get_record_history'] },
  { prompt: 'Historique des modifications de TEC-3', profile: 'entity_inspection', mode: 'entity', tools: ['get_record_history'] },

  // Plaid L7, lot D: the roles and data access are reads of the common tools (`roles`,
  // `role_permissions`, `data_access`, the person and company details); the history of a record
  // carries get_record_history.
  { prompt: 'Qui a un accès limité aux données et à quoi ?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'aggregate_entities', 'get_entity_detail'] },
  { prompt: 'Who has limited data access?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'aggregate_entities', 'get_entity_detail'] },
  { prompt: 'Que voit Paul Martin ?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'get_entity_detail'] },
  { prompt: 'Quels sont les droits du rôle Budget Member ?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'get_entity_detail'] },
  { prompt: 'Which roles give budget admin?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'aggregate_entities'] },
  { prompt: 'Combien de personnes ont le rôle Budget Member ?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'aggregate_entities'] },
  { prompt: 'Qui voit la société Formaggio Supremo SRL ?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'get_entity_detail'] },
  { prompt: 'Qui a modifié TEC-3 ?', profile: 'read_query', mode: 'read', tools: ['get_record_history'] },
  { prompt: 'À quoi ai-je accès ?', profile: 'read_query', mode: 'read' },
  { prompt: 'Quel rôle a Paul Martin ?', profile: 'read_query', mode: 'read', tools: ['query_entities', 'get_entity_detail'] },
  { prompt: 'Make a list of the roles with budget admin', profile: 'read_query', mode: 'read' },
  // A person's access, roles or rights: no tool makes them, the write profile refuses in words (a
  // role named Budget Member is no budget write).
  { prompt: 'Donne l\'accès complet à Paul Martin', profile: 'write_general', mode: 'write' },
  { prompt: 'Ajoute le rôle Budget Member à Paul Martin', profile: 'write_general', mode: 'write' },
  { prompt: 'Grant Paul Martin full access', profile: 'write_general', mode: 'write' },
  { prompt: 'Give Paul Martin access to all data', profile: 'write_general', mode: 'write' },
  { prompt: 'Retire le droit budget du rôle Finance', profile: 'write_general', mode: 'write' },
  { prompt: 'Supprime le rôle Finance custom', profile: 'write_general', mode: 'write' },
  { prompt: 'Mets Paul Martin en accès limité', profile: 'write_general', mode: 'write' },
  // The product named Access stays a technology write.
  { prompt: 'Ajoute Microsoft Access à AST-3', profile: 'write_business', mode: 'write' },
];

function testTheTable() {
  assert.ok(FIXTURE_ROWS.length >= 253, `the table carries ${FIXTURE_ROWS.length} lines`);

  for (const row of FIXTURE_ROWS) {
    const profile = selectAiContextProfile(row.prompt);
    assert.equal(profile.name, row.profile, `${row.prompt}: expected ${row.profile}`);
    assert.equal(profile.promptMode, row.mode, `${row.prompt}: expected prompt mode ${row.mode}`);
    for (const tool of row.tools ?? []) {
      assert.ok(profile.toolNames.includes(tool as any), `${row.prompt}: expected ${tool}`);
    }
  }
}

/**
 * The technology link phrases of the lot 4 review, in English and in French: the write mode is the
 * point (a read loses the preview guidance), and the tool that carries the link must be in it.
 */
function testTheTechnologyLinkPhrasesCarryTheTool() {
  const prompts = [
    'Remove Java 8 from APP-3',
    'Remove nginx from AST-13',
    'Detach Java 8 from APP-3',
    'Désinstalle nginx de AST-13',
    'Uninstall nginx from srv-web-01',
    'Remplace Java 8 par Java 21 sur APP-3',
    'Replace Java 8 with Java 21 on APP-3',
    'Mets PostgreSQL 16 sur CheeseTrack',
    'Enregistre Tomcat 9 sur le serveur srv-app-01',
    'Upgrade CheeseTrack from PostgreSQL 14 to 16',
    'CheeseTrack utilise maintenant Java 21',
    'Renomme la version 16 de TEC-3 en 16.4',
    'La version 16 de PostgreSQL finit son support le 31/12/2028',
  ];
  for (const prompt of prompts) {
    const profile = selectAiContextProfile(prompt);
    assert.equal(profile.promptMode, 'write', `${prompt}: expected the write mode`);
    assert.ok(profile.toolNames.includes('update_technology_links'), `${prompt}: expected update_technology_links`);
    assert.ok(profile.toolNames.includes('update_technology_versions'), `${prompt}: expected update_technology_versions`);
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

/** No tool writes a person's access or roles: the write profiles of those phrases carry none. */
function testTheAccessWritesCarryNoAccessTool() {
  for (const prompt of ['Donne l\'accès complet à Paul Martin', 'Ajoute le rôle Budget Member à Paul Martin']) {
    const profile = selectAiContextProfile(prompt);
    const accessTools = profile.toolNames.filter((tool) => /access|role|permission|user/.test(tool));
    assert.deepEqual(accessTools, [], `${prompt}: no access tool`);
  }
}

function run() {
  testTheTable();
  testTheAccessWritesCarryNoAccessTool();
  testTheTechnologyLinkPhrasesCarryTheTool();
  testTheFixturePhrasesAreAllPresent();
  console.log(`  context profile table: ${FIXTURE_ROWS.length} lines, OK`);
}

run();
