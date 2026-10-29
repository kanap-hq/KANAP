import * as assert from 'node:assert/strict';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiWriteLanguage, aiWriteLanguage, deletionImpactText, incidentLinkCardText, personWriteLanguage } from '../ai-write-texts';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { AiDocumentMutationSupportService } from '../mutation/ai-document-mutation-support.service';
import { AiFinancialPlanMutationSupportService } from '../mutation/ai-financial-plan-mutation-support.service';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';
import { AiRelationMutationSupportService } from '../mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from '../mutation/ai-task-mutation-support.service';
import { AddIncidentNoteAiMutationOperation } from '../mutation/operations/add-incident-note.ai-mutation-operation';
import { ChangeIncidentStateAiMutationOperation } from '../mutation/operations/change-incident-state.ai-mutation-operation';
import { CreateBusinessRecordAiMutationOperation } from '../mutation/operations/create-business-record.ai-mutation-operation';
import { CreateDocumentAiMutationOperation } from '../mutation/operations/create-document.ai-mutation-operation';
import { CreateTaskAiMutationOperation } from '../mutation/operations/create-task.ai-mutation-operation';
import { DeleteRecordAiMutationOperation } from '../mutation/operations/delete-record.ai-mutation-operation';
import { ImportGlpiTicketAiMutationOperation } from '../mutation/operations/import-glpi-ticket.ai-mutation-operation';
import { SetIncidentConfidentialityAiMutationOperation } from '../mutation/operations/set-incident-confidentiality.ai-mutation-operation';
import { UpdateIncidentLinksAiMutationOperation } from '../mutation/operations/update-incident-links.ai-mutation-operation';
import { UpdateTechnologyLinksAiMutationOperation } from '../mutation/operations/update-technology-links.ai-mutation-operation';
import { UpdateTechnologyPeopleAiMutationOperation } from '../mutation/operations/update-technology-people.ai-mutation-operation';
import { UpdateTechnologyWebLinksAiMutationOperation } from '../mutation/operations/update-technology-web-links.ai-mutation-operation';
import { ChangeVulnerabilityStateAiMutationOperation } from '../mutation/operations/change-vulnerability-state.ai-mutation-operation';
import { SetTechnologyVulnerabilityAlertsAiMutationOperation } from '../mutation/operations/set-technology-vulnerability-alerts.ai-mutation-operation';
import { UpdateTechnologyVersionsAiMutationOperation } from '../mutation/operations/update-technology-versions.ai-mutation-operation';
import { UpdateTaskAssigneeAiMutationOperation } from '../mutation/operations/update-task-assignee.ai-mutation-operation';
import { UpdateTaskStatusAiMutationOperation } from '../mutation/operations/update-task-status.ai-mutation-operation';

/**
 * The summaries of the preview cards, in the person's language (draft 126): the action while it
 * waits, then the card's status word and the action. English keeps its sentences.
 */

// presentPreview reads only the preview: the services it is built with are not needed here.
const make = <T>(type: new (...args: any[]) => T): T => new (type as any)();

function preview(overrides: Partial<AiMutationPreview>): AiMutationPreview {
  return {
    id: 'preview-1',
    tool_name: 'create_task',
    status: 'pending',
    target_entity_type: 'tasks',
    target_entity_id: null,
    mutation_input: {},
    current_values: {},
    error_message: null,
    ...overrides,
  } as AiMutationPreview;
}

function summary(
  operation: { presentPreview(preview: AiMutationPreview, language?: AiWriteLanguage): { summary: string } },
  value: AiMutationPreview,
  language: AiWriteLanguage,
): string {
  return operation.presentPreview(value, language).summary;
}

function testTaskCreation() {
  const operation = make(CreateTaskAiMutationOperation);
  const pending = preview({
    mutation_input: {
      title: 'Migration',
      relation_type: 'project',
      relation_label: 'PRJ-5 - ERP',
      assignee_label: 'Anne Martin',
      priority_level: 'high',
    },
  });
  assert.equal(
    summary(operation, pending, 'en'),
    'Create task "Migration" on PRJ-5 - ERP. Assignee: Anne Martin. Priority: High.',
  );
  assert.equal(
    summary(operation, pending, 'fr'),
    'Création de la tâche « Migration » sur PRJ-5 - ERP. Responsable : Anne Martin. Priorité : Haute.',
  );
  assert.equal(
    summary(operation, pending, 'es'),
    'Creación de la tarea «Migration» en PRJ-5 - ERP. Asignado a: Anne Martin. Prioridad: Alta.',
  );
  assert.equal(
    summary(operation, preview({ mutation_input: { title: 'Note', relation_type: 'standalone' } }), 'de'),
    'Eigenständige Aufgabe „Note“ erstellen. Priorität: Mittel.',
  );
  const executed = preview({ ...pending, status: 'executed', current_values: { target_ref: 'T-45' } });
  assert.equal(summary(operation, executed, 'en'), 'Created T-45.');
  assert.equal(summary(operation, executed, 'fr'), 'Appliqué : création de la tâche T-45.');
  const rejected = preview({ ...pending, status: 'rejected' });
  assert.equal(summary(operation, rejected, 'en'), 'Task creation preview for "Migration" was rejected.');
  assert.equal(summary(operation, rejected, 'fr'), 'Rejeté : création de la tâche « Migration ».');
  assert.equal(summary(operation, rejected, 'es'), 'Rechazada: creación de la tarea «Migration».');
  // A failure shows its error, whatever the language.
  const failed = preview({ ...pending, status: 'failed', error_message: 'Task type not found.' });
  assert.equal(summary(operation, failed, 'de'), 'Task type not found.');
}

function testTaskStatusAndAssignee() {
  const status = make(UpdateTaskStatusAiMutationOperation);
  const change = preview({
    tool_name: 'update_task_status',
    mutation_input: { status: 'in_progress' },
    current_values: { target_ref: 'T-45', status: 'open' },
  });
  assert.equal(summary(status, change, 'en'), 'Update T-45 status from open to in progress.');
  assert.equal(summary(status, change, 'fr'), 'Changement de statut de T-45 (Ouvert → En cours).');
  assert.equal(summary(status, { ...change, status: 'rejected' } as AiMutationPreview, 'de'),
    'Abgelehnt: Status von T-45 ändern (Offen → In Bearbeitung).');

  const assignee = make(UpdateTaskAssigneeAiMutationOperation);
  const reassign = preview({
    tool_name: 'update_task_assignee',
    mutation_input: { assignee_label: 'Anne Martin' },
    current_values: { target_ref: 'T-45', assignee_label: null },
  });
  assert.equal(summary(assignee, reassign, 'fr'), "Changement d'assignation de T-45 (Non assigné → Anne Martin).");
}

function testTicketImport() {
  const operation = make(ImportGlpiTicketAiMutationOperation);
  const pending = preview({
    tool_name: 'import_glpi_ticket',
    mutation_input: {
      title: 'Printer down',
      relation_type: 'standalone',
      glpi_ticket_id: '12',
      priority_level: 'normal',
      glpi_followup_public_count: 2,
    },
  });
  assert.equal(
    summary(operation, pending, 'fr'),
    'Import du ticket GLPI n° 12 en tâche « Printer down ». Priorité : Moyenne. Suivis publics à importer en commentaires : 2.',
  );
}

function testDocumentCreation() {
  const operation = new CreateDocumentAiMutationOperation(make(AiDocumentMutationSupportService), null as any);
  const pending = preview({
    tool_name: 'create_document',
    target_entity_type: 'documents',
    mutation_input: { title: 'Plan de reprise', library_name: 'Procédures', status: 'draft' },
  });
  assert.equal(summary(operation, pending, 'en'), 'Create draft document "Plan de reprise" in Procédures.');
  assert.equal(summary(operation, pending, 'fr'), 'Création du document « Plan de reprise » dans Procédures.');
  const executed = preview({ ...pending, status: 'executed', current_values: { target_ref: 'DOC-178' } });
  assert.equal(summary(operation, executed, 'es'), 'Aplicada: creación del documento DOC-178.');
}

function testBusinessRecords() {
  const support = make(AiBusinessRecordMutationSupportService);
  const criticality = preview({
    tool_name: 'update_business_record',
    target_entity_type: 'applications',
    target_entity_id: 'app-1',
    mutation_input: {
      action: 'update',
      entity_type: 'applications',
      fields: { criticality: 'high' },
      display_values: { criticality: 'High' },
      field_labels: { criticality: 'Business criticality' },
    },
    current_values: { target_title: 'CheeseTrack', display_values: { criticality: 'Moderate' } },
  });
  assert.equal(summary(support, criticality, 'en'), 'Update application "CheeseTrack": Business criticality.');
  assert.equal(summary(support, criticality, 'fr'), "Modification de l'application « CheeseTrack ».");
  assert.equal(summary(support, { ...criticality, status: 'rejected' } as AiMutationPreview, 'es'),
    'Rechazada: modificación de la aplicación «CheeseTrack».');
  assert.equal(summary(support, { ...criticality, status: 'executed' } as AiMutationPreview, 'de'),
    'Angewendet: Anwendung „CheeseTrack“ ändern.');

  const masterData = make(AiMasterDataMutationSupportService);
  const supplier = preview({
    tool_name: 'create_master_data_record',
    target_entity_type: 'suppliers',
    mutation_input: { action: 'create', entity_type: 'suppliers', fields: { name: 'Acme' }, display_values: { name: 'Acme' } },
  });
  assert.equal(summary(masterData, supplier, 'fr'), 'Création du fournisseur « Acme ».');
}

function testIncidentPreviewsAndWarnings() {
  const support = make(AiBusinessRecordMutationSupportService);
  const createIncident = preview({
    tool_name: 'create_business_record',
    target_entity_type: 'incidents',
    mutation_input: {
      action: 'create',
      entity_type: 'incidents',
      fields: { title: 'Mail outage', severity: 'major', status: 'open' },
      display_values: { title: 'Mail outage', severity: 'major', status: 'open' },
      field_labels: { title: 'Title', severity: 'Severity', status: 'Status' },
    },
    current_values: { target_title: 'Mail outage' },
  });
  assert.equal(summary(support, createIncident, 'en'), 'Create incident "Mail outage".');
  assert.equal(summary(support, createIncident, 'fr'), "Création de l'incident « Mail outage ».");
  assert.equal(summary(support, createIncident, 'de'), 'Vorfall „Mail outage“ erstellen.');
  assert.equal(summary(support, createIncident, 'es'), 'Creación del incidente «Mail outage».');
  const created = support.presentPreview(createIncident, 'fr').changes;
  assert.equal(created.status.to, 'open', 'the card carries the status code, the frontend names it');
  assert.equal(created.severity.to, 'major', 'the card carries the severity code, the frontend names it');

  const closure = preview({
    tool_name: 'update_business_record',
    target_entity_type: 'incidents',
    target_entity_id: 'incident-1',
    mutation_input: {
      action: 'update',
      entity_type: 'incidents',
      fields: { status: 'closed' },
      display_values: { status: 'closed' },
      field_labels: { status: 'Status' },
      warnings: { closure: true },
    },
    current_values: { target_ref: 'INC-7', target_title: 'INC-7 - Mail outage', values: { status: 'open' }, display_values: { status: 'open' } },
  });
  const closed = support.presentPreview(closure, 'fr').changes;
  assert.equal(closed.status.from, 'open');
  assert.equal(closed.status.to, 'closed');
  assert.equal(closed.closure_warning.to, "Cette clôture fige l'incident : seul un administrateur pourra le rouvrir.");
  assert.equal(summary(support, closure, 'en'), 'Update incident "INC-7 - Mail outage": Status.');

  const lost = support.presentPreview({ ...closure, mutation_input: { ...closure.mutation_input, fields: { confidential: true }, display_values: { confidential: 'true' }, warnings: { lose_access: true } } } as AiMutationPreview, 'es').changes;
  assert.equal(lost.access_warning.to, 'Tras este cambio, solo los administradores del registro, el notificante y el responsable podrán abrirlo. Volverá al registro.');
  assert.equal(lost.access_warning.label, 'Access');
}

function testIncidentNoteAndLinkCards() {
  const note = make(AddIncidentNoteAiMutationOperation);
  const pendingNote = preview({
    tool_name: 'add_incident_note',
    target_entity_type: 'incidents',
    target_entity_id: 'incident-1',
    mutation_input: {
      content: 'Mail is back.\nFailover to the secondary site done.',
      occurred_at: '2026-10-28T14:00:00.000Z',
    },
    current_values: { target_ref: 'INC-7', target_title: 'INC-7 - Mail outage', status: 'open' },
  });
  assert.equal(summary(note, pendingNote, 'en'), 'Add a note to INC-7 - Mail outage.');
  assert.equal(summary(note, pendingNote, 'fr'), "Ajout d'une note à l'incident « INC-7 - Mail outage ».");
  assert.equal(summary(note, pendingNote, 'de'), 'Notiz zum Vorfall „INC-7 - Mail outage“ hinzufügen.');
  assert.equal(summary(note, pendingNote, 'es'), 'Adición de una nota al incidente «INC-7 - Mail outage».');
  const noteChanges = note.presentPreview(pendingNote, 'fr').changes;
  assert.equal(noteChanges.note.to, 'Mail is back.\nFailover to the secondary site done.');
  assert.equal(noteChanges.note.label, 'Note');
  assert.equal(noteChanges.occurred_at.to, '2026-10-28T14:00:00.000Z');
  assert.equal(noteChanges.occurred_at.label, "Date de l'événement");
  assert.equal(summary(note, { ...pendingNote, status: 'executed' } as AiMutationPreview, 'fr'), "Appliqué : ajout d'une note à l'incident « INC-7 - Mail outage ».");

  const links = make(UpdateIncidentLinksAiMutationOperation);
  const pendingLinks = preview({
    tool_name: 'update_incident_links',
    target_entity_type: 'incidents',
    target_entity_id: 'incident-1',
    mutation_input: {
      changes: {
        assets: {
          add: [{ id: 'asset-12', ref: 'AST-12', name: 'PAR-ESX-01', label: 'AST-12 - PAR-ESX-01' }],
          remove: [],
          already: [],
          absent: [],
        },
        applications: {
          add: [],
          remove: [{ id: 'app-2', ref: 'APP-2', name: 'Mail', label: 'APP-2 - Mail' }],
          already: [],
          absent: [],
        },
        technologies: {
          add: [],
          remove: [],
          already: [{ id: 'tec-3', ref: 'TEC-3', name: 'PostgreSQL', label: 'TEC-3 - PostgreSQL' }],
          absent: [],
        },
      },
    },
    current_values: { target_ref: 'INC-7', target_title: 'INC-7 - Mail outage', status: 'open' },
  });
  assert.equal(summary(links, pendingLinks, 'en'), 'Update the links of INC-7 - Mail outage.');
  assert.equal(summary(links, pendingLinks, 'fr'), "Modification des liens de l'incident « INC-7 - Mail outage ».");
  assert.equal(summary(links, pendingLinks, 'de'), 'Verknüpfungen des Vorfalls „INC-7 - Mail outage“ ändern.');
  assert.equal(summary(links, pendingLinks, 'es'), 'Modificación de los vínculos del incidente «INC-7 - Mail outage».');
  const linkChanges = links.presentPreview(pendingLinks, 'fr').changes;
  assert.equal(linkChanges.linked_assets.label, 'Actifs liés');
  assert.equal(linkChanges.linked_assets.to, '**Ajoutés**\n- AST-12 - PAR-ESX-01');
  assert.equal(linkChanges.linked_applications.to, '**Retirés**\n- APP-2 - Mail');
  assert.equal(linkChanges.linked_technologies.to, '**Déjà liés**\n- TEC-3 - PostgreSQL');
  assert.equal(summary(links, { ...pendingLinks, status: 'executed' } as AiMutationPreview, 'fr'), "Appliqué : modification des liens de l'incident « INC-7 - Mail outage ».");
  // A record's label is data: its Markdown characters never style the card.
  assert.equal(
    incidentLinkCardText('fr', {
      add: ['AST-12 - srv_*prod*'],
      remove: ['APP-2 - app_[old]'],
      already: [],
      absent: [],
    }),
    '**Ajoutés**\n- AST-12 - srv\\_\\*prod\\*\n\n**Retirés**\n- APP-2 - app\\_\\[old\\]',
  );
  // The backslash first, then the inline emphasis, then the characters that structure a line.
  const escaped = (label: string) => incidentLinkCardText('fr', { add: [label], remove: [], already: [], absent: [] });
  assert.equal(escaped('C:\\temp\\srv~old'), '**Ajoutés**\n- C:\\\\temp\\\\srv\\~old');
  assert.equal(escaped('> quoted'), '**Ajoutés**\n- \\> quoted');
  assert.equal(escaped('- nested'), '**Ajoutés**\n- \\- nested');
  assert.equal(escaped('+ plus'), '**Ajoutés**\n- \\+ plus');
  assert.equal(escaped('1. ordered'), '**Ajoutés**\n- 1\\. ordered');
  assert.equal(escaped('version 1.2'), '**Ajoutés**\n- version 1.2');
}

function testTechnologyLinkCards() {
  const operation = make(UpdateTechnologyLinksAiMutationOperation);
  const version16 = {
    id: 'version-16', label: '16', created: false,
    standard_support_end: '2028-11-09', extended_support_end: null,
  };
  const application = { id: 'app-36', ref: 'APP-36', name: 'CheeseTrack', label: 'APP-36 - CheeseTrack' };
  const server = { id: 'asset-12', ref: 'AST-12', name: 'srv-db-01', label: 'AST-12 - srv-db-01' };
  const empty = { add: [], remove: [], already: [], absent: [] };
  const pending = preview({
    tool_name: 'update_technology_links',
    target_entity_type: 'technologies',
    target_entity_id: 'tec-1',
    mutation_input: {
      technology_ref: 'TEC-1',
      technology_name: 'PostgreSQL',
      technology_label: 'TEC-1 - PostgreSQL',
      changes: {
        applications: {
          ...empty,
          add: [{ application, version: version16, servers: [{ server, install: true }] }],
          remove: [{ application: { id: 'app-2', ref: 'APP-2', name: 'Mail', label: 'APP-2 - Mail' }, version: null, allVersions: true, declarations: [] }],
        },
        servers: {
          ...empty,
          already: [{ server: { id: 'asset-13', ref: 'AST-13', name: 'srv-web-01', label: 'AST-13 - srv-web-01' }, version: null }],
        },
      },
    },
    current_values: { target_ref: 'TEC-1', target_title: 'TEC-1 - PostgreSQL' },
  });
  assert.equal(summary(operation, pending, 'en'), 'Update the links of TEC-1 - PostgreSQL.');
  assert.equal(summary(operation, pending, 'fr'), 'Modification des liens de « TEC-1 - PostgreSQL ».');
  assert.equal(summary(operation, pending, 'de'), 'Verknüpfungen von „TEC-1 - PostgreSQL“ ändern.');
  assert.equal(summary(operation, pending, 'es'), 'Modificación de los vínculos de «TEC-1 - PostgreSQL».');
  const changes = operation.presentPreview(pending, 'en').changes;
  assert.equal(
    changes.technology_applications.to,
    '**Added**\n- APP-36 - CheeseTrack: PostgreSQL 16 (existing, end of support 2028-11-09)'
    + '\n\n**Removed**\n- APP-2 - Mail',
    'the application card',
  );
  assert.equal(
    changes.technology_servers.to,
    '**Added**\n- AST-12 - srv-db-01: PostgreSQL 16 (existing, end of support 2028-11-09)'
    + '\n\n**Already equipped**\n- AST-13 - srv-web-01',
    'the server card',
  );
  assert.equal(summary(operation, { ...pending, status: 'executed' } as AiMutationPreview, 'fr'),
    'Appliqué : modification des liens de « TEC-1 - PostgreSQL ».');
  const undo = preview({
    ...pending,
    mutation_input: { ...(pending.mutation_input ?? {}), kept_versions: ['17'] },
  });
  assert.equal(
    operation.presentPreview(undo, 'fr').changes.technology_versions.to,
    "**Conservées**\n- nouvelle version 17, sans date de support (l'annulation retire les liens, pas la version)",
  );
}


/**
 * Lot 5: the people, web links and vulnerability alert cards, and their summaries in the four
 * languages. The headings agree with their subject in French and Spanish.
 */
function testTechnologyPeopleLinksAndAlertsCards() {
  const target = { target_ref: 'TEC-1', target_title: 'TEC-1 - PostgreSQL' };

  const people = make(UpdateTechnologyPeopleAiMutationOperation);
  const peoplePreview = preview({
    tool_name: 'update_technology_people',
    target_entity_type: 'technologies',
    target_entity_id: 'tec-1',
    mutation_input: {
      technology_ref: 'TEC-1',
      technology_name: 'PostgreSQL',
      technology_label: 'TEC-1 - PostgreSQL',
      owners: {
        add: [{ name: 'Paul Martin', owner_type: 'it' }],
        remove: [{ name: 'Anne Roux', owner_type: 'business' }],
        already: [{ name: 'Luc Martin', owner_type: 'it' }],
        absent: [{ name: 'Zoé Petit', owner_type: null }],
      },
      support_contacts: {
        add: [{ name: 'Oracle Support', role: 'Support' }],
        remove: [],
        already: [],
        absent: [],
      },
      touches_contacts: true,
    },
    current_values: target,
  });
  assert.equal(summary(people, peoplePreview, 'en'), 'Update the people of TEC-1 - PostgreSQL.');
  assert.equal(summary(people, peoplePreview, 'fr'), 'Modification des responsables et contacts de « TEC-1 - PostgreSQL ».');
  assert.equal(summary(people, peoplePreview, 'de'), 'Verantwortliche und Kontakte von „TEC-1 - PostgreSQL“ ändern.');
  assert.equal(summary(people, peoplePreview, 'es'), 'Modificación de los responsables y contactos de «TEC-1 - PostgreSQL».');
  const peopleChanges = people.presentPreview(peoplePreview, 'en').changes;
  assert.equal(
    peopleChanges.technology_owners.to,
    '**Added**\n- Paul Martin (IT owner)\n\n**Removed**\n- Anne Roux (business owner)'
    + '\n\n**Already owners**\n- Luc Martin (IT owner)\n\n**Not owners**\n- Zoé Petit',
  );
  assert.equal(
    people.presentPreview(peoplePreview, 'fr').changes.technology_support_contacts.to,
    '**Ajoutés**\n- Oracle Support (rôle : Support)',
  );
  const peopleUndo = preview({
    ...peoplePreview,
    mutation_input: {
      technology_ref: 'TEC-1', technology_label: 'TEC-1 - PostgreSQL', reverse_of: 'preview-0',
      owners_restore: [{ user_id: 'u-1', owner_type: 'it', name: 'Paul Martin' }],
      contacts_restore: [],
    },
  });
  assert.equal(
    people.presentPreview(peopleUndo, 'fr').changes.technology_owners.to,
    '**Responsables restaurés**\n- Paul Martin (responsable IT)',
  );

  const links = make(UpdateTechnologyWebLinksAiMutationOperation);
  const linksPreview = preview({
    tool_name: 'update_technology_web_links',
    target_entity_type: 'technologies',
    target_entity_id: 'tec-1',
    mutation_input: {
      technology_ref: 'TEC-1',
      technology_name: 'PostgreSQL',
      technology_label: 'TEC-1 - PostgreSQL',
      add: [{ url: 'https://example.com/runbook', description: 'Runbook' }],
      update: [{
        id: 'link-1',
        before: { id: 'link-1', url: 'https://example.com/old', description: null },
        url: 'https://example.com/new',
        description: 'Release notes',
        descriptionGiven: true,
      }],
      remove: [{ id: 'link-2', before: { id: 'link-2', url: 'https://example.com/gone', description: null } }],
      already: [],
      absent: ['https://example.com/missing'],
    },
    current_values: target,
  });
  assert.equal(summary(links, linksPreview, 'en'), 'Update the web links of TEC-1 - PostgreSQL.');
  assert.equal(summary(links, linksPreview, 'fr'), 'Modification des liens web de « TEC-1 - PostgreSQL ».');
  assert.equal(
    links.presentPreview(linksPreview, 'en').changes.technology_web_links.to,
    '**Added**\n- https://example.com/runbook (Runbook)'
    + '\n\n**Updated**\n- https://example.com/old → https://example.com/new (description: Release notes)'
    + '\n\n**Removed**\n- https://example.com/gone'
    + '\n\n**Not present**\n- https://example.com/missing',
  );
  assert.equal(
    links.presentPreview(linksPreview, 'fr').changes.technology_web_links.to,
    '**Ajoutés**\n- https://example.com/runbook (Runbook)'
    + '\n\n**Modifiés**\n- https://example.com/old → https://example.com/new (description : Release notes)'
    + '\n\n**Retirés**\n- https://example.com/gone'
    + '\n\n**Non présents**\n- https://example.com/missing',
  );

  const alerts = make(SetTechnologyVulnerabilityAlertsAiMutationOperation);
  const alertsPreview = preview({
    tool_name: 'set_technology_vulnerability_alerts',
    target_entity_type: 'technologies',
    target_entity_id: 'tec-1',
    mutation_input: {
      enabled: { from: true, to: false, cleared: ['14', '16'] },
      versions: [{ id: 'v-17', label: '17', from: null, to: false, propagated: ['17 SP1'] }],
    },
    current_values: target,
  });
  assert.equal(summary(alerts, alertsPreview, 'en'), 'Set the vulnerability alerts of TEC-1 - PostgreSQL.');
  assert.equal(summary(alerts, alertsPreview, 'fr'), 'Modification des alertes de vulnérabilité de « TEC-1 - PostgreSQL ».');
  assert.equal(
    alerts.presentPreview(alertsPreview, 'en').changes.technology_vulnerability_alerts.to,
    '- off'
    + '\n- 2 version exceptions will be cleared: 14, 16'
    + '\n\n**Versions**\n- 17: follows the technology → alerts off\n  - the service packs 17 SP1 follow base version 17',
  );
  assert.equal(
    alerts.presentPreview(alertsPreview, 'fr').changes.technology_vulnerability_alerts.to,
    '- désactivées'
    + '\n- 2 exceptions de version seront effacées : 14, 16'
    + '\n\n**Versions**\n- 17 : suit la technologie → alertes désactivées\n  - les service packs 17 SP1 suivent la version de base 17',
  );
  assert.equal(
    alerts.presentPreview({ ...alertsPreview, status: 'executed' } as AiMutationPreview, 'en').changes.technology_vulnerability_alerts.to,
    '- off'
    + '\n- 2 version exceptions cleared: 14, 16'
    + '\n\n**Versions**\n- 17: follows the technology → alerts off\n  - the service packs 17 SP1 follow base version 17',
  );
}

function testVulnerabilityStateCards() {
  const operation = make(ChangeVulnerabilityStateAiMutationOperation);
  const example = (cve: string, version: string | null) => ({ cve_id: cve, technology: 'TEC-3', technology_name: 'PostgreSQL', version });
  const handled = preview({
    tool_name: 'change_vulnerability_state',
    target_entity_type: 'vulnerabilities',
    mutation_input: { state: 'handled', note: 'Patched in 14.2' },
    current_values: {
      values: {
        rows: 5,
        cves: 2,
        changes: 3,
        from_states: ['to_review', 'not_affected'],
        outside_alerts: 1,
        no_longer_matching: 0,
        examples: [example('CVE-2024-1111', '14'), example('CVE-2024-1111', null), example('CVE-2024-2222', '15')],
      },
    },
  });
  const card = (value: AiMutationPreview, language: AiWriteLanguage) => operation.presentPreview(value, language).changes.vulnerability_state.to;
  assert.equal(summary(operation, handled, 'en'), 'Change the state of 3 vulnerability rows to Handled.');
  assert.equal(
    card(handled, 'en'),
    '3 of 5 rows (2 CVEs): To review, Not affected → Handled'
    + '\n\nNote: "Patched in 14.2"'
    + '\n\n- CVE-2024-1111 on TEC-3 PostgreSQL 14\n- CVE-2024-1111 on TEC-3 PostgreSQL (version not recorded)\n- CVE-2024-2222 on TEC-3 PostgreSQL 15'
    + '\n\n1 is outside the vulnerability alerts',
  );
  assert.equal(summary(operation, handled, 'fr'), "Passage de 3 lignes de vulnérabilités à l'état « Traitée ».");
  assert.equal(
    card(handled, 'fr'),
    '3 lignes sur 5 (2 CVE) : À traiter, Non concernée → Traitée'
    + '\n\nNote : « Patched in 14.2 »'
    + '\n\n- CVE-2024-1111 sur TEC-3 PostgreSQL 14\n- CVE-2024-1111 sur TEC-3 PostgreSQL (version non renseignée)\n- CVE-2024-2222 sur TEC-3 PostgreSQL 15'
    + '\n\n1 est hors des alertes de vulnérabilité',
  );
  assert.equal(summary(operation, handled, 'de'), '3 Zeilen der Schwachstellen auf „Behandelt“ setzen.');
  assert.equal(
    card(handled, 'de'),
    '3 von 5 Zeilen (2 CVE): Zu prüfen, Nicht betroffen → Behandelt'
    + '\n\nNotiz: „Patched in 14.2“'
    + '\n\n- CVE-2024-1111 auf TEC-3 PostgreSQL 14\n- CVE-2024-1111 auf TEC-3 PostgreSQL (Version nicht erfasst)\n- CVE-2024-2222 auf TEC-3 PostgreSQL 15'
    + '\n\n1 ist nicht in den Schwachstellenwarnungen',
  );
  assert.equal(summary(operation, handled, 'es'), 'Paso de 3 filas de vulnerabilidades al estado «Tratada».');
  assert.equal(
    card(handled, 'es'),
    '3 filas de 5 (2 CVE): Por revisar, No afectada → Tratada'
    + '\n\nNota: «Patched in 14.2»'
    + '\n\n- CVE-2024-1111 en TEC-3 PostgreSQL 14\n- CVE-2024-1111 en TEC-3 PostgreSQL (versión no registrada)\n- CVE-2024-2222 en TEC-3 PostgreSQL 15'
    + '\n\n1 está fuera de las alertas de vulnerabilidad',
  );
  assert.equal(operation.presentPreview(handled, 'fr').changes.vulnerability_state.label, 'État de la vulnérabilité');
  assert.equal(operation.presentPreview(handled, 'fr').target.title, '2 CVE');

  // Back to review: the note cleared, the rows that disappear, more rows than the card lists.
  const review = preview({
    tool_name: 'change_vulnerability_state',
    target_entity_type: 'vulnerabilities',
    mutation_input: { state: 'to_review', note: null },
    current_values: {
      values: {
        rows: 7,
        cves: 1,
        changes: 7,
        from_states: ['handled'],
        outside_alerts: 0,
        no_longer_matching: 2,
        examples: ['1', '2', '3', '4', '5'].map((version) => example('CVE-2024-3333', version)),
      },
    },
  });
  assert.equal(
    card(review, 'en'),
    '7 rows (1 CVE): Handled → To review\n\nNote cleared'
    + '\n\n' + ['1', '2', '3', '4', '5'].map((v) => `- CVE-2024-3333 on TEC-3 PostgreSQL ${v}`).join('\n') + '\n- and 2 more'
    + '\n\n2 no longer match and will disappear at the next matching',
  );
  assert.equal(
    card(review, 'fr'),
    '7 lignes (1 CVE) : Traitée → À traiter\n\nNote effacée'
    + '\n\n' + ['1', '2', '3', '4', '5'].map((v) => `- CVE-2024-3333 sur TEC-3 PostgreSQL ${v}`).join('\n') + '\n- et 2 autres'
    + '\n\n2 ne correspondent plus et disparaîtront au prochain rapprochement',
  );
  assert.equal(
    card(review, 'de'),
    '7 Zeilen (1 CVE): Behandelt → Zu prüfen\n\nNotiz gelöscht'
    + '\n\n' + ['1', '2', '3', '4', '5'].map((v) => `- CVE-2024-3333 auf TEC-3 PostgreSQL ${v}`).join('\n') + '\n- und 2 weitere'
    + '\n\n2 treffen nicht mehr zu und verschwinden beim nächsten Abgleich',
  );
  assert.equal(
    card(review, 'es'),
    '7 filas (1 CVE): Tratada → Por revisar\n\nNota borrada'
    + '\n\n' + ['1', '2', '3', '4', '5'].map((v) => `- CVE-2024-3333 en TEC-3 PostgreSQL ${v}`).join('\n') + '\n- y 2 más'
    + '\n\n2 ya no coinciden y desaparecerán en el próximo cotejo',
  );

  // One row: singular words.
  const one = preview({
    tool_name: 'change_vulnerability_state',
    target_entity_type: 'vulnerabilities',
    mutation_input: { state: 'not_affected' },
    current_values: {
      values: { rows: 1, cves: 1, changes: 1, from_states: ['to_review'], outside_alerts: 0, no_longer_matching: 1, examples: [example('CVE-2024-4444', '9')] },
    },
  });
  assert.equal(
    card(one, 'fr'),
    '1 ligne (1 CVE) : À traiter → Non concernée\n\n- CVE-2024-4444 sur TEC-3 PostgreSQL 9'
    + '\n\n1 ne correspond plus et disparaîtra au prochain rapprochement',
  );
  assert.equal(
    card(one, 'de'),
    '1 Zeile (1 CVE): Zu prüfen → Nicht betroffen\n\n- CVE-2024-4444 auf TEC-3 PostgreSQL 9'
    + '\n\n1 trifft nicht mehr zu und verschwindet beim nächsten Abgleich',
  );
  assert.equal(
    card(one, 'es'),
    '1 fila (1 CVE): Por revisar → No afectada\n\n- CVE-2024-4444 en TEC-3 PostgreSQL 9'
    + '\n\n1 ya no coincide y desaparecerá en el próximo cotejo',
  );

  // Lot E review: the note alone changes: the state once, then the note.
  const noteOnly = (note: string | null) => preview({
    tool_name: 'change_vulnerability_state',
    target_entity_type: 'vulnerabilities',
    mutation_input: { state: 'handled', note },
    current_values: {
      values: { rows: 2, cves: 1, changes: 2, from_states: ['handled'], outside_alerts: 0, no_longer_matching: 0, examples: [example('CVE-2024-5555', '14')] },
    },
  });
  const noteRow = { en: 'on', fr: 'sur', de: 'auf', es: 'en' } as const;
  for (const [language, head, note] of [
    ['en', '2 rows (1 CVE): Handled, note changed', 'Note: "risk accepted"'],
    ['fr', '2 lignes (1 CVE) : Traitée, note modifiée', 'Note : « risk accepted »'],
    ['de', '2 Zeilen (1 CVE): Behandelt, Notiz geändert', 'Notiz: „risk accepted“'],
    ['es', '2 filas (1 CVE): Tratada, nota modificada', 'Nota: «risk accepted»'],
  ] as const) {
    assert.equal(card(noteOnly('risk accepted'), language), `${head}\n\n${note}\n\n- CVE-2024-5555 ${noteRow[language]} TEC-3 PostgreSQL 14\n- ${{ en: 'and 1 more', fr: 'et 1 autre', de: 'und 1 weitere', es: 'y 1 más' }[language]}`);
  }
  for (const [language, head] of [
    ['en', '2 rows (1 CVE): Handled, note cleared'],
    ['fr', '2 lignes (1 CVE) : Traitée, note effacée'],
    ['de', '2 Zeilen (1 CVE): Behandelt, Notiz gelöscht'],
    ['es', '2 filas (1 CVE): Tratada, nota borrada'],
  ] as const) {
    assert.ok(String(card(noteOnly(null), language)).startsWith(`${head}\n\n- CVE-2024-5555 `), `${language}: the note cleared, said once`);
  }

  // Executed, rejected, failed.
  const executed = { ...handled, status: 'executed', current_values: { ...handled.current_values, applied: { changed: 3 } } } as AiMutationPreview;
  assert.equal(summary(operation, executed, 'en'), 'Vulnerability state set to Handled on 3 vulnerability rows.');
  assert.equal(summary(operation, executed, 'fr'), "Appliqué : passage de 3 lignes de vulnérabilités à l'état « Traitée ».");
  assert.equal(summary(operation, executed, 'de'), 'Angewendet: 3 Zeilen der Schwachstellen auf „Behandelt“ setzen.');
  assert.equal(summary(operation, executed, 'es'), 'Aplicada: paso de 3 filas de vulnerabilidades al estado «Tratada».');
  assert.equal(summary(operation, { ...handled, status: 'rejected' } as AiMutationPreview, 'fr'), "Rejeté : passage de 3 lignes de vulnérabilités à l'état « Traitée ».");
  assert.equal(summary(operation, { ...handled, status: 'failed', error_message: 'Boom.' } as AiMutationPreview, 'de'), 'Boom.');

  // The undo: groups by the state they go back to, in the future while pending.
  const undo = preview({
    tool_name: 'change_vulnerability_state',
    target_entity_type: 'vulnerabilities',
    mutation_input: {
      reverse_of: 'preview-0',
      state: 'handled',
      note: 'Patched in 14.2',
      restore_groups: [
        { state: 'to_review', note: null, ids: ['a', 'b'] },
        { state: 'not_affected', note: 'Old note', ids: ['c'] },
      ],
    },
    current_values: { values: { rows: 3, cves: 2, cve_id: null } },
  });
  assert.equal(summary(operation, undo, 'en'), 'Put 3 vulnerability rows back to their previous state.');
  assert.equal(
    card(undo, 'en'),
    '3 rows (2 CVEs): Handled → back to their previous state'
    + '\n\n- 2 will go back to To review, note cleared\n- 1 will go back to Not affected, note "Old note"',
  );
  assert.equal(summary(operation, undo, 'fr'), 'Retour de 3 lignes de vulnérabilités à leur état précédent.');
  assert.equal(
    card(undo, 'fr'),
    '3 lignes (2 CVE) : Traitée → retour à leur état précédent'
    + "\n\n- 2 lignes reviendront à l'état À traiter, note effacée\n- 1 ligne reviendra à l'état Non concernée, note « Old note »",
  );
  assert.equal(summary(operation, undo, 'de'), '3 Zeilen der Schwachstellen auf den vorherigen Status zurücksetzen.');
  assert.equal(
    card(undo, 'de'),
    '3 Zeilen (2 CVE): Behandelt → zurück auf den vorherigen Status'
    + '\n\n- 2 Zeilen werden auf Zu prüfen zurückgesetzt, Notiz gelöscht\n- 1 Zeile wird auf Nicht betroffen zurückgesetzt, Notiz „Old note“',
  );
  assert.equal(summary(operation, undo, 'es'), 'Retorno de 3 filas de vulnerabilidades a su estado anterior.');
  assert.equal(
    card(undo, 'es'),
    '3 filas (2 CVE): Tratada → vuelta a su estado anterior'
    + '\n\n- 2 filas volverán al estado Por revisar, nota borrada\n- 1 fila volverá al estado No afectada, nota «Old note»',
  );
  // Lot E review: back to review, the rows that no longer match are said as on the change's card.
  const undoMatching = { ...undo, current_values: { values: { rows: 3, cves: 2, cve_id: null, no_longer_matching: 2 } } } as AiMutationPreview;
  assert.equal(
    card(undoMatching, 'en'),
    '3 rows (2 CVEs): Handled → back to their previous state'
    + '\n\n- 2 will go back to To review, note cleared\n- 1 will go back to Not affected, note "Old note"'
    + '\n\n2 no longer match and will disappear at the next matching',
  );
  assert.equal(
    card(undoMatching, 'fr'),
    '3 lignes (2 CVE) : Traitée → retour à leur état précédent'
    + "\n\n- 2 lignes reviendront à l'état À traiter, note effacée\n- 1 ligne reviendra à l'état Non concernée, note « Old note »"
    + '\n\n2 ne correspondent plus et disparaîtront au prochain rapprochement',
  );
  const undone = { ...undo, status: 'executed', current_values: { ...undo.current_values, applied: { changed: 3 } } } as AiMutationPreview;
  assert.equal(
    card(undone, 'en'),
    '3 rows (2 CVEs): Handled → back to their previous state'
    + '\n\n- 2 back to To review, note cleared\n- 1 back to Not affected, note "Old note"',
  );
  assert.equal(
    card(undone, 'fr'),
    '3 lignes (2 CVE) : Traitée → retour à leur état précédent'
    + "\n\n- 2 lignes revenues à l'état À traiter, note effacée\n- 1 ligne revenue à l'état Non concernée, note « Old note »",
  );
  assert.equal(
    card(undone, 'de'),
    '3 Zeilen (2 CVE): Behandelt → zurück auf den vorherigen Status'
    + '\n\n- 2 Zeilen auf Zu prüfen zurückgesetzt, Notiz gelöscht\n- 1 Zeile auf Nicht betroffen zurückgesetzt, Notiz „Old note“',
  );
  assert.equal(
    card(undone, 'es'),
    '3 filas (2 CVE): Tratada → vuelta a su estado anterior'
    + '\n\n- 2 filas vueltas al estado Por revisar, nota borrada\n- 1 fila vuelta al estado No afectada, nota «Old note»',
  );
  assert.equal(summary(operation, undone, 'fr'), 'Appliqué : retour de 3 lignes de vulnérabilités à leur état précédent.');
}

function testIncidentStateAndConfidentialityCards() {
  const state = make(ChangeIncidentStateAiMutationOperation);
  const reopen = preview({
    tool_name: 'change_incident_state',
    target_entity_type: 'incidents',
    target_entity_id: 'incident-1',
    mutation_input: {
      action: 'reopen',
      reason: 'Back after the fix.',
      from_status: 'closed',
      to_status: 'in_progress',
    },
    current_values: { target_ref: 'INC-7', target_title: 'INC-7 - Mail outage', status: 'closed' },
  });
  assert.equal(summary(state, reopen, 'en'), 'Reopen INC-7 - Mail outage.');
  assert.equal(summary(state, reopen, 'fr'), "Réouverture de l'incident « INC-7 - Mail outage ».");
  assert.equal(summary(state, reopen, 'de'), 'Vorfall „INC-7 - Mail outage“ wieder öffnen.');
  assert.equal(summary(state, reopen, 'es'), 'Reapertura del incidente «INC-7 - Mail outage».');
  const reopened = state.presentPreview(reopen, 'fr').changes;
  assert.equal(reopened.status.from, 'closed');
  assert.equal(reopened.status.to, 'in_progress');
  assert.equal(reopened.reason.to, 'Back after the fix.');
  assert.equal(reopened.reason.label, 'Raison');
  assert.equal(reopened.closure_warning, undefined, 'a reopen carries no freeze warning');
  assert.equal(summary(state, { ...reopen, status: 'executed' } as AiMutationPreview, 'fr'), "Appliqué : réouverture de l'incident « INC-7 - Mail outage ».");

  const cancel = preview({
    tool_name: 'change_incident_state',
    target_entity_type: 'incidents',
    target_entity_id: 'incident-1',
    mutation_input: {
      action: 'cancel',
      reason: 'Duplicate of INC-6.',
      from_status: 'open',
      to_status: 'cancelled',
    },
    current_values: { target_ref: 'INC-7', target_title: 'INC-7 - Mail outage', status: 'open' },
  });
  const cancelled = state.presentPreview(cancel, 'fr').changes;
  assert.equal(cancelled.status.from, 'open');
  assert.equal(cancelled.status.to, 'cancelled');
  assert.equal(cancelled.reason.to, 'Duplicate of INC-6.');
  assert.equal(cancelled.closure_warning, undefined, 'a cancellation carries its own warning');
  for (const [language, text] of [
    ['en', 'This cancellation freezes the incident: only an administrator can reopen it.'],
    ['fr', "Cette annulation fige l'incident : seul un administrateur pourra le rouvrir."],
    ['de', 'Diese Annullierung sperrt den Vorfall: Nur ein Administrator kann ihn wieder öffnen.'],
    ['es', 'Esta anulación bloquea el incidente: solo un administrador podrá reabrirlo.'],
  ] as const) {
    assert.equal(state.presentPreview(cancel, language).changes.cancel_warning.to, text, language);
  }
  assert.equal(summary(state, cancel, 'fr'), "Annulation de l'incident « INC-7 - Mail outage ».");
  assert.equal(summary(state, cancel, 'en'), 'Cancel INC-7 - Mail outage.');

  const confidentiality = make(SetIncidentConfidentialityAiMutationOperation);
  const lift = preview({
    tool_name: 'set_incident_confidentiality',
    target_entity_type: 'incidents',
    target_entity_id: 'incident-1',
    mutation_input: { confidential: false, from_confidential: true },
    current_values: { target_ref: 'INC-7', target_title: 'INC-7 - Mail outage', status: 'closed', confidential: true },
  });
  assert.equal(summary(confidentiality, lift, 'fr'), "Levée de la confidentialité de l'incident « INC-7 - Mail outage ».");
  assert.equal(summary(confidentiality, lift, 'en'), 'Lift the confidentiality of INC-7 - Mail outage.');
  assert.deepEqual(confidentiality.presentPreview(lift, 'fr').changes.confidential, {
    label: 'Confidential',
    from: 'Yes',
    to: 'No',
    format: 'text',
  });
  assert.equal(confidentiality.presentPreview(lift, 'fr').changes.access_warning, undefined, 'lifting never loses access');

  const restrict = preview({
    tool_name: 'set_incident_confidentiality',
    target_entity_type: 'incidents',
    target_entity_id: 'incident-1',
    mutation_input: { confidential: true, from_confidential: false },
    current_values: { target_ref: 'INC-7', target_title: 'INC-7 - Mail outage', status: 'open', confidential: false },
  });
  const restricted = confidentiality.presentPreview(restrict, 'fr').changes;
  assert.equal(restricted.confidential.from, 'No');
  assert.equal(restricted.confidential.to, 'Yes');
  // The tool is reserved to register administrators, who keep access: no warning on its card.
  assert.equal(restricted.access_warning, undefined);
  assert.equal(summary(confidentiality, restrict, 'fr'), "Passage de l'incident « INC-7 - Mail outage » en confidentiel.");
}

/** What the card needs beyond the summary: classification codes, and fields in a stable order (quality pass 2026-10-27, A1 and A3). */
function testCardCodesAndFieldOrder() {
  const support = make(AiBusinessRecordMutationSupportService);
  const criticality = preview({
    tool_name: 'update_business_record',
    target_entity_type: 'applications',
    target_entity_id: 'app-1',
    mutation_input: {
      action: 'update',
      entity_type: 'applications',
      fields: { criticality: 'low', recovery_wave: 'vital' },
      display_values: { criticality: 'Low', recovery_wave: 'V1 — Vital activities' },
    },
    current_values: {
      target_title: 'CheeseTrack',
      values: { criticality: 'business_critical', recovery_wave: null },
      display_values: { criticality: 'Critical', recovery_wave: null },
    },
  });
  const changes = support.presentPreview(criticality, 'fr').changes;
  assert.deepEqual(changes.criticality, {
    label: 'criticality',
    from: 'Critical',
    to: 'Low',
    format: 'text',
    classification: { catalog: 'businessCriticalityLevels', from: 'business_critical', to: 'low' },
  });
  assert.deepEqual(changes.recovery_wave.classification, { catalog: 'recoveryWaves', from: null, to: 'vital' });
  const created = support.presentPreview({ ...criticality, mutation_input: { ...criticality.mutation_input, action: 'create', fields: { name: 'X', data_class: 'internal' } } } as AiMutationPreview, 'en').changes;
  assert.deepEqual(created.data_class.classification, { catalog: 'dataClasses', from: null, to: 'internal' });
  assert.equal(created.name.classification, undefined, 'a plain field carries no classification');

  // jsonb gives the keys back by length: the card follows the order of the line's fields instead.
  const line = preview({
    tool_name: 'create_business_record',
    target_entity_type: 'budget_lines',
    mutation_input: {
      action: 'create',
      entity_type: 'budget_lines',
      fields: { currency: 'EUR', account_id: 'a-1', product_name: 'QA-PL montant', effective_start: '2026-01-01', paying_company_id: 'c-1', 'analytics_axis:b': 'v-2', 'analytics_axis:a': 'v-1' },
      display_values: {},
    },
  });
  assert.deepEqual(Object.keys(support.presentPreview(line, 'fr').changes), [
    'product_name', 'paying_company_id', 'account_id', 'currency', 'effective_start', 'analytics_axis:a', 'analytics_axis:b',
  ]);

  const masterData = make(AiMasterDataMutationSupportService);
  const company = preview({
    tool_name: 'create_master_data_record',
    target_entity_type: 'companies',
    mutation_input: { action: 'create', entity_type: 'companies', fields: { city: 'Lyon', name: 'Acme' }, display_values: {} },
  });
  assert.deepEqual(Object.keys(masterData.presentPreview(company, 'fr').changes), ['name', 'city']);
}

/** A task created without a type gets the one the task screen preselects (A2). */
async function testDefaultTaskType() {
  const support = new AiTaskMutationSupportService();
  const reads: Array<{ sql: string; params: unknown[] }> = [];
  const context = (rows: unknown[]) => ({
    tenantId: 'tenant-1',
    manager: { query: async (sql: string, params: unknown[]) => { reads.push({ sql, params }); return rows; } },
  }) as any;
  assert.deepEqual(await support.resolveDefaultTaskType(context([{ id: 'type-1', name: 'Task' }])), { id: 'type-1', label: 'Task' });
  assert.match(reads[0].sql, /code = 'task' OR name = 'Task'/);
  assert.match(reads[0].sql, /is_active = true/);
  assert.deepEqual(reads[0].params, ['tenant-1']);
  assert.equal(await support.resolveDefaultTaskType(context([])), null);
}

function testFinancialPlanAndRelations() {
  const financial = make(AiFinancialPlanMutationSupportService);
  const amounts = preview({
    tool_name: 'write_financial_plan',
    target_entity_type: 'budget_lines',
    mutation_input: { action: 'upsert_amounts', entity_type: 'budget_lines' },
    current_values: { target_title: 'Licences', display_values: { from: '0', to: '12 000' } },
  });
  assert.equal(summary(financial, amounts, 'en'), 'Update financial amounts for "Licences".');
  assert.equal(summary(financial, amounts, 'fr'), 'Modification des montants de « Licences ».');
  assert.equal(summary(financial, { ...amounts, status: 'executed' } as AiMutationPreview, 'de'),
    'Angewendet: Beträge von „Licences“ ändern.');

  const relations = make(AiRelationMutationSupportService);
  const links = preview({
    tool_name: 'update_entity_relations',
    target_entity_type: 'applications',
    mutation_input: { entity_type: 'applications', relation: 'contracts', next_items: [] },
    current_values: { target_title: 'CheeseTrack', items: [] },
  });
  assert.equal(summary(relations, links, 'es'), 'Modificación de las relaciones de «CheeseTrack».');
}

// The roles of a relation reach the card by code (A7): the card names them as the screens do; the
// English text stays in `from` and `to` for the model; a label in another form shows as it is.
function testRelationRolesForTheCard() {
  const relations = make(AiRelationMutationSupportService);
  const item = (key: string, label: string, payload: Record<string, unknown>) => ({ key, label, payload });
  const relationPreview = (entity: string, relation: string, current: unknown[], next: unknown[]) => preview({
    tool_name: 'update_entity_relations',
    target_entity_type: entity,
    mutation_input: { entity_type: entity, relation, next_items: next },
    current_values: { target_title: 'CheeseTrack', items: current },
  });

  const owners = relations.presentPreview(relationPreview('applications', 'owners',
    [item('business:u1', 'BUSINESS owner: Thomas Berger', { user_id: 'u1', owner_type: 'business' })],
    [item('it:u2', 'IT owner: Claire Martin', { user_id: 'u2', owner_type: 'it' })]), 'fr').changes.owners;
  assert.equal(owners.from, 'BUSINESS owner: Thomas Berger');
  assert.deepEqual(owners.relation_items, {
    from: [{ name: 'Thomas Berger', role: { kind: 'owner', code: 'business' } }],
    to: [{ name: 'Claire Martin', role: { kind: 'owner', code: 'it' } }],
  });

  const supplierContacts = relations.presentPreview(relationPreview('suppliers', 'contacts', [],
    [item('c1:technical', 'Marc Dubois - technical', { contact_id: 'c1', role: 'technical' })]), 'fr').changes.contacts;
  assert.deepEqual(supplierContacts.relation_items?.to, [{ name: 'Marc Dubois', role: { kind: 'contact', code: 'technical' } }]);

  const contractContacts = relations.presentPreview(relationPreview('contracts', 'contacts', [],
    [item('c1:commercial:manual', 'Marc Dubois - commercial', { contact_id: 'c1', role: 'commercial', origin: 'manual' })]), 'en').changes.contacts;
  assert.deepEqual(contractContacts.relation_items?.to, [{ name: 'Marc Dubois', role: { kind: 'contact', code: 'commercial' } }]);

  // A support contact's role is typed by a person: it shows as typed.
  const support = relations.presentPreview(relationPreview('applications', 'support_contacts', [],
    [item('c1:Astreinte:', 'Marc Dubois - Astreinte', { contact_id: 'c1', role: 'Astreinte', origin: null })]), 'fr').changes.support_contacts;
  assert.deepEqual(support.relation_items?.to, [{ name: 'Marc Dubois', role: { kind: 'text', code: 'Astreinte' } }]);

  const assetRelations = relations.presentPreview(relationPreview('assets', 'relations', [],
    [item('a2:depends_on', 'depends_on: SRV-DB-01', { related_asset_id: 'a2', relation_type: 'depends_on', notes: null })]), 'fr').changes.relations;
  assert.deepEqual(assetRelations.relation_items?.to, [{ name: 'SRV-DB-01', role: { kind: 'asset_relation', code: 'depends_on' } }]);

  const assignments = relations.presentPreview(relationPreview('applications', 'asset_assignments', [],
    [item('i1:a1:database', 'prod: SRV-DB-01 (database)', { app_instance_id: 'i1', environment: 'prod', asset_id: 'a1', role: 'database' })]), 'de').changes.asset_assignments;
  assert.deepEqual(assignments.relation_items?.to, [
    { name: 'SRV-DB-01', role: { kind: 'server_role', code: 'database' }, environment: 'prod' },
  ]);

  // A label in another form keeps its text; a relation without roles sends no items.
  const odd = relations.presentPreview(relationPreview('applications', 'owners', [],
    [item('business:u1', 'Thomas Berger', { user_id: 'u1', owner_type: 'business' })]), 'fr').changes.owners;
  assert.deepEqual(odd.relation_items?.to, [{ name: 'Thomas Berger', role: null }]);
  const companies = relations.presentPreview(relationPreview('applications', 'companies', [], [item('co1', 'Fromagerie', {})]), 'fr').changes.companies;
  assert.equal(companies.relation_items, undefined);
}

// The amounts of a budget line reach the card as numbers, the same in every language: the card writes
// them with the column names of the budget screens and the line's currency ("Budget 2026 : 12 000 €").
function testAmountsForTheCard() {
  const amounts12000 = { year: 2026, currency: 'EUR', column_names: {}, totals: { planned: 12000 } };
  const before = { year: 2026, currency: 'EUR', column_names: {}, totals: { planned: 0, committed: 0, actual: 0, expected_landing: 0 } };
  const financial = make(AiFinancialPlanMutationSupportService);
  const upsert = preview({
    tool_name: 'write_financial_plan',
    target_entity_type: 'budget_lines',
    mutation_input: { action: 'upsert_amounts', entity_type: 'budget_lines' },
    current_values: {
      target_title: 'Licences',
      display_values: { from: '2026 totals (Budget: 0)', to: '2026 annual totals (Budget: 12000)', from_amounts: before, to_amounts: amounts12000 },
    },
  });
  for (const language of ['en', 'fr'] as const) {
    const change = financial.presentPreview(upsert, language).changes.amounts;
    assert.deepEqual(change.amounts, { from: before, to: amounts12000 }, `${language}: upsert amounts as numbers`);
    assert.equal(change.to, '2026 annual totals (Budget: 12000)', `${language}: the English text stays for the model`);
  }
  const older = preview({ ...upsert, current_values: { target_title: 'Licences', display_values: { from: '0', to: '12000' } } });
  assert.equal(financial.presentPreview(older, 'fr').changes.amounts.amounts, undefined, 'a preview made before keeps its text');

  const create = new CreateBusinessRecordAiMutationOperation(make(AiBusinessRecordMutationSupportService), financial);
  const line = preview({
    tool_name: 'create_business_record',
    target_entity_type: 'budget_lines',
    mutation_input: {
      action: 'create',
      entity_type: 'budget_lines',
      fields: { product_name: 'Licences', currency: 'EUR' },
      display_values: { product_name: 'Licences', currency: 'EUR' },
      field_labels: { product_name: 'Product Name', currency: 'Currency' },
      amounts: { kind: 'annual', year: 2026, totals: { planned: '12000' } },
      amounts_display: '2026 annual totals (Budget: 12000)',
      amounts_preview: amounts12000,
    },
    current_values: { target_title: 'Licences' },
  });
  for (const language of ['en', 'fr'] as const) {
    const change = create.presentPreview(line, language).changes.amounts;
    assert.deepEqual(change.amounts, { from: null, to: amounts12000 }, `${language}: new line amounts as numbers`);
  }
}

function testDeleteRecordSummaryAndCard() {
  const operation = make(DeleteRecordAiMutationOperation);
  const pending = preview({
    tool_name: 'delete_record',
    target_entity_type: 'tasks',
    target_entity_id: 'task-1',
    current_values: {
      target_ref: 'T-42',
      target_title: 'T-42 - Migration',
      updated_at: '2026-10-27T10:00:00.000Z',
      counts: { activities: 2, time_entries: 1, attachments: 0, applications: 0, assets: 0, documents: 0 },
    },
  });
  assert.equal(summary(operation, pending, 'en'), 'Delete task "Migration".');
  assert.equal(summary(operation, pending, 'fr'), 'Suppression de la tâche « Migration ».');
  assert.equal(summary(operation, pending, 'de'), 'Aufgabe „Migration“ löschen.');
  assert.equal(summary(operation, pending, 'es'), 'Eliminación de la tarea «Migration».');
  assert.equal(summary(operation, { ...pending, status: 'executed' }, 'en'), 'Task "Migration" deleted.');
  assert.equal(summary(operation, { ...pending, status: 'executed' }, 'fr'), 'Appliqué : suppression de la tâche « Migration ».');
  assert.equal(summary(operation, { ...pending, status: 'rejected' }, 'fr'), 'Rejeté : suppression de la tâche « Migration ».');
  assert.equal(
    summary(operation, { ...pending, status: 'failed', error_message: 'Task no longer exists.' }, 'fr'),
    'Task no longer exists.',
  );
  // The card lists what goes with the record, in the person's language.
  const card = operation.presentPreview(pending, 'fr');
  assert.equal(card.target.ref, 'T-42');
  assert.equal(card.target.title, 'T-42 - Migration');
  assert.equal(card.changes.deletion.label, 'What goes with it');
  assert.equal(card.changes.deletion.format, 'markdown');
  assert.equal(card.changes.deletion.from, null);
  assert.equal(card.changes.deletion.to, '- Commentaires et changements : 2\n- Temps saisis : 1');
  assert.equal(operation.presentPreview(pending, 'de').changes.deletion.to, '- Kommentare und Änderungen: 2\n- Erfasste Zeiten: 1');
  assert.equal(operation.presentPreview(pending, 'es').changes.deletion.to, '- Comentarios y cambios: 2\n- Tiempos registrados: 1');
  // A contact's links stay unnamed in a family the person does not read.
  const contact: AiMutationPreview = {
    ...pending,
    target_entity_type: 'contacts',
    current_values: {
      target_ref: null,
      target_title: 'Camille Roux',
      updated_at: '2026-10-27T10:00:00.000Z',
      counts: { suppliers: 1 },
      hidden: 2,
    },
  };
  assert.equal(summary(operation, contact, 'fr'), 'Suppression du contact « Camille Roux ».');
  assert.equal(
    operation.presentPreview(contact, 'fr').changes.deletion.to,
    "- Liens aux fournisseurs : 1\n- D'autres rattachements : 2\n\nLes fiches liées restent.",
  );
  // A task's applications, assets and documents follow the same rule as a contact's families.
  const taskWithHiddenLinks: AiMutationPreview = {
    ...pending,
    current_values: {
      target_ref: 'T-43',
      target_title: 'T-43 - Import',
      updated_at: '2026-10-27T10:00:00.000Z',
      counts: { activities: 1 },
      hidden: 3,
    },
  };
  assert.equal(
    operation.presentPreview(taskWithHiddenLinks, 'fr').changes.deletion.to,
    "- Commentaires et changements : 1\n- D'autres rattachements : 3\n\nLes fiches liées restent.",
  );

  // A budget line names its versions, amounts, tasks, requests losing their origin, links and files.
  const line: AiMutationPreview = {
    ...pending,
    target_entity_type: 'budget_lines',
    current_values: {
      target_ref: 'BL-12',
      target_title: 'ERP licence',
      updated_at: '2026-10-27T10:00:00.000Z',
      counts: {
        amount_versions: 1,
        amount_years: 2,
        tasks: 1,
        request_origins: 1,
        attachments: 1,
        contracts: 1,
        projects: 1,
        requests: 1,
        applications: 1,
        assets: 0,
        technologies: 0,
        contacts: 1,
        links: 1,
        dimension_values: 1,
      },
    },
  };
  assert.equal(summary(operation, line, 'en'), 'Delete budget line "ERP licence".');
  assert.equal(summary(operation, line, 'fr'), 'Suppression de la ligne budgétaire « ERP licence ».');
  assert.equal(summary(operation, line, 'de'), 'Budgetzeile „ERP licence“ löschen.');
  assert.equal(summary(operation, line, 'es'), 'Eliminación de la línea presupuestaria «ERP licence».');
  assert.equal(
    operation.presentPreview(line, 'fr').changes.deletion.to,
    [
      '- Versions avec des montants : 1',
      '- Années avec des montants : 2',
      '- Tâches supprimées : 1',
      "- Demandes qui perdent leur tâche d'origine : 1",
      '- Pièces jointes : 1',
      '- Liens aux contrats : 1',
      '- Liens aux projets : 1',
      '- Liens aux demandes : 1',
      '- Liens aux applications : 1',
      '- Liens aux contacts : 1',
      '- Liens : 1',
      '- Valeurs de dimensions : 1',
      '',
      'Les fiches liées restent.',
    ].join('\n'),
  );
  // The card of a line with one task, one contract and one application says which goes and which
  // only loses its link.
  const lineLinks: AiMutationPreview = {
    ...line,
    current_values: {
      ...line.current_values,
      counts: { tasks: 1, contracts: 1, applications: 1 },
    },
  };
  assert.equal(
    operation.presentPreview(lineLinks, 'fr').changes.deletion.to,
    [
      '- Tâches supprimées : 1',
      '- Liens aux contrats : 1',
      '- Liens aux applications : 1',
      '',
      'Les fiches liées restent.',
    ].join('\n'),
  );

  // A connection names its hops, servers, protocols, the interfaces that lose it and its documents.
  const connection: AiMutationPreview = {
    ...pending,
    target_entity_type: 'connections',
    current_values: {
      target_ref: 'CON-4',
      target_title: 'CON-4 - DB link',
      updated_at: '2026-10-27T10:00:00.000Z',
      counts: { hops: 2, servers: 1, protocols: 1, interfaces: 1, documents: 1 },
    },
  };
  assert.equal(summary(operation, connection, 'en'), 'Delete connection "DB link".');
  assert.equal(summary(operation, connection, 'fr'), 'Suppression de la connexion « DB link ».');
  assert.equal(
    operation.presentPreview(connection, 'fr').changes.deletion.to,
    [
      '- Sauts : 2',
      '- Liens aux serveurs : 1',
      '- Protocoles : 1',
      '- Interfaces qui perdront cette connexion : 1',
      '- Liens aux documents : 1',
      '',
      'Les interfaces elles-mêmes ne sont pas supprimées.',
    ].join('\n'),
  );

  // An interface names its bindings, links, documents, dependencies, files and applications.
  const iface: AiMutationPreview = {
    ...pending,
    target_entity_type: 'interfaces',
    current_values: {
      target_ref: 'INT-7',
      target_title: 'INT-7 - Orders',
      updated_at: '2026-10-27T10:00:00.000Z',
      counts: {
        bindings: 2,
        connection_links: 2,
        integrated_documents: 1,
        documents: 1,
        dependencies: 1,
        attachments: 1,
        applications: 2,
      },
    },
  };
  assert.equal(summary(operation, iface, 'en'), 'Delete interface "Orders".');
  assert.equal(summary(operation, iface, 'fr'), "Suppression de l'interface « Orders ».");
  assert.equal(
    operation.presentPreview(iface, 'fr').changes.deletion.to,
    [
      '- Liaisons : 2',
      '- Liens aux connexions : 2',
      '- Documents intégrés : 1',
      '- Liens aux documents : 1',
      '- Liens aux interfaces dépendantes : 1',
      '- Pièces jointes : 1',
      '- Liens aux applications : 2',
      '',
      'Les connexions sont conservées.',
    ].join('\n'),
  );
  // A document names its versions, files, citations, linked records, derived documents, and the
  // review or edit lock that does not stop the delete.
  const document: AiMutationPreview = {
    ...pending,
    target_entity_type: 'documents',
    current_values: {
      target_ref: 'DOC-12',
      target_title: 'Runbook',
      updated_at: '2026-10-27T10:00:00.000Z',
      counts: {
        versions: 2,
        attachments: 1,
        citing_documents: 1,
        cited_documents: 1,
        applications: 1,
        assets: 1,
        projects: 1,
        requests: 1,
        tasks: 1,
        locations: 1,
        connections: 1,
        interfaces: 1,
        incidents: 1,
        derived_documents: 1,
      },
      in_review: true,
      lock_holder: 'Camille Roux',
    },
  };
  assert.equal(summary(operation, document, 'en'), 'Delete document "Runbook".');
  assert.equal(summary(operation, document, 'fr'), 'Suppression du document « Runbook ».');
  assert.equal(summary(operation, document, 'de'), 'Dokument „Runbook“ löschen.');
  assert.equal(summary(operation, document, 'es'), 'Eliminación del documento «Runbook».');
  // A title that starts with a longer reference keeps it whole: DOC-1 is not DOC-12.
  const prefixed: AiMutationPreview = {
    ...document,
    current_values: { ...document.current_values, target_ref: 'DOC-1', target_title: 'DOC-12 review' },
  };
  assert.equal(summary(operation, prefixed, 'fr'), 'Suppression du document « DOC-12 review ».');
  const named: AiMutationPreview = {
    ...document,
    current_values: { ...document.current_values, target_ref: 'DOC-1', target_title: 'DOC-1 Runbook' },
  };
  assert.equal(summary(operation, named, 'fr'), 'Suppression du document « Runbook ».');
  assert.equal(
    operation.presentPreview(document, 'fr').changes.deletion.to,
    [
      '- Versions : 2',
      '- Pièces jointes : 1',
      '- Documents qui le citent : 1',
      "- Documents qu'il cite : 1",
      '- Liens aux applications : 1',
      '- Liens aux actifs : 1',
      '- Liens aux projets : 1',
      '- Liens aux demandes : 1',
      '- Liens aux tâches : 1',
      '- Liens aux sites : 1',
      '- Liens aux connexions : 1',
      '- Liens aux interfaces : 1',
      '- Liens aux incidents : 1',
      '- Documents créés depuis ce modèle : 1',
      '- En cours de relecture. La suppression reste possible.',
      '- Verrouillé pour édition par Camille Roux. La suppression reste possible.',
      '',
      'Les fiches liées restent.',
    ].join('\n'),
  );
  // A linked family the person does not read is counted among the other links, unnamed.
  const hiddenDocument: AiMutationPreview = {
    ...document,
    current_values: {
      ...document.current_values,
      counts: { versions: 1 },
      hidden: 3,
      in_review: false,
      lock_holder: null,
    },
  };
  assert.equal(
    operation.presentPreview(hiddenDocument, 'fr').changes.deletion.to,
    "- Versions : 1\n- D'autres rattachements : 3\n\nLes fiches liées restent.",
  );
  // A budget line's unnamed count may hold its tasks, which are deleted: no closing that says they stay.
  assert.equal(
    deletionImpactText('fr', 'budget_lines', { counts: { amount_versions: 1 }, hidden: 1 }),
    "- Versions avec des montants : 1\n- D'autres rattachements : 1",
  );
  assert.equal(
    deletionImpactText('fr', 'budget_lines', { counts: { contracts: 1 }, hidden: 1 }),
    "- Liens aux contrats : 1\n- D'autres rattachements : 1\n\nLes fiches liées restent.",
  );
  console.log('  delete_record summary and card: OK');
}

async function testPersonLanguage() {
  assert.equal(aiWriteLanguage('fr-FR'), 'fr');
  assert.equal(aiWriteLanguage('pt'), 'en');
  const reads: unknown[][] = [];
  const manager = { query: async (_sql: string, params: unknown[]) => { reads.push(params); return [{ locale: 'es' }]; } } as any;
  assert.equal(await personWriteLanguage(manager, 'tenant-1', 'user-1'), 'es');
  assert.deepEqual(reads, [['tenant-1', 'user-1']]);
  assert.equal(await personWriteLanguage(manager, 'tenant-1', null), 'en');
}


function testTechnologyVersions() {
  const operation = make(UpdateTechnologyVersionsAiMutationOperation);
  const pending = preview({
    tool_name: 'update_technology_versions',
    target_entity_type: 'technologies',
    target_entity_id: 'tec-1',
    mutation_input: {
      technology_ref: 'TEC-1',
      technology_name: 'PostgreSQL',
      technology_label: 'TEC-1 - PostgreSQL',
      versions: {
        add: [{ label: '17', standard_support_end: '2029-11-08', extended_support_end: null, notes: null }],
        update: [{
          id: 'version-16',
          before: { id: 'version-16', label: '16', standard_support_end: '2028-11-09', extended_support_end: null, notes: null, catalog_key: null },
          next: { standard_support_end: '2028-12-31' },
        }],
      },
    },
    current_values: { target_ref: 'TEC-1', target_title: 'TEC-1 - PostgreSQL' },
  });
  assert.equal(summary(operation, pending, 'en'), 'Update the versions of TEC-1 - PostgreSQL.');
  assert.equal(summary(operation, pending, 'fr'), 'Modification des versions de « TEC-1 - PostgreSQL ».');
  assert.equal(summary(operation, pending, 'de'), 'Versionen von „TEC-1 - PostgreSQL“ ändern.');
  assert.equal(summary(operation, pending, 'es'), 'Modificación de las versiones de «TEC-1 - PostgreSQL».');
  assert.equal(
    operation.presentPreview(pending, 'en').changes.technology_versions.to,
    '- new version 17 (end of support 2029-11-08)\n- 16: end of support 2028-11-09 → 2028-12-31',
  );
  assert.equal(
    operation.presentPreview(pending, 'fr').changes.technology_versions.to,
    '- nouvelle version 17 (fin de support 2029-11-08)\n- 16 : fin de support 2028-11-09 → 2028-12-31',
  );
  const undo = preview({
    ...pending,
    mutation_input: { ...(pending.mutation_input ?? {}), versions: { add: [], update: [] }, kept_versions: ['17'] },
  });
  assert.match(operation.presentPreview(undo, 'fr').changes.technology_versions.to ?? '',
    /^\*\*Conservées\*\*\n- nouvelle version 17 \(l'annulation restaure les versions modifiées, pas la nouvelle\)$/);
}

async function main() {
  testTaskCreation();
  testTaskStatusAndAssignee();
  testTicketImport();
  testDocumentCreation();
  testBusinessRecords();
  testFinancialPlanAndRelations();
  testRelationRolesForTheCard();
  testAmountsForTheCard();
  testCardCodesAndFieldOrder();
  testIncidentPreviewsAndWarnings();
  testIncidentNoteAndLinkCards();
  testTechnologyLinkCards();
  testTechnologyVersions();
  testTechnologyPeopleLinksAndAlertsCards();
  testVulnerabilityStateCards();
  testIncidentStateAndConfidentialityCards();
  testDeleteRecordSummaryAndCard();
  await testDefaultTaskType();
  await testPersonLanguage();
  console.log('ai-write-preview-summaries.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
