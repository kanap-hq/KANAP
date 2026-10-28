import * as assert from 'node:assert/strict';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiWriteLanguage, aiWriteLanguage, deletionImpactText, personWriteLanguage } from '../ai-write-texts';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { AiDocumentMutationSupportService } from '../mutation/ai-document-mutation-support.service';
import { AiFinancialPlanMutationSupportService } from '../mutation/ai-financial-plan-mutation-support.service';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';
import { AiRelationMutationSupportService } from '../mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from '../mutation/ai-task-mutation-support.service';
import { CreateBusinessRecordAiMutationOperation } from '../mutation/operations/create-business-record.ai-mutation-operation';
import { CreateDocumentAiMutationOperation } from '../mutation/operations/create-document.ai-mutation-operation';
import { CreateTaskAiMutationOperation } from '../mutation/operations/create-task.ai-mutation-operation';
import { DeleteRecordAiMutationOperation } from '../mutation/operations/delete-record.ai-mutation-operation';
import { ImportGlpiTicketAiMutationOperation } from '../mutation/operations/import-glpi-ticket.ai-mutation-operation';
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
  assert.equal(created.status.to, 'Ouvert', 'the status reads in French');
  assert.equal(created.severity.to, 'Majeure', 'the severity reads in French');

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
  assert.equal(closed.status.from, 'Ouvert');
  assert.equal(closed.status.to, 'Clôturé');
  assert.equal(closed.closure_warning.to, "Cette clôture fige l'incident : seul un administrateur pourra le rouvrir.");
  assert.equal(summary(support, closure, 'en'), 'Update incident "INC-7 - Mail outage": Status.');

  const lost = support.presentPreview({ ...closure, mutation_input: { ...closure.mutation_input, fields: { confidential: true }, display_values: { confidential: 'true' }, warnings: { lose_access: true } } } as AiMutationPreview, 'es').changes;
  assert.equal(lost.access_warning.to, 'Tras este cambio, solo los administradores del registro, el notificante y el responsable podrán abrirlo. Volverá al registro.');
  assert.equal(lost.access_warning.label, 'Access');
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
  testDeleteRecordSummaryAndCard();
  await testDefaultTaskType();
  await testPersonLanguage();
  console.log('ai-write-preview-summaries.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
