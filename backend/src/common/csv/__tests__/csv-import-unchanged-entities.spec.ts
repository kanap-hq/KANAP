/**
 * Re-importing an exported row of a generic-import entity counts it as unchanged, and a row
 * that only differs in a value a hook resolves (a catalog name, a virtual column, a text kept
 * in a document) still counts as an update. Runs the real entity configs through
 * CsvImportService against a manager that answers like PostgreSQL (dates as Dates, bigint and
 * numeric as strings, JSON as objects).
 */
import * as assert from 'node:assert/strict';
import { CsvImportService } from '../csv-import.service';
import { CsvResolverService } from '../csv-resolver.service';
import { CsvJsonValidators } from '../csv-json-validators';
import { CsvEntityConfig, CsvImportParams } from '../csv-field.types';
import { assetCsvConfig } from '../../../assets/asset-csv.config';
import { applicationCsvConfig } from '../../../applications/application-csv.config';
import { taskCsvConfig } from '../../../tasks/task-csv.config';
import { portfolioProjectCsvConfig } from '../../../portfolio/portfolio-project-csv.config';
import { portfolioRequestCsvConfig } from '../../../portfolio/portfolio-request-csv.config';
import { incidentCsvConfig } from '../../../incidents/incident-csv.config';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../../it-ops-settings/classification-catalog';

const T = 't1';
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

const itOpsSettings: any = {
  ...DEFAULT_CLASSIFICATION_CATALOG,
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }, { code: 'physical', label: 'Physical server' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }, { code: 'retired', label: 'Retired' }],
  operatingSystems: [{ code: 'linux', label: 'Linux' }],
  domains: [{ code: 'corp', label: 'Corporate' }],
  ipAddressTypes: [{ code: 'mgmt', label: 'Management' }],
  applicationCategories: [{ code: 'erp', label: 'Enterprise planning' }],
  accessMethods: [{ code: 'web', label: 'Web browser' }],
  incidentCategories: [{ code: 'outage', label: 'Service outage' }],
};

const users = [
  { id: U1, tenant_id: T, email: 'ann@example.com', first_name: 'Ann', last_name: 'One' },
  { id: U2, tenant_id: T, email: 'bob@example.com', first_name: 'Bob', last_name: 'Two' },
];

function file(content: string): Express.Multer.File {
  const text = '﻿' + content;
  return { buffer: Buffer.from(text, 'utf8'), originalname: 'export.csv', mimetype: 'text/csv', size: text.length } as Express.Multer.File;
}

/** Answers each query with the rows of the table it reads: the hooks filter by id themselves. */
function manager(data: Record<string, any[]>) {
  return {
    query: async (sql: string) => {
      const table = sql.match(/FROM\s+(\w+)/i)?.[1] ?? '';
      return data[table] ?? [];
    },
    getRepository: () => ({ create: (e: any) => e, save: async (e: any) => e }),
  } as any;
}

/** A stored row as `SELECT *` returns it: every column of the config is there, null when not given. */
function stored(config: CsvEntityConfig, values: Record<string, any>) {
  const row: Record<string, any> = {};
  for (const field of config.fields) {
    if (!field.entityProperty.startsWith('_')) row[field.entityProperty] = null;
  }
  return { ...row, ...values };
}

const service = new CsvImportService(new CsvResolverService(), new CsvJsonValidators());

async function counts(config: CsvEntityConfig, csv: string, data: Record<string, any[]>, mode: CsvImportParams['mode']) {
  const result = await service.import(config, file(csv), { dryRun: true, mode, operation: 'upsert' }, {
    manager: manager({ users, ...data }),
    tenantId: T,
    userId: U1,
    isAdmin: true,
    itOpsSettings,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return { updated: result.updated, unchanged: result.unchanged };
}

/** The exported line is unchanged; each variant line is an update, in both modes. */
async function check(name: string, config: CsvEntityConfig, header: string, line: string, variants: Record<string, string>, data: Record<string, any[]>) {
  for (const mode of ['enrich', 'replace'] as const) {
    assert.deepEqual(await counts(config, `${header}\n${line}`, data, mode), { updated: 0, unchanged: 1 }, `${name} ${mode}: exported row`);
    for (const [label, variant] of Object.entries(variants)) {
      assert.deepEqual(await counts(config, `${header}\n${variant}`, data, mode), { updated: 1, unchanged: 0 }, `${name} ${mode}: ${label}`);
    }
  }
}

async function testAssets() {
  const asset = stored(assetCsvConfig, {
    id: 'a1', tenant_id: T, name: 'srv-01', location_id: 'l1', provider: 'ovh', kind: 'vm', is_cluster: false,
    status: 'active', go_live_date: new Date(2024, 0, 15), end_of_life_date: null, notes: null, environment: 'prod',
    hostname: 'srv-01', domain: 'corp', aliases: ['web'], operating_system: 'linux', cluster: null,
    ip_addresses: [{ type: 'mgmt', ip: '10.0.0.1', subnet_cidr: '10.0.0.0/24' }],
  });

  const header = 'id;name;location_reference;kind;is_cluster;status;go_live_date;end_of_life_date;notes;environment;hostname;domain;aliases;operating_system;cluster;ip_1_type;ip_1_address;ip_1_subnet_cidr';
  const line = 'a1;srv-01;LOC-1;Virtual machine;false;Active;2024-01-15;;;prod;srv-01;Corporate;web;Linux;;Management;10.0.0.1;10.0.0.0/24';
  await check('asset', assetCsvConfig, header, line, {
    'another kind name': line.replace('Virtual machine', 'Physical server'),
    'another lifecycle name': line.replace('Active', 'Retired'),
  }, {
    assets: [asset],
    locations: [{ id: 'l1', tenant_id: T, location_reference: 'LOC-1', name: 'Paris' }],
  });
}

async function testApplications() {
  const app = stored(applicationCsvConfig, {
    id: 'p1', tenant_id: T, name: 'Ledger', description: 'Books', category: 'erp', supplier_id: null, editor: null,
    criticality: 'high', lifecycle: 'active', is_suite: false, version: null, go_live_date: null,
    end_of_support_date: null, retired_date: null, licensing: null, notes: null, access_methods: ['web'],
    external_facing: false, etl_enabled: false, support_notes: null, data_class: 'internal',
    last_dr_test: new Date(2026, 2, 1), contains_pii: false, status: 'enabled', rto_minutes: 240, rpo_minutes: 60,
    cyber_criticality: 'moderate', recovery_wave: 'priority', classification_justification: 'Finance',
    classification_revision: 3,
  });

  const header = 'id;name;description;category;lifecycle;is_suite;external_facing;etl_enabled;access_methods;criticality;cyber_criticality;data_class;recovery_wave;rto_minutes;rpo_minutes;classification_justification;contains_pii;last_dr_test;data_residency;status;business_owner_email_1;business_owner_email_2;it_owner_email_1';
  const line = 'p1;Ledger;Books;Enterprise planning;Active;false;false;false;Web browser;High;Moderate;Internal;V2 — Priority activities;240;60;Finance;false;2026-03-01;FR;enabled;ann@example.com;;bob@example.com';
  await check('application', applicationCsvConfig, header, line, {
    'another business owner': line.replace('ann@example.com;;', 'ann@example.com;bob@example.com;'),
    'another data residency': line.replace(';FR;', ';FR, DE;'),
    'another lifecycle name': line.replace(';Active;', ';Retired;'),
  }, {
    applications: [app],
    application_owners: [
      { tenant_id: T, application_id: 'p1', user_id: U1, owner_type: 'business' },
      { tenant_id: T, application_id: 'p1', user_id: U2, owner_type: 'it' },
    ],
    application_data_residency: [{ tenant_id: T, application_id: 'p1', country_iso: 'FR' }],
  });
}

async function testTasks() {
  const task = stored(taskCsvConfig, {
    id: 'k1', tenant_id: T, title: 'Migrate', description: 'Move it', task_type_id: null,
    related_object_type: 'project', related_object_id: 'pr1', phase_id: 'ph1', priority_level: 'high',
    category_id: null, stream_id: null, source_id: null, company_id: null, status: 'in_progress',
    start_date: new Date(2026, 4, 1), due_date: null, assignee_user_id: U1, item_number: 7,
    viewer_ids: [U2], owner_ids: [U1], labels: ['infra'],
  });

  const header = 'id;title;description;related_object_type;related_object_id;related_object_name;phase_name;priority_level;status;start_date;due_date;assignee_email;viewer_email_1;viewer_email_2;owner_email_1;labels';
  const line = 'k1;Migrate;Move it;project;pr1;Cloud move;Design;high;in_progress;2026-05-01;;ann@example.com;bob@example.com;;ann@example.com;infra';
  await check('task', taskCsvConfig, header, line, {
    'another viewer': line.replace('bob@example.com;;', 'bob@example.com;ann@example.com;'),
    'another owner': line.replace(';ann@example.com;infra', ';bob@example.com;infra'),
  }, {
    tasks: [task],
    // The same phase name in two projects: the file names the task's own.
    portfolio_project_phases: [
      { id: 'ph0', tenant_id: T, name: 'Design', project_id: 'pr0' },
      { id: 'ph1', tenant_id: T, name: 'Design', project_id: 'pr1' },
    ],
    portfolio_projects: [{ id: 'pr1', tenant_id: T, name: 'Cloud move' }],
  });
}

function documentRows(entityType: string, id: string, slots: Record<string, string>) {
  return Object.entries(slots).map(([slot_key, content_markdown]) => ({
    source_entity_type: entityType, source_entity_id: id, slot_key, content_markdown,
  }));
}

async function testProjects() {
  const project = stored(portfolioProjectCsvConfig, {
    id: 'j1', tenant_id: T, name: 'Cloud move', status: 'in_progress', purpose: 'stale column', origin: 'standard',
    planned_start: new Date(2026, 0, 1), execution_progress: 40, estimated_effort_it: '12.50', item_number: 3,
  });

  const header = 'id;name;status;purpose;origin;planned_start;execution_progress;estimated_effort_it';
  const line = 'j1;Cloud move;in_progress;Leave the data centre;standard;2026-01-01;40;12.5';
  await check('project', portfolioProjectCsvConfig, header, line, {
    'another purpose': line.replace('Leave the data centre', 'Stay'),
  }, {
    portfolio_projects: [project],
    integrated_document_bindings: documentRows('projects', 'j1', { purpose: 'Leave the data centre' }),
  });
}

async function testRequests() {
  const request = stored(portfolioRequestCsvConfig, {
    id: 'r1', tenant_id: T, name: 'New CRM', status: 'pending_review', purpose: null, risks: null,
    current_situation: 'Spreadsheets', item_number: 2,
  });

  const header = 'id;name;status;purpose;current_situation;risks';
  const line = 'r1;New CRM;pending_review;Track customers;Spreadsheets;Adoption';
  await check('request', portfolioRequestCsvConfig, header, line, {
    'another purpose': line.replace('Track customers', 'Track leads'),
    'other risks': line.replace('Adoption', 'Cost'),
  }, {
    portfolio_requests: [request],
    integrated_document_bindings: documentRows('requests', 'r1', { purpose: 'Track customers', risks_mitigations: 'Adoption' }),
  });
}

async function testIncidents() {
  const incident = stored(incidentCsvConfig, {
    id: 'i1', tenant_id: T, item_number: 4, title: 'Mail down', category: 'outage', severity: 'major', status: 'resolved',
    confidential: false, detected_at: new Date('2026-09-01T08:30:00.000Z'), description: null,
    personal_data_affected: false, authority_notification_required: false, reporter_user_id: U1, owner_user_id: null,
  });

  const header = 'ref;title;category;severity;status;confidential;detected_at;reporter;review';
  const line = 'INC-4;Mail down;Service outage;major;resolved;false;2026-09-01T08:30:00.000Z;ann@example.com;Root cause found';
  await check('incident', incidentCsvConfig, header, line, {
    'another review': line.replace('Root cause found', 'Still open'),
  }, {
    incidents: [incident],
    integrated_document_bindings: documentRows('incidents', 'i1', { review: 'Root cause found' }),
  });
}

(async () => {
  await testAssets();
  await testApplications();
  await testTasks();
  await testProjects();
  await testRequests();
  await testIncidents();
  console.log('csv-import-unchanged-entities.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
