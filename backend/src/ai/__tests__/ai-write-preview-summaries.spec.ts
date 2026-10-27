import * as assert from 'node:assert/strict';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiWriteLanguage, aiWriteLanguage, personWriteLanguage } from '../ai-write-texts';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { AiDocumentMutationSupportService } from '../mutation/ai-document-mutation-support.service';
import { AiFinancialPlanMutationSupportService } from '../mutation/ai-financial-plan-mutation-support.service';
import { AiMasterDataMutationSupportService } from '../mutation/ai-master-data-mutation-support.service';
import { AiRelationMutationSupportService } from '../mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from '../mutation/ai-task-mutation-support.service';
import { CreateBusinessRecordAiMutationOperation } from '../mutation/operations/create-business-record.ai-mutation-operation';
import { CreateDocumentAiMutationOperation } from '../mutation/operations/create-document.ai-mutation-operation';
import { CreateTaskAiMutationOperation } from '../mutation/operations/create-task.ai-mutation-operation';
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
    target_entity_type: 'spend_items',
    mutation_input: {
      action: 'create',
      entity_type: 'spend_items',
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
    target_entity_type: 'spend_items',
    mutation_input: { action: 'upsert_amounts', entity_type: 'spend_items' },
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
    target_entity_type: 'spend_items',
    mutation_input: { action: 'upsert_amounts', entity_type: 'spend_items' },
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
    target_entity_type: 'spend_items',
    mutation_input: {
      action: 'create',
      entity_type: 'spend_items',
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
  await testDefaultTaskType();
  await testPersonLanguage();
  console.log('ai-write-preview-summaries.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
