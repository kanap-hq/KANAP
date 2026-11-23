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
// The grid is a table: `CASES` below, one entry per relation of the writer (37). One more cell
// writes as a person in limited data access: the lines they cannot read stay linked and are counted.
// Needs the role kanap_data_limited (CI installs it) for that cell.

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

/** One record of a gesture: the assistant's, or its twin for the screen. `name`: what another record's history shows of it. */
type Rec = { id: string; ref: string; name?: string; instanceId?: string };

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

type Entity = 'applications' | 'assets' | 'suppliers' | 'contracts' | 'budget_lines' | 'projects' | 'requests' | 'locations';

type Case = {
  name: string;
  entity: Entity;
  relation: string;
  /** The History route key of the record. */
  table: string;
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
  portfolio_requests: 'admin', business_processes: 'admin', companies: 'admin', departments: 'admin', contacts: 'admin',
  suppliers: 'admin', locations: 'admin', users: 'admin',
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

async function supplier(env: Env): Promise<Rec> {
  const name = unique('Fournisseur');
  return { id: await insertId(env.runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [env.tenantId, name]), ref: name, name };
}

async function contractRecord(env: Env): Promise<Rec> {
  const t = await contractTarget(env);
  return { id: t.id, ref: t.name, name: t.name };
}

let lineNumber = 2000;
async function lineRecord(env: Env, nature: 'opex' | 'capex'): Promise<Rec> {
  const t = await line(env, nature, ++lineNumber);
  return { id: t.id, ref: String(t.input), name: t.name };
}

async function projectRecord(env: Env): Promise<Rec> {
  const t = await projectTarget(env);
  return { id: t.id, ref: String(t.input), name: t.name };
}

let requestNumber = 0;
async function requestRecord(env: Env): Promise<Rec> {
  const number = ++requestNumber;
  const name = unique('Demande');
  const id = await insertId(env.runner, `INSERT INTO portfolio_requests (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [env.tenantId, number, name]);
  return { id, ref: `REQ-${number}`, name };
}

async function locationRecord(env: Env): Promise<Rec> {
  const name = unique('Site');
  const id = await insertId(env.runner, `INSERT INTO locations (tenant_id, name, hosting_type) VALUES ($1, $2, 'on_premise')`, [env.tenantId, name]);
  return { id, ref: name, name };
}

const RECORDS: Record<Entity, (env: Env, n: number) => Promise<Rec>> = {
  applications: application,
  assets: (env) => asset(env),
  suppliers: supplier,
  contracts: contractRecord,
  budget_lines: (env) => lineRecord(env, 'opex'),
  projects: projectRecord,
  requests: requestRecord,
  locations: locationRecord,
};

/** The History route key of each record. */
const HISTORY_TABLE: Record<Entity, string> = {
  applications: 'applications',
  assets: 'assets',
  suppliers: 'suppliers',
  contracts: 'contracts',
  budget_lines: 'spend_items',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  locations: 'locations',
};

async function applicationTarget(env: Env): Promise<Target> {
  const rec = await application(env, 500 + counter);
  const [row] = await env.runner.query(`SELECT name FROM applications WHERE id = $1`, [rec.id]);
  return { id: rec.id, name: row.name, input: rec.ref };
}

async function processTarget(env: Env): Promise<Target> {
  const name = unique('Processus');
  return { id: await insertId(env.runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, $2)`, [env.tenantId, name]), name, input: name };
}

async function userTarget(env: Env, first: string, role: string): Promise<Target> {
  const last = unique('Agent').replace(/ /g, '');
  const email = `${first}.${last}@example.test`.toLowerCase();
  const id = await insertId(env.runner, `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, $4, $5, 'enabled')`, [env.tenantId, email, first, last, env.roleId]);
  return { id, name: `${first} ${last}`, input: { user_ref: email, role }, extra: { role } };
}

function webLink(label: string): Target {
  const name = unique(label);
  const url = `https://example.test/${name.replace(/ /g, '-').toLowerCase()}`;
  return { id: url, name, input: { url, description: name }, extra: { url } };
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
  entity: Entity,
  relation: string,
  targets: Case['targets'],
  seed: (env: Env, rec: Rec, t: Target) => Promise<void>,
  toggle: (env: Env, rec: Rec, t: Target, add: boolean) => Promise<void>,
  hiddenWithout: string | null,
  alsoOn?: Case['alsoOn'],
  make: (env: Env, n: number) => Promise<Rec> = RECORDS[entity],
): Case {
  return {
    name, entity, relation, table: HISTORY_TABLE[entity], targets, hiddenWithout, alsoOn,
    record: async (env, n, kept, removed) => {
      const rec = await make(env, n);
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

/** The id of the link row of `ownerId` whose `column` is `value` (table and columns from the cases only). */
async function rowId(env: Env, table: string, ownerColumn: string, ownerId: string, column: string, value: unknown): Promise<string> {
  const [row] = await env.runner.query(`SELECT id FROM ${table} WHERE tenant_id = $1 AND ${ownerColumn} = $2 AND ${column} = $3`, [env.tenantId, ownerId, value]);
  return row.id;
}

/** The targets a gesture adds or removes. */
const changed = (step: { added?: Target; removed?: Target }): Target[] => [step.added, step.removed].filter((t): t is Target => !!t);

/** The owner a portfolio Relations tab loads (`setProjectLink`, `setRequestLink`). */
const owner = (env: Env, rec: Rec) => async () => ({ id: rec.id, tenantId: env.tenantId });

/** The budget line's Relations tab context (`setBudgetLineRelation`). */
function lineCtx(env: Env) {
  return { manager: env.runner.manager, userId: env.writer, access: { projects: true, applications: true, technologies: true, contracts: true, assets: true } };
}

function projectCtx(env: Env) {
  return { manager: env.runner.manager, tenantId: env.tenantId, userId: env.writer, access: { budget_lines: true, applications: true, assets: true, technologies: true, source_requests: true } };
}

function requestCtx(env: Env) {
  return {
    manager: env.runner.manager, tenantId: env.tenantId, userId: env.writer,
    access: { budget_lines: true, applications: true, assets: true, processes: true, resulting_projects: true },
    writes: { processes: true },
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

  // Pass 2: suppliers, contracts, budget lines, projects, requests and sites.
  toggleCase('suppliers.contacts', 'suppliers', 'contacts',
    async (env) => {
      // The contact added already has a supplier: attaching it does not change the contact, so the
      // assistant's record and the screen's twin see it in the same state.
      const added = await contactTarget(env, 'Tugdual', 'support');
      await env.runner.query(`UPDATE contacts SET supplier_id = $2 WHERE id = $1`, [added.id, (await supplier(env)).id]);
      return { kept: await contactTarget(env, 'Ronan', 'commercial'), removed: await contactTarget(env, 'Soazig', 'technical'), added };
    },
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.id, t.extra?.role]);
    },
    async (env, rec, t, add) => {
      const ctx = { manager: env.runner.manager, tenantId: env.tenantId, userId: env.writer };
      if (add) {
        await env.services.supplierContacts.attach(rec.id, { contactId: t.id, role: t.extra?.role }, ctx);
        return;
      }
      await env.services.supplierContacts.detach(rec.id, await rowId(env, 'supplier_contacts', 'supplier_id', rec.id, 'contact_id', t.id), ctx);
    },
    'contacts',
    // The link belongs to the contact's history too.
    (rec, step) => changed(step).map((t) => ({ table: 'contacts', id: t.id, name: rec.name! }))),
  toggleCase('contracts.contacts', 'contracts', 'contacts',
    async (env) => ({ kept: await contactTarget(env, 'Annaig', 'commercial'), removed: await contactTarget(env, 'Brendan', 'technical'), added: await contactTarget(env, 'Corentin', 'support') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO contract_contacts (tenant_id, contract_id, contact_id, role, origin) VALUES ($1, $2, $3, $4, 'manual')`, [env.tenantId, rec.id, t.id, t.extra?.role]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager, tenantId: env.tenantId };
      if (add) {
        await env.services.contractContacts.attachManual(rec.id, { contactId: t.id, role: t.extra?.role }, env.writer, opts);
        return;
      }
      await env.services.contractContacts.detach(rec.id, await rowId(env, 'contract_contacts', 'contract_id', rec.id, 'contact_id', t.id), env.writer, opts);
    },
    'contacts',
    (rec, step) => changed(step).map((t) => ({ table: 'contacts', id: t.id, name: rec.name! }))),
  toggleCase('contracts.links', 'contracts', 'links',
    async () => ({ kept: webLink('Portail'), removed: webLink('Annexe'), added: webLink('Avenant') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO contract_links (tenant_id, contract_id, url, description) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.extra?.url, t.name]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager };
      if (add) {
        await env.services.contracts.createUrl(rec.id, { url: t.extra?.url, description: t.name }, env.writer, opts);
        return;
      }
      await env.services.contracts.deleteUrl(rec.id, await rowId(env, 'contract_links', 'contract_id', rec.id, 'url', t.extra?.url), env.writer, opts);
    },
    null),
  {
    // The contract's Budget tab replaces the whole set (`replaceContractRelations`).
    name: 'contracts.budget_lines', entity: 'contracts', relation: 'budget_lines', table: 'contracts', hiddenWithout: 'budget',
    targets: async (env) => ({ kept: await line(env, 'opex', ++lineNumber), removed: await line(env, 'opex', ++lineNumber), added: await line(env, 'capex', ++lineNumber) }),
    record: async (env, _n, kept, removed) => {
      const rec = await contractRecord(env);
      for (const t of [kept, removed]) await insertLink('contract_spend_items', 'contract_id', 'spend_item_id')(env, rec, t);
      return rec;
    },
    screen: (env, rec, step) => env.services.contracts.replaceRelations(
      rec.id, 'budget_lines', [...step.stays, ...(step.added ? [step.added] : [])].map((t) => t.id), env.writer, { manager: env.runner.manager },
    ),
    // The tab names the line when exactly one changed: the line's history shows the contract.
    alsoOn: (rec, step) => (step.added && step.removed ? [] : changed(step)).map((t) => ({ table: 'spend_items', id: t.id, name: rec.name! })),
  },
  toggleCase('budget_lines.applications', 'budget_lines', 'applications',
    async (env) => ({ kept: await applicationTarget(env), removed: await applicationTarget(env), added: await applicationTarget(env) }),
    insertLink('application_spend_items', 'spend_item_id', 'application_id'),
    (env, rec, t, add) => env.services.budgetLines.setRelation('applications', rec.id, t.id, add, lineCtx(env)),
    'applications',
    undefined,
    // A CAPEX line: the rows keep the CAPEX labels.
    (env) => lineRecord(env, 'capex')),
  toggleCase('budget_lines.projects', 'budget_lines', 'projects',
    async (env) => ({ kept: await projectTarget(env), removed: await projectTarget(env), added: await projectTarget(env) }),
    insertLink('portfolio_project_opex', 'opex_id', 'project_id'),
    (env, rec, t, add) => env.services.budgetLines.setRelation('projects', rec.id, t.id, add, lineCtx(env)),
    'portfolio_projects'),
  toggleCase('budget_lines.contracts', 'budget_lines', 'contracts',
    async (env) => ({ kept: await contractTarget(env), removed: await contractTarget(env), added: await contractTarget(env) }),
    insertLink('contract_spend_items', 'spend_item_id', 'contract_id'),
    (env, rec, t, add) => env.services.budgetLines.setRelation('contracts', rec.id, t.id, add, lineCtx(env)),
    'contracts'),
  toggleCase('budget_lines.contacts', 'budget_lines', 'contacts',
    async (env) => ({ kept: await contactTarget(env, 'Denez', 'commercial'), removed: await contactTarget(env, 'Enora', 'technical'), added: await contactTarget(env, 'Fanch', 'support') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role, origin) VALUES ($1, $2, $3, $4, 'manual')`, [env.tenantId, rec.id, t.id, t.extra?.role]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager, tenantId: env.tenantId };
      if (add) {
        await env.services.lineContacts.attachManual(rec.id, { contactId: t.id, role: t.extra?.role }, env.writer, opts);
        return;
      }
      await env.services.lineContacts.detach(rec.id, await rowId(env, 'spend_item_contacts', 'spend_item_id', rec.id, 'contact_id', t.id), env.writer, opts);
    },
    'contacts',
    (rec, step) => changed(step).map((t) => ({ table: 'contacts', id: t.id, name: rec.name! }))),
  toggleCase('budget_lines.links', 'budget_lines', 'links',
    async () => ({ kept: webLink('Devis'), removed: webLink('Facture'), added: webLink('Bon') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO spend_links (tenant_id, spend_item_id, url, description) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.extra?.url, t.name]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager };
      if (add) {
        await env.services.capexItems.createLink(rec.id, { url: t.extra?.url, description: t.name }, env.writer, opts);
        return;
      }
      await env.services.capexItems.deleteLink(rec.id, await rowId(env, 'spend_links', 'spend_item_id', rec.id, 'url', t.extra?.url), env.writer, opts);
    },
    null,
    undefined,
    // A CAPEX line: the links read `capex_links`, the line named `capex_item_id`, as its route writes them.
    (env) => lineRecord(env, 'capex')),
  toggleCase('projects.applications', 'projects', 'applications',
    async (env) => ({ kept: await applicationTarget(env), removed: await applicationTarget(env), added: await applicationTarget(env) }),
    insertLink('application_projects', 'project_id', 'application_id'),
    (env, rec, t, add) => env.services.portfolioRelations.setProjectLink('applications', t.id, add, projectCtx(env), owner(env, rec)),
    'applications',
    // The application added or removed is the row's parent: its history shows the project.
    (rec, step) => changed(step).map((t) => ({ table: 'applications', id: t.id, name: rec.name! }))),
  toggleCase('projects.assets', 'projects', 'assets',
    async (env) => ({ kept: await serverTarget(env, 'srv-p-kept'), removed: await serverTarget(env, 'srv-p-gone'), added: await serverTarget(env, 'srv-p-new') }),
    insertLink('asset_projects', 'project_id', 'asset_id'),
    (env, rec, t, add) => env.services.portfolioRelations.setProjectLink('assets', t.id, add, projectCtx(env), owner(env, rec)),
    'infrastructure',
    (rec, step) => changed(step).map((t) => ({ table: 'assets', id: t.id, name: rec.name! }))),
  toggleCase('projects.budget_lines', 'projects', 'budget_lines',
    async (env) => ({ kept: await line(env, 'opex', ++lineNumber), removed: await line(env, 'opex', ++lineNumber), added: await line(env, 'capex', ++lineNumber) }),
    insertLink('portfolio_project_opex', 'project_id', 'opex_id'),
    (env, rec, t, add) => env.services.portfolioRelations.setProjectLink('budget_lines', t.id, add, projectCtx(env), owner(env, rec)),
    'budget',
    (rec, step) => changed(step).map((t) => ({ table: 'spend_items', id: t.id, name: rec.name! }))),
  toggleCase('requests.applications', 'requests', 'applications',
    async (env) => ({ kept: await applicationTarget(env), removed: await applicationTarget(env), added: await applicationTarget(env) }),
    insertLink('portfolio_request_applications', 'request_id', 'application_id'),
    (env, rec, t, add) => env.services.portfolioRelations.setRequestLink('applications', t.id, add, requestCtx(env), owner(env, rec)),
    'applications'),
  toggleCase('requests.assets', 'requests', 'assets',
    async (env) => ({ kept: await serverTarget(env, 'srv-r-kept'), removed: await serverTarget(env, 'srv-r-gone'), added: await serverTarget(env, 'srv-r-new') }),
    insertLink('portfolio_request_assets', 'request_id', 'asset_id'),
    (env, rec, t, add) => env.services.portfolioRelations.setRequestLink('assets', t.id, add, requestCtx(env), owner(env, rec)),
    'infrastructure'),
  toggleCase('requests.budget_lines', 'requests', 'budget_lines',
    async (env) => ({ kept: await line(env, 'opex', ++lineNumber), removed: await line(env, 'opex', ++lineNumber), added: await line(env, 'capex', ++lineNumber) }),
    insertLink('portfolio_request_opex', 'request_id', 'opex_id'),
    (env, rec, t, add) => env.services.portfolioRelations.setRequestLink('budget_lines', t.id, add, requestCtx(env), owner(env, rec)),
    'budget',
    (rec, step) => changed(step).map((t) => ({ table: 'spend_items', id: t.id, name: rec.name! }))),
  toggleCase('requests.business_processes', 'requests', 'business_processes',
    async (env) => ({ kept: await processTarget(env), removed: await processTarget(env), added: await processTarget(env) }),
    insertLink('portfolio_request_business_processes', 'request_id', 'business_process_id'),
    (env, rec, t, add) => env.services.portfolioRelations.setRequestLink('processes', t.id, add, requestCtx(env), owner(env, rec)),
    'business_processes'),
  toggleCase('locations.internal_contacts', 'locations', 'internal_contacts',
    async (env) => ({ kept: await userTarget(env, 'Gaël', 'Gardien'), removed: await userTarget(env, 'Hervé', 'Astreinte'), added: await userTarget(env, 'Iwan', 'Responsable') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO location_user_contacts (tenant_id, location_id, user_id, role) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.id, t.extra?.role]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager };
      if (add) {
        await env.services.locations.addInternalContact(rec.id, { user_id: t.id, role: t.extra?.role }, env.tenantId, env.writer, opts);
        return;
      }
      await env.services.locations.removeInternalContact(rec.id, await rowId(env, 'location_user_contacts', 'location_id', rec.id, 'user_id', t.id), env.writer, opts);
    },
    null),
  toggleCase('locations.external_contacts', 'locations', 'external_contacts',
    async (env) => ({ kept: await contactTarget(env, 'Jakez', 'Mainteneur'), removed: await contactTarget(env, 'Katell', 'Bailleur'), added: await contactTarget(env, 'Loeiz', 'Électricien') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO location_contacts (tenant_id, location_id, contact_id, role) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.id, t.extra?.role]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager };
      if (add) {
        await env.services.locations.addExternalContact(rec.id, { contact_id: t.id, role: t.extra?.role }, env.tenantId, env.writer, opts);
        return;
      }
      await env.services.locations.removeExternalContact(rec.id, await rowId(env, 'location_contacts', 'location_id', rec.id, 'contact_id', t.id), env.writer, opts);
    },
    'contacts'),
  toggleCase('locations.links', 'locations', 'links',
    async () => ({ kept: webLink('Plan'), removed: webLink('Accès'), added: webLink('Badge') }),
    async (env, rec, t) => {
      await env.runner.query(`INSERT INTO location_links (tenant_id, location_id, url, description) VALUES ($1, $2, $3, $4)`, [env.tenantId, rec.id, t.extra?.url, t.name]);
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager };
      if (add) {
        await env.services.locations.createLink(rec.id, { url: t.extra?.url, description: t.name }, env.writer, opts);
        return;
      }
      await env.services.locations.deleteLink(rec.id, await rowId(env, 'location_links', 'location_id', rec.id, 'url', t.extra?.url), env.writer, opts);
    },
    null),
  toggleCase('locations.sub_locations', 'locations', 'sub_locations',
    async () => {
      const room = (label: string): Target => {
        const name = unique(label);
        return { id: name, name, input: { name } };
      };
      return { kept: room('Salle A'), removed: room('Salle B'), added: room('Salle C') };
    },
    async (env, rec, t) => {
      await env.runner.query(
        `INSERT INTO location_sub_items (tenant_id, location_id, name, display_order)
         VALUES ($1, $2, $3, COALESCE((SELECT MAX(display_order) + 1 FROM location_sub_items WHERE tenant_id = $1 AND location_id = $2), 0))`,
        [env.tenantId, rec.id, t.name],
      );
    },
    async (env, rec, t, add) => {
      const opts = { manager: env.runner.manager };
      if (add) {
        await env.services.locations.createSubItem(rec.id, { name: t.name }, env.tenantId, env.writer, opts);
        return;
      }
      await env.services.locations.deleteSubItem(rec.id, await rowId(env, 'location_sub_items', 'location_id', rec.id, 'name', t.name), env.writer, opts);
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
  const { SupplierContactsService } = require('../../suppliers/supplier-contacts.service');
  const { ContractContactsService } = require('../../contracts/contract-contacts.service');
  const { ContractsService } = require('../../contracts/contracts.service');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const { SpendItemContactsService } = require('../../spend/spend-item-contacts.service');
  const { CapexItemsService } = require('../../spend/spend-items.service');
  const { PortfolioRelationsService } = require('../../portfolio/portfolio-relations.service');
  const { LocationsService } = require('../../locations/locations.service');
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
        supplierContacts: app.get(SupplierContactsService),
        contractContacts: app.get(ContractContactsService),
        contracts: app.get(ContractsService),
        budgetLines: app.get(BudgetLinesService),
        lineContacts: app.get(SpendItemContactsService),
        capexItems: app.get(CapexItemsService),
        portfolioRelations: app.get(PortfolioRelationsService),
        locations: app.get(LocationsService),
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
            // Withheld: a reference `{ hidden: true }`, or a count of the lines outside the reader's
            // modules (`budget_lines_outside`, the `{ ids }` line sets of a contract, a project, a request).
            assert.ok(/"hidden":true|"field":"budget_lines_outside"/.test(JSON.stringify(hiddenByKad)), `${cell}: the linked record reads as withheld (${JSON.stringify(hiddenByKad).slice(0, 800)})`);
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

    // A person in limited data access links a line to a project: the line they cannot read stays
    // linked, is never named and is counted in the rows (`hidden_kept`), as the project's Relations
    // tab writes them for the same person.
    const cell = 'projects.budget_lines limited access';
    const [limitedRole] = await runner.query(`SELECT 1 FROM pg_roles WHERE rolname = 'kanap_data_limited'`);
    if (!limitedRole) {
      if (process.env.CI) failures.push(`${cell}: the role kanap_data_limited is missing`);
      else console.log(`  ${cell}: skipped (no role kanap_data_limited)`);
    } else {
      await runner.query('SAVEPOINT limited_access');
      try {
        const company = async (name: string) => insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Rennes')`, [tenantId, unique(name)]);
        const readable = await company('Lisible');
        const outside = await company('Hors accès');
        const limited = await insertId(runner,
          `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode) VALUES ($1, $2, 'Rita', 'Limitée', $3, 'enabled', 'limited')`,
          [tenantId, `limited-${tenantId.slice(0, 8)}@example.test`, roleId]);
        await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, limited, roleId]);
        await runner.query(
          `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'edit')`,
          [tenantId, limited, readable]);
        const paidBy = async (companyId: string) => {
          const t = await line(env, 'opex', ++lineNumber);
          await runner.query(`UPDATE spend_items SET paying_company_id = $2 WHERE id = $1`, [t.id, companyId]);
          return t;
        };
        const kept = await paidBy(readable);
        const added = await paidBy(readable);
        const hidden = await paidBy(outside);
        const seeded = async () => {
          const rec = await projectRecord(env);
          for (const t of [kept, hidden]) await insertLink('portfolio_project_opex', 'project_id', 'opex_id')(env, rec, t);
          return rec;
        };
        const mine = await seeded();
        const twin = await seeded();
        const known = new Set([kept.id, added.id, hidden.id, limited].map((id) => id.toLowerCase()));
        await runner.query(`SELECT data_access_apply($1)`, [limited]);
        const limitedCtx = { ...ctx, userId: limited };

        const kadMarker = await now();
        const preview = await previews.createPreview(limitedCtx, 'update_entity_relations', {
          entity_type: 'projects', ref: mine.ref, relation: 'budget_lines', add: [added.input],
        });
        assert.ok(!JSON.stringify(preview).includes(hidden.name), `${cell}: the card does not name the line outside the access`);
        const executed = await previews.executePreview(limitedCtx, preview.preview_id);
        assert.equal(executed.status, 'executed', `${cell}: the card runs (${executed.error_message ?? ''})`);
        const kadRows = await auditSince(kadMarker);
        assert.ok(kadRows.length === 1 && (kadRows[0].after_json as any)?.hidden_kept === 1, `${cell}: one row counting the hidden line (${JSON.stringify(kadRows)})`);
        assert.ok(!JSON.stringify(kadRows).includes(hidden.id), `${cell}: the rows do not name the hidden line`);
        const [{ n }] = await runner.query(`SELECT data_access_hidden_count('project', $1) AS n`, [mine.id]);
        assert.equal(Number(n), 1, `${cell}: the hidden line stays linked`);

        const screenMarker = await now();
        await env.services.portfolioRelations.setProjectLink('budget_lines', added.id, true, { ...projectCtx(env), userId: limited }, owner(env, twin));
        const screenRows = await auditSince(screenMarker);
        assert.deepEqual(shape(kadRows, mine.id, known), shape(screenRows, twin.id, known), `${cell}: the assistant's audit rows are the screen's`);
        passed += 1;
        console.log(`  ${cell}: OK`);
      } catch (error: any) {
        failures.push(`${cell}: ${String(error?.message ?? error).split('\n').slice(0, 40).join('\n')}`);
        console.log(`  ${cell}: FAILED`);
      } finally {
        // Back to the writer's access and the state before the cell.
        await runner.query('ROLLBACK TO SAVEPOINT limited_access');
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
