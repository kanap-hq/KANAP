import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// A link the assistant changes leaves in the audit log the trace the screen leaves for the same
// gesture (lot K2b), and it reads in the History tab of the record, said "by Kad":
// - one entry per relation of the assistant's relation writer (`update_entity_relations`), three
//   gestures each: add, remove, replace (one removed, one added);
// - the assistant plays the gesture on a record up to the approval of its card; the screen's own
//   service plays the same gesture on a twin record in the same state; their audit rows are
//   compared (tables, actions, before and after, parent), the record ids, the generated ids and the
//   dates neutralised, and the assistant's rows carry the card (`ai_chat`, the preview id);
// - the History tab of the record, and of the other records the screen marks, holds an entry by the
//   assistant that names the linked record;
// - read by a person who may not read the linked record's module, the entry does not name it;
// - the undo of an addition leaves the trace of the screen's removal of the same link.
// The grid is a table: `CASES` below, one entry per relation. A relation the second pass of the lot
// fixes is added there.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-relation-history-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Gesture = 'add' | 'remove' | 'replace';
const GESTURES: Gesture[] = ['add', 'remove', 'replace'];

/** A linked record (or a web link) of a case: its id when it has one, and the name the history shows. */
type Target = { id: string; name: string; input: unknown; extra?: Record<string, unknown> };

/** One record of a gesture: the assistant's, or its twin for the screen. */
type Rec = { id: string; ref: string; instanceId?: string };

type Env = {
  runner: QueryRunner;
  tenantId: string;
  writer: string;
  roleId: string;
  app: any;
  services: Record<string, any>;
};

/** A gesture: the targets that stay linked, the one removed, the one added. */
type Step = { kept: Target; stays: Target[]; removed?: Target; added?: Target };

type Case = {
  name: string;
  entity: 'applications' | 'assets';
  relation: string;
  /** The History route key of the record. */
  table: 'applications' | 'assets';
  /** kept, removed (by remove and replace), added (by add and replace). */
  targets: (env: Env) => Promise<{ kept: Target; removed: Target; added: Target }>;
  /** A new record (assistant's or twin) with the kept and removed targets linked. */
  record: (env: Env, n: number, kept: Target, removed: Target) => Promise<Rec>;
  /** The screen's gesture on the twin: the whole next set, or one toggle at a time. */
  screen: (env: Env, rec: Rec, step: Step) => Promise<void>;
  /** The module whose reader names the linked record; null when no such reader exists. */
  hiddenWithout: string | null;
  /** Other records the screen's gesture marks, read for the added target (add and replace). */
  alsoOn?: (rec: Rec, step: { added?: Target; removed?: Target }) => Array<{ table: string; id: string; name: string }>;
  /** No screen gesture: the assistant's trace is checked in the history only. */
  noScreen?: true;
};

const FULL = {
  applications: 'admin', infrastructure: 'admin', budget: 'admin', contracts: 'admin', portfolio_projects: 'admin',
  companies: 'admin', departments: 'admin', contacts: 'admin', suppliers: 'admin', locations: 'admin',
} as const;

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

let counter = 0;
const unique = (label: string) => `${label} ${++counter}`;

async function application(env: Env, n: number): Promise<Rec> {
  const ref = `APP-${n}`;
  const id = await insertId(env.runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, 'enabled')`, [env.tenantId, unique('Caisse'), ref]);
  const instanceId = await insertId(env.runner,
    `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [env.tenantId, id]);
  return { id, ref, instanceId };
}

async function asset(env: Env, cluster = false): Promise<Rec> {
  const name = unique(cluster ? 'cluster' : 'srv-source').replace(/ /g, '-');
  const id = await insertId(env.runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, is_cluster) VALUES ($1, $2, $3, 'prod', $4)`,
    [env.tenantId, name, cluster ? 'cluster' : 'server', cluster]);
  return { id, ref: name };
}

async function serverTarget(env: Env, label: string): Promise<Target> {
  const name = unique(label).replace(/ /g, '-');
  const id = await insertId(env.runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'server', 'prod')`, [env.tenantId, name]);
  return { id, name, input: name };
}

async function contactTarget(env: Env, first: string, role: string): Promise<Target> {
  const last = unique('Contact').replace(/ /g, '');
  const email = `${first}.${last}@example.test`.toLowerCase();
  const id = await insertId(env.runner, `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, $2, $3, $4)`, [env.tenantId, first, last, email]);
  return { id, name: `${first} ${last}`, input: { contact_ref: email, role }, extra: { role } };
}

async function line(env: Env, nature: 'opex' | 'capex', number: number): Promise<Target> {
  const name = unique(nature === 'opex' ? 'Licences' : 'Serveurs');
  const id = await insertId(env.runner,
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature) VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4)`,
    [env.tenantId, name, number, nature]);
  return { id, name, input: `BL-${number}`, extra: { nature } };
}

let companyId: string | null = null;
let supplierId: string | null = null;
async function contractTarget(env: Env): Promise<Target> {
  companyId ??= await insertId(env.runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Cidrerie', 'FR', 'Quimper')`, [env.tenantId]);
  supplierId ??= await insertId(env.runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fournisseur')`, [env.tenantId]);
  const name = unique('Contrat');
  const id = await insertId(env.runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2026-01-01')`,
    [env.tenantId, name, companyId, supplierId]);
  return { id, name, input: name };
}

let projectNumber = 0;
async function projectTarget(env: Env): Promise<Target> {
  const number = ++projectNumber;
  const name = unique('Projet');
  const id = await insertId(env.runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [env.tenantId, number, name]);
  return { id, name, input: `PRJ-${number}` };
}

/** The relations-tab context of the screen, as the controllers build it for a person who reads every module. */
function relationsCtx(env: Env) {
  const access = { budget_lines: true, contracts: true, projects: true, requests: true, tasks: true, technologies: true, processes: true, incidents: true, assets: true };
  return { manager: env.runner.manager, tenantId: env.tenantId, userId: env.writer, access, writes: { technologies: true, processes: true, incidents: true }, scopes: {}, incidentViewer: undefined };
}

/** The application's set relations the screen replaces whole (Overview, Audience). */
function setCase(
  name: string,
  relation: string,
  targets: Case['targets'],
  seed: (env: Env, rec: Rec, t: Target) => Promise<void>,
  replace: (env: Env, rec: Rec, list: Target[]) => Promise<void>,
  hiddenWithout: string | null,
): Case {
  return {
    name, entity: 'applications', relation, table: 'applications', targets, hiddenWithout,
    record: async (env, n, kept, removed) => {
      const rec = await application(env, n);
      await seed(env, rec, kept);
      await seed(env, rec, removed);
      return rec;
    },
    screen: (env, rec, step) => replace(env, rec, [...step.stays, ...(step.added ? [step.added] : [])]),
  };
}

/** The relations the Relations tab links one at a time (`setOwnedLink`, or the contracts' replacement). */
function toggleCase(
  name: string,
  entity: 'applications' | 'assets',
  relation: string,
  targets: Case['targets'],
  seed: (env: Env, rec: Rec, t: Target) => Promise<void>,
  toggle: (env: Env, rec: Rec, t: Target, add: boolean) => Promise<void>,
  hiddenWithout: string | null,
  alsoOn?: Case['alsoOn'],
): Case {
  return {
    name, entity, relation, table: entity, targets, hiddenWithout, alsoOn,
    record: async (env, n, kept, removed) => {
      const rec = entity === 'applications' ? await application(env, n) : await asset(env);
      await seed(env, rec, kept);
      await seed(env, rec, removed);
      return rec;
    },
    screen: async (env, rec, step) => {
      if (step.removed) await toggle(env, rec, step.removed, false);
      if (step.added) await toggle(env, rec, step.added, true);
    },
  };
}

const insertLink = (table: string, source: string, target: string) => async (env: Env, rec: Rec, t: Target) => {
  await env.runner.query(`INSERT INTO ${table} (tenant_id, ${source}, ${target}) VALUES ($1, $2, $3)`, [env.tenantId, rec.id, t.id]);
};

const CASES: Case[] = [
  setCase('applications.owners', 'owners',
    async (env) => {
      const user = async (first: string, last: string) => {
        const email = `${first}.${last}.${counter++}@example.test`.toLowerCase();
        const id = await insertId(env.runner, `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, $4, $5, 'enabled')`, [env.tenantId, email, first, last, env.roleId]);
        return { id, name: `${first} ${last}`, input: { owner_type: 'it', user_ref: email } };
      };
      return { kept: await user('Erwan', 'Tanguy'), removed: await user('Yann', 'Le Goff'), added: await user('Maëlle', 'Kerbrat') };
    },
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'it')`, [env.tenantId, rec.id, t.id]);
    },
    (env, rec, list) => env.services.owners.bulkReplaceOwners(rec.id, list.map((t) => ({ user_id: t.id, owner_type: 'it' })), env.writer, { manager: env.runner.manager }),
    null),
  setCase('applications.companies', 'companies',
    async (env) => {
      const company = async () => {
        const name = unique('Société');
        return { id: await insertId(env.runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Brest')`, [env.tenantId, name]), name, input: name };
      };
      return { kept: await company(), removed: await company(), added: await company() };
    },
    insertLink('application_companies', 'application_id', 'company_id'),
    (env, rec, list) => env.services.owners.bulkReplaceCompanies(rec.id, list.map((t) => t.id), env.writer, { manager: env.runner.manager }),
    'companies'),
  setCase('applications.departments', 'departments',
    async (env) => {
      const company = await insertId(env.runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Brest')`, [env.tenantId, unique('Maison')]);
      const department = async () => {
        const name = unique('Service');
        return { id: await insertId(env.runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3)`, [env.tenantId, company, name]), name, input: name };
      };
      return { kept: await department(), removed: await department(), added: await department() };
    },
    insertLink('application_departments', 'application_id', 'department_id'),
    (env, rec, list) => env.services.owners.bulkReplaceDepartments(rec.id, list.map((t) => t.id), env.writer, { manager: env.runner.manager }),
    'departments'),
  setCase('applications.support_contacts', 'support_contacts',
    async (env) => ({ kept: await contactTarget(env, 'Anne', 'Support'), removed: await contactTarget(env, 'Brieuc', 'Support'), added: await contactTarget(env, 'Gwen', 'Vendor') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO application_support_contacts (tenant_id, application_id, contact_id, role) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.id, t.extra?.role]);
    },
    (env, rec, list) => env.services.owners.bulkReplaceSupportContacts(rec.id, list.map((t) => ({ contact_id: t.id, role: t.extra?.role })), env.writer, { manager: env.runner.manager }),
    'contacts'),
  toggleCase('applications.budget_lines', 'applications', 'budget_lines',
    async (env) => ({ kept: await line(env, 'opex', 901), removed: await line(env, 'opex', 902), added: await line(env, 'capex', 903) }),
    insertLink('application_spend_items', 'application_id', 'spend_item_id'),
    (env, rec, t, add) => env.services.appRelations.setLink('budget_lines', rec.id, t.id, add, relationsCtx(env)),
    'budget'),
  toggleCase('applications.contracts', 'applications', 'contracts',
    async (env) => ({ kept: await contractTarget(env), removed: await contractTarget(env), added: await contractTarget(env) }),
    insertLink('application_contracts', 'application_id', 'contract_id'),
    (env, rec, t, add) => env.services.appRelations.setLink('contracts', rec.id, t.id, add, relationsCtx(env)),
    'contracts'),
  toggleCase('applications.projects', 'applications', 'projects',
    async (env) => ({ kept: await projectTarget(env), removed: await projectTarget(env), added: await projectTarget(env) }),
    insertLink('application_projects', 'application_id', 'project_id'),
    (env, rec, t, add) => env.services.appRelations.setLink('projects', rec.id, t.id, add, relationsCtx(env)),
    'portfolio_projects'),
  toggleCase('applications.links', 'applications', 'links',
    async () => {
      const link = (label: string) => {
        const name = unique(label);
        const url = `https://example.test/${name.replace(/ /g, '-').toLowerCase()}`;
        return { id: url, name, input: { url, description: name }, extra: { url } };
      };
      return { kept: link('Wiki'), removed: link('Runbook'), added: link('Supervision') };
    },
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO application_links (tenant_id, application_id, url, description) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.extra?.url, t.name]);
    },
    async (env, rec, t, add) => {
      if (add) {
        await env.services.appCrud.createLink(rec.id, { url: t.extra?.url, description: t.name }, env.writer, { manager: env.runner.manager });
        return;
      }
      const [row] = await env.runner.query(`SELECT id FROM application_links WHERE tenant_id = $1 AND application_id = $2 AND url = $3`, [env.tenantId, rec.id, t.extra?.url]);
      await env.services.appCrud.deleteLink(rec.id, row.id, env.writer, { manager: env.runner.manager });
    },
    null),
  toggleCase('applications.asset_assignments', 'applications', 'asset_assignments',
    async (env) => {
      const server = async (label: string) => {
        const t = await serverTarget(env, label);
        return { ...t, input: { environment: 'prod', asset_ref: t.name, role: 'web' } };
      };
      return { kept: await server('srv-kept'), removed: await server('srv-gone'), added: await server('srv-new') };
    },
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'web')`, [env.tenantId, rec.instanceId, t.id]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager, tenantId: env.tenantId };
      if (add) {
        await env.services.assignments.create(rec.instanceId, { asset_id: t.id, role: 'web' }, env.writer, opts);
        return;
      }
      const [row] = await env.runner.query(`SELECT id FROM app_asset_assignments WHERE tenant_id = $1 AND app_instance_id = $2 AND asset_id = $3`, [env.tenantId, rec.instanceId, t.id]);
      await env.services.assignments.delete(rec.instanceId, row.id, env.writer, opts);
    },
    'infrastructure'),

  toggleCase('assets.budget_lines', 'assets', 'budget_lines',
    async (env) => ({ kept: await line(env, 'opex', 911), removed: await line(env, 'opex', 912), added: await line(env, 'capex', 913) }),
    insertLink('asset_spend_items', 'asset_id', 'spend_item_id'),
    (env, rec, t, add) => env.services.assetTab.setLink('budget_lines', rec.id, t.id, add, relationsCtx(env)),
    'budget',
    // The Relations tab names the line it added or removed: its own history shows the asset.
    (rec, step) => [step.added, step.removed].filter((t): t is Target => !!t).map((t) => ({ table: 'spend_items', id: t.id, name: rec.ref }))),
  toggleCase('assets.contracts', 'assets', 'contracts',
    async (env) => ({ kept: await contractTarget(env), removed: await contractTarget(env), added: await contractTarget(env) }),
    insertLink('asset_contracts', 'asset_id', 'contract_id'),
    (env, rec, t, add) => env.services.assetTab.setLink('contracts', rec.id, t.id, add, relationsCtx(env)),
    'contracts'),
  toggleCase('assets.projects', 'assets', 'projects',
    async (env) => ({ kept: await projectTarget(env), removed: await projectTarget(env), added: await projectTarget(env) }),
    insertLink('asset_projects', 'asset_id', 'project_id'),
    (env, rec, t, add) => env.services.assetTab.setLink('projects', rec.id, t.id, add, relationsCtx(env)),
    'portfolio_projects'),
  {
    name: 'assets.relations', entity: 'assets', relation: 'relations', table: 'assets', hiddenWithout: null,
    targets: async (env) => {
      const related = async (label: string) => {
        const t = await serverTarget(env, label);
        return { ...t, input: { related_asset_ref: t.name, relation_type: 'depends_on' } };
      };
      return { kept: await related('db-kept'), removed: await related('db-gone'), added: await related('db-new') };
    },
    record: async (env, _n, kept, removed) => {
      const rec = await asset(env);
      for (const t of [kept, removed]) {
        await env.runner.query(`INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'depends_on')`, [env.tenantId, rec.id, t.id]);
      }
      return rec;
    },
    screen: (env, rec, step) => env.services.assetRelations.bulkReplaceRelations(
      rec.id,
      [...step.stays, ...(step.added ? [step.added] : [])].map((t) => ({ related_asset_id: t.id, relation_type: 'depends_on' })),
      env.tenantId,
      env.writer,
      { manager: env.runner.manager, tenantId: env.tenantId },
    ),
  },
  {
    name: 'assets.cluster_members', entity: 'assets', relation: 'cluster_members', table: 'assets', hiddenWithout: null,
    targets: async (env) => ({ kept: await serverTarget(env, 'node-kept'), removed: await serverTarget(env, 'node-gone'), added: await serverTarget(env, 'node-new') }),
    record: async (env, _n, kept, removed) => {
      const rec = await asset(env, true);
      for (const t of [kept, removed]) {
        await env.runner.query(`INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`, [env.tenantId, rec.id, t.id]);
      }
      return rec;
    },
    screen: (env, rec, step) => env.services.assetCrud.replaceClusterMembers(
      rec.id, [...step.stays, ...(step.added ? [step.added] : [])].map((t) => t.id), env.tenantId, env.writer, { manager: env.runner.manager, tenantId: env.tenantId },
    ),
  },
  {
    // No screen writes an asset's support contacts: the assistant's trace is read in the history only.
    name: 'assets.support_contacts', entity: 'assets', relation: 'support_contacts', table: 'assets', hiddenWithout: 'contacts', noScreen: true,
    targets: async (env) => ({ kept: await contactTarget(env, 'Loïc', 'Support'), removed: await contactTarget(env, 'Nolwenn', 'Support'), added: await contactTarget(env, 'Tanguy', 'Vendor') }),
    record: async (env, _n, kept, removed) => {
      const rec = await asset(env);
      for (const t of [kept, removed]) {
        await env.runner.query(`INSERT INTO asset_support_contacts (tenant_id, asset_id, contact_id, role) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.id, t.extra?.role]);
      }
      return rec;
    },
    screen: async () => undefined,
  },
  toggleCase('assets.links', 'assets', 'links',
    async () => {
      const link = (label: string) => {
        const name = unique(label);
        const url = `https://example.test/${name.replace(/ /g, '-').toLowerCase()}`;
        return { id: url, name, input: { url, description: name }, extra: { url } };
      };
      return { kept: link('Console'), removed: link('Fiche'), added: link('Sonde') };
    },
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO asset_links (tenant_id, asset_id, url, description) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.extra?.url, t.name]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager, tenantId: env.tenantId };
      if (add) {
        await env.services.assetAttachments.createLink(rec.id, { url: t.extra?.url, description: t.name }, env.writer, opts);
        return;
      }
      const [row] = await env.runner.query(`SELECT id FROM asset_links WHERE tenant_id = $1 AND asset_id = $2 AND url = $3`, [env.tenantId, rec.id, t.extra?.url]);
      await env.services.assetAttachments.deleteLink(rec.id, row.id, env.writer, opts);
    },
    null),
];

type AuditRow = {
  id: string; table_name: string; record_id: string | null; action: string; before_json: unknown; after_json: unknown;
  user_id: string | null; source: string | null; source_ref: string | null; parent_table: string | null; parent_id: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

/** A row as both sides compare it: the record itself `SELF`, other generated ids `ID`, dates `DATE`, sets unordered. */
function neutral(value: unknown, self: string, known: Set<string>): unknown {
  if (typeof value === 'string') {
    if (value.toLowerCase() === self.toLowerCase()) return 'SELF';
    if (UUID.test(value)) return known.has(value.toLowerCase()) ? value.toLowerCase() : 'ID';
    if (DATE.test(value)) return 'DATE';
    return value;
  }
  if (Array.isArray(value)) {
    // The sets the screens write carry no order: compared as sets.
    return value.map((entry) => neutral(entry, self, known)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      // The tenancy column: an entity the screen saves without it does not read it back; every
      // allow-list hides it.
      .filter(([key, entry]) => entry !== undefined && key !== 'tenant_id')
      .map(([key, entry]) => [key, neutral(entry, self, known)]));
  }
  return value;
}

function shape(rows: AuditRow[], self: string, known: Set<string>) {
  return rows.map((row) => ({
    table: row.table_name,
    action: row.action,
    record_id: neutral(row.record_id, self, known),
    before: neutral(row.before_json, self, known),
    after: neutral(row.after_json, self, known),
    parent_table: row.parent_table,
    parent_id: neutral(row.parent_id, self, known),
  }));
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-relation-history.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { RecordHistoryService } = require('../../audit/record-history.service');
  const { ApplicationsOwnersService } = require('../../applications/services/applications-owners.service');
  const { ApplicationsRelationsService } = require('../../applications/services/applications-relations.service');
  const { ApplicationsCrudService } = require('../../applications/services/applications-crud.service');
  const { AppAssetAssignmentsService } = require('../../app-asset-assignments/app-asset-assignments.service');
  const { AssetRelationsTabService } = require('../../assets/asset-relations-tab.service');
  const { AssetsRelationsService } = require('../../assets/services/assets-relations.service');
  const { AssetsCrudService } = require('../../assets/services/assets-crud.service');
  const { AssetsAttachmentsService } = require('../../assets/services/assets-attachments.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const previews = app.get(AiMutationPreviewService);
  const dataSource = app.get(DataSource);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const failures: string[] = [];
  let passed = 0;
  try {
    const tenantId = randomUUID();
    const slug = `ai-relation-history-${tenantId.slice(0, 8)}`;
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Writer', 'Writer')`, [tenantId]);
    for (const [resource, level] of Object.entries({ ...FULL, ai_chat: 'member' })) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
    }
    const writer = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Claude', 'Writer', $3, 'enabled')`,
      [tenantId, `writer-${tenantId.slice(0, 8)}@example.test`, roleId]);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, writer, roleId]);

    const env: Env = {
      runner, tenantId, writer, roleId, app,
      services: {
        owners: app.get(ApplicationsOwnersService),
        appRelations: app.get(ApplicationsRelationsService),
        appCrud: app.get(ApplicationsCrudService),
        assignments: app.get(AppAssetAssignmentsService),
        assetTab: app.get(AssetRelationsTabService),
        assetRelations: app.get(AssetsRelationsService),
        assetCrud: app.get(AssetsCrudService),
        assetAttachments: app.get(AssetsAttachmentsService),
      },
    };
    const ctx = { tenantId, userId: writer, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager, conversationId: null };
    const history = (table: string, id: string, permissions: Record<string, string>) => new RecordHistoryService().list(
      { tenantId, userId: writer, isAdmin: false, permissions, manager: runner.manager }, table, id, { limit: 100 },
    );
    const auditSince = async (marker: string): Promise<AuditRow[]> => runner.query(
      `SELECT id, table_name, record_id::text, action, before_json, after_json, user_id::text, source, source_ref,
              parent_table, parent_id::text
         FROM audit_log WHERE tenant_id = $1 AND created_at > $2::timestamptz ORDER BY created_at, id`,
      [tenantId, marker],
    );
    const now = async (): Promise<string> => (await runner.query(`SELECT clock_timestamp()::text AS t`))[0].t;

    let n = 100;
    for (const c of CASES) {
      const targets = await c.targets(env);
      const known = new Set([targets.kept, targets.removed, targets.added].map((t) => t.id.toLowerCase()).concat(writer));
      for (const gesture of GESTURES) {
        const cell = `${c.name} ${gesture}`;
        try {
          const step: Step = {
            kept: targets.kept,
            stays: gesture === 'add' ? [targets.kept, targets.removed] : [targets.kept],
            ...(gesture !== 'add' ? { removed: targets.removed } : {}),
            ...(gesture !== 'remove' ? { added: targets.added } : {}),
          };
          // The assistant, up to the approval of its card.
          const mine = await c.record(env, ++n, targets.kept, targets.removed);
          const kadMarker = await now();
          const preview = await previews.createPreview(ctx, 'update_entity_relations', {
            entity_type: c.entity, ref: mine.ref, relation: c.relation,
            ...(step.added ? { add: [step.added.input] } : {}),
            ...(step.removed ? { remove: [step.removed.input] } : {}),
          });
          const executed = await previews.executePreview(ctx, preview.preview_id);
          assert.equal(executed.status, 'executed', `${cell}: the card runs (${executed.error_message ?? executed.summary ?? ''})`);
          const kadRows = await auditSince(kadMarker);
          assert.ok(kadRows.length > 0, `${cell}: the assistant writes audit rows`);
          for (const row of kadRows) {
            assert.equal(row.source, 'ai_chat', `${cell}: ${row.table_name} by the assistant`);
            assert.equal(row.source_ref, preview.preview_id, `${cell}: ${row.table_name} names the card`);
          }

          // The screen, on the twin.
          const twin = c.noScreen ? null : await c.record(env, ++n, targets.kept, targets.removed);
          if (twin) {
            const screenMarker = await now();
            await c.screen(env, twin, step);
            const screenRows = await auditSince(screenMarker);
            assert.deepEqual(shape(kadRows, mine.id, known), shape(screenRows, twin.id, known), `${cell}: the assistant's audit rows are the screen's`);
          }

          // The History tab, said by the assistant, names the linked record.
          const named = step.added ?? step.removed!;
          const page = await history(c.table, mine.id, FULL);
          const byKad = page.items.filter((item: any) => item.actor.kind === 'assistant');
          assert.ok(byKad.length > 0, `${cell}: the history holds an entry by the assistant`);
          assert.ok(JSON.stringify(byKad).includes(named.name), `${cell}: the entry names ${named.name}`);
          if (step.added && step.removed) {
            assert.ok(JSON.stringify(byKad).includes(step.removed.name), `${cell}: the entry names the removed ${step.removed.name}`);
          }
          for (const other of c.alsoOn?.(mine, step) ?? []) {
            const otherPage = await history(other.table, other.id, FULL);
            const otherByKad = otherPage.items.filter((item: any) => item.actor.kind === 'assistant');
            assert.ok(JSON.stringify(otherByKad).includes(other.name), `${cell}: the ${other.table} history names ${other.name}`);
          }
          // A reader of the record who may not read the linked record's module: not named.
          if (c.hiddenWithout) {
            const { [c.hiddenWithout]: _dropped, ...partial } = FULL as Record<string, string>;
            const hiddenPage = await history(c.table, mine.id, partial);
            const hiddenByKad = hiddenPage.items.filter((item: any) => item.actor.kind === 'assistant');
            assert.ok(hiddenByKad.length > 0, `${cell}: the entry stays for a reader without ${c.hiddenWithout}`);
            assert.ok(!JSON.stringify(hiddenByKad).includes(named.name), `${cell}: ${named.name} is not named without ${c.hiddenWithout}`);
            assert.ok(JSON.stringify(hiddenByKad).includes('"hidden":true'), `${cell}: the linked record reads as withheld`);
          }
          // The undo of an addition leaves the trace of the screen's removal of the same link.
          if (gesture === 'add') {
            const undoMarker = await now();
            const undo = await previews.createReversePreview(ctx, preview.preview_id);
            const undone = await previews.executePreview(ctx, undo.preview_id);
            assert.equal(undone.status, 'executed', `${cell}: the undo runs (${undone.error_message ?? ''})`);
            const undoRows = await auditSince(undoMarker);
            assert.ok(undoRows.length > 0 && undoRows.every((row) => row.source === 'ai_chat' && row.source_ref === undo.preview_id), `${cell}: the undo is audited by its card`);
            if (twin) {
              const screenMarker = await now();
              await c.screen(env, twin, { kept: targets.kept, stays: step.stays, removed: targets.added });
              const screenRows = await auditSince(screenMarker);
              assert.deepEqual(shape(undoRows, mine.id, known), shape(screenRows, twin.id, known), `${cell}: the undo's audit rows are the screen's removal`);
            }
          }
          passed += 1;
          console.log(`  ${cell}: OK`);
        } catch (error: any) {
          failures.push(`${cell}: ${String(error?.message ?? error).split('\n').slice(0, 40).join('\n')}`);
          console.log(`  ${cell}: FAILED`);
        }
      }
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} cell(s) failed, ${passed} passed:\n\n${failures.join('\n\n')}`);
    process.exit(1);
  }
  console.log(`ai-relation-history.integration.spec: ok (${passed} cells)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
