// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Person } from './record-history.fixtures';
import {
  assertNoField,
  assertPresentable,
  findChange,
  findChild,
  findItem,
  readPage,
} from './record-history-family-c.fixtures';

// The history of an interface (lot 2, family C): its own creation and modification in words (the
// long free-text blocks and the neighbour names stay out, a middleware id list reads as added or
// removed applications), the sets its writers replace as a whole (flow legs, owners, companies,
// dependencies, key identifiers, data residency, links), the single-row link writes, the bindings,
// the mapping sets and the attachments. Its page is closed to a Business Contributor with a
// limited applications access: the history answers 404 as the page does.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Seeded = {
  data: HistorySeed;
  reader: Person;
  businessContributor: Person;
  relatedInterface: string;
  middlewareApplication: string;
  secondUser: string;
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

async function stored(runner: QueryRunner, table: string, id: string): Promise<Record<string, unknown>> {
  const [row] = await runner.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE t.id = $1`, [id]);
  return row.row as Record<string, unknown>;
}

async function seedInterfaceAudits(runner: QueryRunner, data: HistorySeed): Promise<{
  relatedInterface: string;
  middlewareApplication: string;
  secondUser: string;
}> {
  await runner.query(
    `UPDATE interfaces SET business_process_id = $3, overview_notes = 'Orders nightly',
            functional_rules = 'One order per line', typical_data = 'Order id, amount'
      WHERE tenant_id = $1 AND id = $2`,
    [data.tenantId, data.interfaceRecord, data.businessProcess],
  );
  const application = data.application;
  const middlewareApplication = await one(
    runner,
    `INSERT INTO applications (tenant_id, name, sequential_id) VALUES ($1, 'Middleware Hub', 'APP-77') RETURNING id`,
    [data.tenantId],
  );
  const relatedInterface = await one(
    runner,
    `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id,
                             data_category, integration_route_type, interface_reference)
     VALUES ($1, 'Related interface', 'Related', $2, $2, 'operational', 'direct', 'INT-77') RETURNING id`,
    [data.tenantId, application],
  );
  const [firstLeg] = await runner.query(
    `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type,
                                 integration_pattern, data_format, job_name, order_index)
     VALUES ($1, $2, 'extract', 'source', 'middleware', 'scheduled', 'batch', 'csv', 'orders-daily', 1) RETURNING id`,
    [data.tenantId, data.interfaceRecord],
  );
  await runner.query(
    `INSERT INTO interface_legs (tenant_id, interface_id, leg_type, from_role, to_role, trigger_type,
                                 integration_pattern, data_format, job_name, order_index)
     VALUES ($1, $2, 'load', 'middleware', 'target', 'scheduled', 'batch', 'json', 'orders-load', 2)`,
    [data.tenantId, data.interfaceRecord],
  );
  const instanceOne = await one(
    runner,
    `INSERT INTO app_instances (tenant_id, application_id, environment, lifecycle)
     VALUES ($1, $2, 'prod', 'active') RETURNING id`,
    [data.tenantId, application],
  );
  const instanceTwo = await one(
    runner,
    `INSERT INTO app_instances (tenant_id, application_id, environment, lifecycle)
     VALUES ($1, $2, 'test', 'active') RETURNING id`,
    [data.tenantId, application],
  );
  const binding = await one(
    runner,
    `INSERT INTO interface_bindings (tenant_id, interface_id, interface_leg_id, environment, source_instance_id,
                                     target_instance_id, source_endpoint, target_endpoint, status)
     VALUES ($1, $2, $3, 'PROD', $4, $5, 'https://source.example.invalid', 'https://target.example.invalid', 'active')
     RETURNING id`,
    [data.tenantId, data.interfaceRecord, firstLeg.id, instanceOne, instanceTwo],
  );
  const mappingSet = await one(
    runner,
    `INSERT INTO interface_mapping_sets (tenant_id, interface_id, name, description, is_default, revision_number)
     VALUES ($1, $2, 'Main mapping', 'Order fields', true, 1) RETURNING id`,
    [data.tenantId, data.interfaceRecord],
  );
  const attachment = await one(
    runner,
    `INSERT INTO interface_attachments (tenant_id, interface_id, kind, original_filename, stored_filename, mime_type, size, storage_path)
     VALUES ($1, $2, 'functional', 'spec.pdf', 'stored.pdf', 'application/pdf', 2048, 'files/spec.pdf') RETURNING id`,
    [data.tenantId, data.interfaceRecord],
  );
  const secondUser = await seedPerson(runner, data.tenantId, { first: 'Bao', last: 'Owner' }, { locations: 'reader' });

  // The record itself.
  const interfaceRow = await stored(runner, 'interfaces', data.interfaceRecord);
  await audit(runner, {
    table: 'interfaces', recordId: data.interfaceRecord, action: 'create', userId: data.owner, after: interfaceRow,
  });
  await audit(runner, {
    table: 'interfaces', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: interfaceRow,
    after: {
      ...interfaceRow,
      name: 'Orders sync 2',
      business_purpose: 'Orders and invoices',
      functional_rules: 'One order per line, one invoice per order',
      typical_data: 'Order id, amount, invoice id',
      source_application_name: 'A copied neighbour name',
      middleware_application_ids: [middlewareApplication],
    },
  });
  await audit(runner, {
    table: 'interfaces', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: { middleware_application_ids: [middlewareApplication] },
    after: { middleware_application_ids: [] },
  });

  // The flow legs: the whole set is replaced.
  const legOne = { id: firstLeg.id, leg_type: 'extract', order_index: 1, trigger_type: 'scheduled', integration_pattern: 'batch', data_format: 'csv', job_name: 'orders-daily' };
  const legTwo = { id: randomUUID(), leg_type: 'load', order_index: 2, trigger_type: 'scheduled', integration_pattern: 'batch', data_format: 'json', job_name: 'orders-load' };
  await audit(runner, {
    table: 'interface_legs', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [], after: [legOne, legTwo],
  });
  await audit(runner, {
    table: 'interface_legs', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [legOne, legTwo], after: [{ ...legOne, data_format: 'tsv' }, legTwo],
  });
  await audit(runner, {
    table: 'interface_legs', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [legOne, legTwo], after: [legOne],
  });

  // Owners, companies, dependencies, key identifiers and data residency: the whole set.
  await audit(runner, {
    table: 'interface_owners', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [`business:${data.owner}`], after: [`it:${secondUser.id}`],
  });
  await audit(runner, {
    table: 'interface_companies', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [], after: [data.companyA],
  });
  await audit(runner, {
    table: 'interface_dependencies', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [], after: [`upstream:${relatedInterface}`],
  });
  await audit(runner, {
    table: 'interface_key_identifiers', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [], after: ['order_id:order_ref:Must match'],
  });
  await audit(runner, {
    table: 'interface_data_residency', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [], after: ['FR'],
  });

  // The whole-set link replacement, then one single-row link write.
  await audit(runner, {
    table: 'interface_links', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [], after: [{ kind: 'functional', description: 'Spec link', url: 'https://example.invalid/spec' }],
  });
  await audit(runner, {
    table: 'interface_links', recordId: data.interfaceRecord, action: 'update', userId: data.owner,
    before: [{ kind: 'functional', description: 'Spec link', url: 'https://example.invalid/spec' }], after: [],
  });
  const linkRow = await one(
    runner,
    `INSERT INTO interface_links (tenant_id, interface_id, kind, description, url)
     VALUES ($1, $2, 'functional', 'Runbook', 'https://example.invalid/runbook') RETURNING id`,
    [data.tenantId, data.interfaceRecord],
  );
  const link = await stored(runner, 'interface_links', linkRow);
  await audit(runner, {
    table: 'interface_links', recordId: linkRow, action: 'create', userId: data.owner, after: link,
  });
  await audit(runner, {
    table: 'interface_links', recordId: linkRow, action: 'update', userId: data.owner,
    before: link, after: { ...link, url: 'https://example.invalid/runbook-v2', kind: 'technical' },
  });
  await audit(runner, {
    table: 'interface_links', recordId: linkRow, action: 'delete', userId: data.owner, before: link, after: null,
  });

  // A binding: created, changed, removed.
  const bindingRow = await stored(runner, 'interface_bindings', binding);
  await audit(runner, {
    table: 'interface_bindings', recordId: binding, action: 'create', userId: data.owner, after: bindingRow,
  });
  await audit(runner, {
    table: 'interface_bindings', recordId: binding, action: 'update', userId: data.owner,
    before: bindingRow,
    after: {
      ...bindingRow,
      status: 'in_test',
      trigger_details: 'Every night at 02:00',
      source_endpoint: 'https://source.example.invalid/v2',
      integration_tool_application_id: middlewareApplication,
    },
  });
  await audit(runner, {
    table: 'interface_bindings', recordId: binding, action: 'delete', userId: data.owner, before: bindingRow, after: null,
  });

  // A mapping group and a mapping rule: their own id in record_id, the interface in the payload.
  const mappingGroup = await one(
    runner,
    `INSERT INTO interface_mapping_groups (tenant_id, interface_id, mapping_set_id, title, description, order_index)
     VALUES ($1, $2, $3, 'Header', 'The document header', 1) RETURNING id`,
    [data.tenantId, data.interfaceRecord, mappingSet],
  );
  const mappingGroupRow = await stored(runner, 'interface_mapping_groups', mappingGroup);
  await audit(runner, {
    table: 'interface_mapping_groups', recordId: mappingGroup, action: 'create', userId: data.owner, after: mappingGroupRow,
  });
  await audit(runner, {
    table: 'interface_mapping_groups', recordId: mappingGroup, action: 'update', userId: data.owner,
    before: mappingGroupRow,
    after: { ...mappingGroupRow, title: 'Header 2', description: 'Header and footer' },
  });
  await audit(runner, {
    table: 'interface_mapping_groups', recordId: mappingGroup, action: 'delete', userId: data.owner, before: mappingGroupRow, after: null,
  });
  const mappingRule = await one(
    runner,
    `INSERT INTO interface_mapping_rules (tenant_id, interface_id, mapping_set_id, group_id, title, rule_key,
                                          order_index, operation_kind, lifecycle, environment_scope, condition_text, source_bindings)
     VALUES ($1, $2, $3, $4, 'Customer id', 'customer-id', 1, 'direct', 'active', ARRAY['prod'], 'Must match', '[{"path":"customer.id"}]'::jsonb)
     RETURNING id`,
    [data.tenantId, data.interfaceRecord, mappingSet, mappingGroup],
  );
  const mappingRuleRow = await stored(runner, 'interface_mapping_rules', mappingRule);
  await audit(runner, {
    table: 'interface_mapping_rules', recordId: mappingRule, action: 'create', userId: data.owner, after: mappingRuleRow,
  });
  await audit(runner, {
    table: 'interface_mapping_rules', recordId: mappingRule, action: 'update', userId: data.owner,
    before: mappingRuleRow,
    after: {
      ...mappingRuleRow,
      title: 'Customer identifier',
      lifecycle: 'proposed',
      condition_text: 'Must match the sold-to party',
      source_bindings: [{ path: 'sold_to.id' }],
    },
  });
  await audit(runner, {
    table: 'interface_mapping_rules', recordId: mappingRule, action: 'delete', userId: data.owner, before: mappingRuleRow, after: null,
  });

  // A mapping set and an attachment.
  const mappingSetRow = await stored(runner, 'interface_mapping_sets', mappingSet);
  await audit(runner, {
    table: 'interface_mapping_sets', recordId: mappingSet, action: 'create', userId: data.owner, after: mappingSetRow,
  });
  await audit(runner, {
    table: 'interface_mapping_sets', recordId: mappingSet, action: 'update', userId: data.owner,
    before: mappingSetRow, after: { ...mappingSetRow, name: 'Main mapping 2', description: 'Order and invoice fields' },
  });
  await audit(runner, {
    table: 'interface_mapping_sets', recordId: mappingSet, action: 'delete', userId: data.owner, before: mappingSetRow, after: null,
  });
  const attachmentRow = await stored(runner, 'interface_attachments', attachment);
  await audit(runner, {
    table: 'interface_attachments', recordId: attachment, action: 'create', userId: data.owner, after: attachmentRow,
  });
  await audit(runner, {
    table: 'interface_attachments', recordId: attachment, action: 'delete', userId: data.owner, before: attachmentRow, after: null,
  });

  return { relatedInterface, middlewareApplication, secondUser: secondUser.id };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const applications = { applications: 'reader' };
  const page = await readPage(seeded.reader, seeded.data.tenantId, 'interfaces', seeded.data.interfaceRecord, applications);
  assert.ok(page.items.length >= 15, 'an applications reader reads the interface history');

  await assert.rejects(
    () => readPage(seeded.reader, seeded.data.tenantId, 'interfaces', seeded.data.interfaceRecord, { locations: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a reader without applications gets 403 MODULE_RIGHT_REQUIRED',
  );
  await assert.rejects(
    () => readPage(seeded.businessContributor, seeded.data.tenantId, 'interfaces', seeded.data.interfaceRecord, applications),
    (error: any) => error?.status === 404,
    'a Business Contributor with a limited applications access gets 404, as the page',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.data.tenantId, 'interfaces', randomUUID(), applications),
    (error: any) => error?.status === 404,
    'a missing interface gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.reader, seeded.data.tenantId, 'interfaces', foreign.interfaceRecord, applications),
    (error: any) => error?.status === 404,
    'an interface of another tenant gets 404',
  );
  console.log('  200 with the module, 403 without it, 404 for a limited contributor, missing and foreign interfaces: OK');
}

async function testInterfaceEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.reader, data.tenantId, 'interfaces', data.interfaceRecord, {
    applications: 'reader', business_processes: 'reader',
  });
  assertPresentable(page);

  const create = findItem(page, 'create');
  assert.equal(findChange(create, 'name').after, 'Orders sync');
  assert.equal(findChange(create, 'business_purpose').after, 'Orders');
  assert.equal(findChange(create, 'data_category').after, 'operational');
  assert.equal(findChange(create, 'integration_route_type').after, 'direct');
  const source = findChange(create, 'source_application_id').after as any;
  assert.equal(source.kind, 'application');
  assert.equal(source.label, 'Ledger App');
  const process = findChange(create, 'business_process_id').after as any;
  assert.equal(process.kind, 'business_process');
  assert.equal(process.label, 'Order to cash');

  const update = page.items.find((item) => item.subject.kind === 'record' && item.action === 'update'
    && item.changes.some((change) => change.field === 'name'));
  assert.ok(update, 'the interface update that renamed it');
  assert.equal(findChange(update, 'name').before, 'Orders sync');
  assert.equal(findChange(update, 'name').after, 'Orders sync 2');
  assert.equal(findChange(update, 'business_purpose').after, 'Orders and invoices');

  const middleware = page.items.flatMap((item) => item.changes)
    .find((change) => change.field === 'middleware' && change.event === 'added');
  assert.ok(middleware, 'the middleware application is an added event');
  assert.equal((middleware.after as any).kind, 'application');
  assert.equal((middleware.after as any).label, 'Middleware Hub');
  const middlewareRemoved = page.items.flatMap((item) => item.changes)
    .find((change) => change.field === 'middleware' && change.event === 'removed');
  assert.ok(middlewareRemoved, 'the middleware application is a removed event');

  for (const field of ['functional_rules', 'typical_data', 'overview_notes', 'pii_description',
    'source_application_name', 'target_application_name', 'business_process_name', 'middleware_application_names',
    'middleware_application_ids']) {
    assertNoField(page, field);
  }
  assert.ok(!JSON.stringify(page).includes('A copied neighbour name'), 'a neighbour name never comes out');
  assertNoField(page, 'tenant_id');
  console.log('  interface creation and modification in words, references named, long text and neighbour names hidden: OK');
}

function changesOf(page: { items: Array<{ changes: Array<{ field: string; event?: string; [key: string]: unknown }> }> }, field: string) {
  return page.items.flatMap((item) => item.changes).filter((change) => change.field === field);
}

async function testSets(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.reader, data.tenantId, 'interfaces', data.interfaceRecord, {
    applications: 'reader', companies: 'reader',
  });

  const legAdds = changesOf(page, 'interface_leg');
  assert.equal(legAdds.filter((change) => change.event === 'added').length, 2, 'two flow legs added');
  const legRemoved = legAdds.find((change) => change.event === 'removed');
  assert.ok(legRemoved, 'the removed flow leg');
  assert.equal((legRemoved.before as any).kind, 'leg');
  assert.equal((legRemoved.before as any).label, '2');
  const legChange = page.items.find((item) => item.subject.kind === 'set'
    && item.changes.some((change) => change.field === 'data_format'));
  assert.ok(legChange, 'a leg data format change');
  assert.equal(legChange.subject.label, '1');
  assert.equal(findChange(legChange, 'data_format').before, 'csv');
  assert.equal(findChange(legChange, 'data_format').after, 'tsv');

  // The screen names the owner type: a business owner removed, an IT owner added.
  const ownerRemoved = changesOf(page, 'owner_business').find((change) => change.event === 'removed');
  const ownerAdded = changesOf(page, 'owner_it').find((change) => change.event === 'added');
  assert.equal((ownerRemoved?.before as any).label, 'Ava Reader');
  assert.equal((ownerAdded?.after as any).label, 'Bao Owner');
  assert.equal(changesOf(page, 'owner').length, 0, 'no untyped owner line');

  const company = changesOf(page, 'company').find((change) => change.event === 'added');
  assert.equal((company?.after as any).kind, 'company');
  assert.equal((company?.after as any).label, 'Alpha Co');

  const dependency = changesOf(page, 'dependency').find((change) => change.event === 'added');
  assert.equal((dependency?.after as any).kind, 'interface');
  assert.equal((dependency?.after as any).reference, 'INT-77');

  const keyIdentifier = changesOf(page, 'key_identifier').find((change) => change.event === 'added');
  assert.equal(keyIdentifier?.after, 'order_id → order_ref');

  const country = changesOf(page, 'country').find((change) => change.event === 'added');
  assert.equal(country?.after, 'FR');

  const linkAdded = changesOf(page, 'link').find((change) => change.event === 'added' && change.after === 'Spec link');
  assert.equal(linkAdded?.after, 'Spec link');
  const linkRemoved = changesOf(page, 'link').find((change) => change.event === 'removed' && change.before === 'Spec link');
  assert.equal(linkRemoved?.before, 'Spec link');

  // The single-row link write: read by its parent columns, presented as a link.
  const linkRow = page.items.find((item) => item.subject.kind === 'set' && item.action === 'create'
    && item.changes.some((change) => change.field === 'link'));
  assert.ok(linkRow, 'the single-row link creation');
  assert.equal(linkRow.subject.label, 'Runbook');
  const linkUpdate = page.items.find((item) => item.subject.kind === 'set'
    && item.changes.some((change) => change.field === 'url'));
  assert.ok(linkUpdate, 'the single-row link update');
  assert.equal(findChange(linkUpdate, 'url').after, 'https://example.invalid/runbook-v2');
  assert.equal(findChange(linkUpdate, 'kind').after, 'technical');
  const linkDelete = page.items.find((item) => item.subject.kind === 'set' && item.action === 'delete'
    && item.changes.some((change) => change.field === 'link'));
  assert.ok(linkDelete, 'the single-row link deletion');
  console.log('  flow legs, owners, companies, dependencies, key identifiers, countries and links in words: OK');
}

async function testBindingsMappingAndAttachments(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.reader, data.tenantId, 'interfaces', data.interfaceRecord, { applications: 'reader' });

  const binding = findChild(page, 'binding', 'create');
  assert.equal(binding.subject.label, 'PROD');
  assert.deepEqual(binding.changes, [], 'a binding creation is its title');
  const bindingUpdate = findChild(page, 'binding', 'update');
  assert.equal(bindingUpdate.subject.label, 'PROD');
  assert.equal(findChange(bindingUpdate, 'status').after, 'in_test');
  assert.equal(findChange(bindingUpdate, 'trigger_details').after, 'Every night at 02:00');
  assert.equal(findChange(bindingUpdate, 'source_endpoint').after, 'https://source.example.invalid/v2');
  const tool = findChange(bindingUpdate, 'integration_tool_application_id').after as any;
  assert.equal(tool.kind, 'application');
  assert.equal(tool.label, 'Middleware Hub');
  assert.equal(findChild(page, 'binding', 'delete').subject.label, 'PROD');

  const mappingCreate = page.items.find((item) => item.subject.kind === 'set'
    && item.changes.some((change) => change.field === 'mapping_set' && change.event === 'added'));
  assert.ok(mappingCreate, 'the mapping set creation');
  assert.equal(findChange(mappingCreate, 'mapping_set').after, 'Main mapping');
  const mappingUpdate = page.items.find((item) => item.subject.kind === 'set'
    && item.changes.some((change) => change.field === 'name'));
  assert.ok(mappingUpdate, 'the mapping set update');
  assert.equal(findChange(mappingUpdate, 'name').after, 'Main mapping 2');
  assert.equal(findChange(mappingUpdate, 'description').after, 'Order and invoice fields');
  const mappingDelete = page.items.find((item) => item.subject.kind === 'set'
    && item.changes.some((change) => change.field === 'mapping_set' && change.event === 'removed'));
  assert.ok(mappingDelete, 'the mapping set deletion');

  const groupCreate = page.items.find((item) => item.changes.some((change) => change.field === 'mapping_group' && change.event === 'added'));
  assert.ok(groupCreate, 'the mapping group creation');
  assert.equal(findChange(groupCreate, 'mapping_group').after, 'Header');
  const groupUpdate = page.items.find((item) => item.subject.kind === 'set'
    && item.changes.some((change) => change.field === 'title' && change.after === 'Header 2'));
  assert.ok(groupUpdate, 'the mapping group update');
  assert.equal(findChange(groupUpdate, 'title').before, 'Header');
  assert.equal(findChange(groupUpdate, 'title').after, 'Header 2');
  assert.equal(findChange(groupUpdate, 'description').after, 'Header and footer');
  const groupDelete = page.items.find((item) => item.changes.some((change) => change.field === 'mapping_group' && change.event === 'removed'));
  assert.ok(groupDelete, 'the mapping group deletion');
  assert.equal(findChange(groupDelete, 'mapping_group').before, 'Header');

  const ruleCreate = page.items.find((item) => item.changes.some((change) => change.field === 'mapping_rule' && change.event === 'added'));
  assert.ok(ruleCreate, 'the mapping rule creation');
  assert.equal(findChange(ruleCreate, 'mapping_rule').after, 'Customer id');
  const ruleUpdate = page.items.find((item) => item.subject.kind === 'set'
    && item.changes.some((change) => change.field === 'lifecycle'));
  assert.ok(ruleUpdate, 'the mapping rule update');
  assert.equal(findChange(ruleUpdate, 'title').after, 'Customer identifier');
  assert.equal(findChange(ruleUpdate, 'lifecycle').before, 'active');
  assert.equal(findChange(ruleUpdate, 'lifecycle').after, 'proposed');
  assert.deepEqual(findChange(ruleUpdate, 'condition_text'), { field: 'condition_text', text: 'conditionChanged' });
  assert.deepEqual(findChange(ruleUpdate, 'source_bindings'), { field: 'source_bindings', text: 'sourceBindingsChanged' });
  const ruleDelete = page.items.find((item) => item.changes.some((change) => change.field === 'mapping_rule' && change.event === 'removed'));
  assert.ok(ruleDelete, 'the mapping rule deletion');
  assert.ok(!JSON.stringify(page).includes('Must match'), 'a rule condition never comes out');
  assert.ok(!JSON.stringify(page).includes('customer.id'), 'a source binding never comes out');
  assert.ok(!JSON.stringify(page).includes('sold_to'), 'a changed source binding never comes out');

  const attachment = findChild(page, 'attachment', 'create');
  assert.equal(attachment.subject.label, 'spec.pdf');
  assert.equal(findChange(attachment, 'attachment').event, 'added');
  assert.equal(findChange(findChild(page, 'attachment', 'delete'), 'attachment').event, 'removed');

  for (const field of ['storage_path', 'stored_filename', 'interface_leg_id', 'source_instance_id',
    'target_instance_id', 'revision_number']) {
    assertNoField(page, field);
  }
  console.log('  bindings, mapping sets, groups, rules and attachments created, changed and removed in words: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-interfaces');
  const foreignTenantId = await createRaceTenant('record-history-interfaces-foreign');
  try {
    const seeded: Seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      const extra = await seedInterfaceAudits(runner, data);
      const reader = await seedPerson(runner, tenantId, { first: 'Iris', last: 'Integration' }, { applications: 'reader' });
      const businessContributor = await seedPerson(
        runner,
        tenantId,
        { first: 'Bea', last: 'Contributor' },
        { applications: 'reader' },
        { exactRoleName: 'Business Contributor' },
      );
      return { data, reader, businessContributor, ...extra };
    });
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));

    await testAccess(seeded, foreign);
    await testInterfaceEntries(seeded);
    await testSets(seeded);
    await testBindingsMappingAndAttachments(seeded);
    console.log('record-history-interfaces.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
