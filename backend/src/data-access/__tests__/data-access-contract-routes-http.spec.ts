// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  PARAMTYPES_METADATA,
  PIPES_METADATA,
  ROUTE_ARGS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import appDataSource from '../../data-source';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { TenantInterceptor } from '../../common/tenant.interceptor';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { withTenantExecution } from '../../common/tenant-runner';
import { ItemNumberService } from '../../common/item-number.service';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { Task } from '../../tasks/task.entity';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { Contract } from '../../contracts/contract.entity';
import { ContractSpendItem } from '../../contracts/contract-spend-item.entity';
import { ContractLink } from '../../contracts/contract-link.entity';
import { ContractAttachment } from '../../contracts/contract-attachment.entity';
import { ContractContactLink } from '../../contracts/contract-contact.entity';
import { ExternalContact } from '../../contacts/external-contact.entity';
import { ContractsService } from '../../contracts/contracts.service';
import { ContractContactsService } from '../../contracts/contract-contacts.service';
import { ContractRenewalService } from '../../contracts/contract-renewal.service';
import { ContractsController } from '../../contracts/contracts.controller';
import { ContractRenewalController } from '../../contracts/contract-renewal.controller';
import { SpendItemContractsController } from '../../contracts/spend-item-contracts.controller';
import { CapexItemContractsController } from '../../contracts/capex-item-contracts.controller';
import { DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE } from '../contract-write-checks';
import { DATA_ACCESS_PLACEMENT_MESSAGE, DATA_ACCESS_READ_ONLY_LINE_MESSAGE } from '../line-write-checks';
import { DATA_ACCESS_RESERVED_MESSAGE } from '../reserved-operations';
import { LIMITED_ROLE, PgClient, APP_URL, connect, roleExists } from './data-access-test-helpers';
import { ContractSeed, seedContracts } from './data-access-contract-seed';

/**
 * Data-scoped access, lot 5 run 5B (planning/data-scoped-access/spec.md §2.3, §3.3, §4.3, §5.4,
 * §6.4, §6.7, §6.8, §7.7, §10.1): the contract writes over HTTP, through the real tenant
 * interceptor (the person's access applied per request), exception filter, controllers and
 * services, on the contract fixture of run 5A (`data-access-contract-seed.ts`), committed for the
 * requests and purged after.
 *
 * Marta (ES edit) modifies CE, reads CX; Rita (INF-FR edit, INF read) modifies CF, reads CL only
 * through a visible line; Nina (no node) owns CN; Paul modifies none; Ulla has access to all data.
 *
 * - create: a company outside, or an edit node with a company outside the edit-node companies,
 *   refused with the placement message; inside created and placed; `editable` true;
 * - update: a read-only contract refused by the API and untouched; an owner edits a field, never
 *   moves the contract; a hidden contract answers as a missing one;
 * - renewal, compliance, contact, link, attachment, task on a read-only contract: 403;
 * - `editable` on the detail, the list rows, create and update; absent for an unscoped person;
 * - cost centre: set, cleared, invalid and inactive refused; list filter "without cost centre";
 *   CSV column;
 * - line links: a hidden line or contract answers as a missing one, a read-only line 403, bulk
 *   replacements keep the hidden links from both sides, and the contract-side line routes need
 *   the budget reader level besides the contracts member level;
 * - import: 403 DATA_ACCESS_LIMITED for a limited person, unchanged for an unscoped one.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 4 });
let client: PgClient;
let s: ContractSeed;
let hasRole = false;
type Extra = { disabled: string; cxAttachment: string; companyName: string; supplierName: string; ritaContract: string; relationContract: string };
let extra: Extra;

// ---------------------------------------------------------------------------------------------
// The real controllers, with the services they do not need for these routes stubbed.

const CONTROLLERS = [ContractsController, ContractRenewalController, SpendItemContractsController, CapexItemContractsController];

/** A stand-in for any service: every member is a function resolving to undefined. Not a thenable. */
function stub(): any {
  const fn = () => Promise.resolve(undefined);
  return new Proxy({}, {
    get: (_target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : fn),
  });
}

function depsOf(cls: any): unknown[] {
  const tokens: unknown[] = [...(Reflect.getMetadata(PARAMTYPES_METADATA, cls) ?? [])];
  for (const { index, param } of Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) ?? []) tokens[index] = param;
  return tokens.map((token: any) => (token && typeof token === 'object' && typeof token.forwardRef === 'function' ? token.forwardRef() : token));
}

function enhancersOf(controller: any): any[] {
  const targets = [controller, ...Object.getOwnPropertyNames(controller.prototype).map((name) => controller.prototype[name])];
  const out: any[] = [];
  for (const target of targets) {
    if (typeof target !== 'function') continue;
    for (const key of [GUARDS_METADATA, INTERCEPTORS_METADATA, PIPES_METADATA]) {
      for (const enhancer of Reflect.getMetadata(key, target) ?? []) if (typeof enhancer === 'function') out.push(enhancer);
    }
  }
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {};
    for (const arg of Object.values<any>(args)) {
      for (const pipe of arg?.pipes ?? []) if (typeof pipe === 'function') out.push(pipe);
    }
  }
  return out;
}

function testModule(): any {
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  const contacts = new ContractContactsService(
    dataSource.getRepository(ContractContactLink),
    dataSource.getRepository(ExternalContact),
    dataSource.getRepository(Contract),
    audit,
  );
  const contracts = new ContractsService(
    dataSource.getRepository(Contract),
    dataSource.getRepository(ContractSpendItem),
    dataSource.getRepository(ContractLink),
    dataSource.getRepository(ContractAttachment),
    audit,
    new TasksUnifiedService(
      dataSource.getRepository(Task), audit, dataSource, stub(), stub(), new ItemNumberService(), stub(), stub(), stub(),
    ),
    stub(),
    contacts,
    stub(),
    stub(),
  );
  const renewal = new ContractRenewalService(
    dataSource,
    audit,
    new TasksUnifiedService(
      dataSource.getRepository(Task), audit, dataSource, stub(), stub(), new ItemNumberService(), stub(), stub(), stub(),
    ),
    stub(),
  );
  const real = new Map<unknown, unknown>([
    [ContractsService, contracts],
    [ContractContactsService, contacts],
    [ContractRenewalService, renewal],
    [DataSource, dataSource],
  ]);
  const enhancers = new Set<any>();
  for (const controller of CONTROLLERS) for (const enhancer of enhancersOf(controller)) enhancers.add(enhancer);
  // Authentication and permissions are not under test: the data access is. The permission sets
  // the routes read (`canReadContractBudget`) come from the middleware below.
  for (const enhancer of enhancers) {
    if (typeof enhancer.prototype?.canActivate !== 'function') continue;
    enhancer.prototype.canActivate = () => true;
    if (typeof enhancer.prototype.onModuleInit === 'function') enhancer.prototype.onModuleInit = () => undefined;
  }
  const tokens = new Set<unknown>();
  const built = [...enhancers].filter((enhancer) => typeof enhancer.prototype?.transform !== 'function');
  for (const cls of [...CONTROLLERS, ...built]) {
    for (const token of depsOf(cls)) {
      if (token === undefined || token === Object) throw new Error(`${cls.name}: a dependency the spec cannot stub`);
      if (token !== Reflector) tokens.add(token);
    }
  }
  const providers = [...tokens].map((token) => ({ provide: token as any, useValue: real.has(token) ? real.get(token) : stub() }));
  @Module({ controllers: CONTROLLERS, providers })
  class ContractRoutesModule {}
  return ContractRoutesModule;
}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(testModule(), { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: s.tenantId, slug: 'da-contract-routes', name: 'Data access contract routes' };
    const user = req.headers['x-da-user'];
    if (typeof user === 'string' && user) req.user = { sub: user };
    // What the permission guard sets (stubbed above): the contract member level, and the budget
    // reader level the contract-side line routes check for everyone.
    const budget = req.headers['x-da-budget'];
    req.permissions = budget === 'none'
      ? { contracts: 'admin', tasks: 'admin', applications: 'admin', infrastructure: 'admin' }
      : { contracts: 'admin', budget: 'reader', tasks: 'admin', applications: 'admin', infrastructure: 'admin' };
    next();
  });
  app.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  app.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Answer = { status: number; text: string; body: any };

async function call(
  app: INestApplication,
  method: Method,
  path: string,
  userId: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/${path}`, {
    method,
    headers: { 'x-da-user': userId, 'content-type': 'application/json', ...headers },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, text, body: parsed };
}

async function callForm(app: INestApplication, path: string, userId: string, form: FormData, headers: Record<string, string> = {}): Promise<Answer> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/${path}`, {
    method: 'POST',
    headers: { 'x-da-user': userId, ...headers },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, text, body: parsed };
}

function expectLimited(res: Answer, message: string, what: string): void {
  assert.equal(res.status, 403, `${what}: ${res.text}`);
  assert.equal(res.body?.code, 'DATA_ACCESS_LIMITED', `${what}: ${res.text}`);
  assert.equal(res.body?.message, message, what);
}

// ---------------------------------------------------------------------------------------------
// Seed.

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedAll(): Promise<void> {
  await client.query('BEGIN');
  try {
    s = await seedContracts(client);
    const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
    const [disabled] = await q(
      `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id, status, disabled_at)
       VALUES (app_current_tenant(), 'DA-OFF', 'cost_center', 'DA disabled node', $1, 'disabled', now() - interval '1 day') RETURNING id`,
      [s.fr],
    );
    const [attachment] = await q(
      `SELECT id FROM contract_attachments WHERE tenant_id = app_current_tenant() AND contract_id = $1 ORDER BY id LIMIT 1`,
      [s.contracts.CX],
    );
    const [company] = await q(`SELECT name FROM companies WHERE tenant_id = app_current_tenant() AND id = $1`, [s.fr]);
    const [supplier] = await q(`SELECT name FROM suppliers WHERE tenant_id = app_current_tenant() AND id = $1`, [s.supplier]);
    // A contract Rita edits with a modifiable line (L1) and a hidden line (L5): a replacement
    // from the contract side must delete only the visible link.
    const [ritaContract] = await q(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id)
       VALUES (app_current_tenant(), 'DA HTTP Rita links', $1, $2, '2026-01-01', $3) RETURNING id`,
      [s.fr, s.supplier, s.infFr],
    );
    for (const line of [s.lines.L1, s.lines.L5]) {
      await q(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [ritaContract.id, line]);
    }
    // A contract Rita edits, linked to a modifiable line (L1), a read-only one (L3) and a hidden
    // one (L5): replacing the set checks only the lines added and removed.
    const [relationContract] = await q(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, cost_center_id)
       VALUES (app_current_tenant(), 'DA HTTP Rita relations', $1, $2, '2026-01-01', $3) RETURNING id`,
      [s.fr, s.supplier, s.infFr],
    );
    for (const line of [s.lines.L1, s.lines.L3, s.lines.L5]) {
      await q(`INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES (app_current_tenant(), $1, $2)`, [relationContract.id, line]);
    }
    extra = {
      disabled: disabled.id,
      cxAttachment: attachment.id,
      companyName: company.name,
      supplierName: supplier.name,
      ritaContract: ritaContract.id,
      relationContract: relationContract.id,
    };
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function lineContracts(lineId: string): Promise<string[]> {
  return inTenant(async () => (await client.query(
    `SELECT contract_id FROM contract_spend_items WHERE tenant_id = $1 AND spend_item_id = $2 ORDER BY contract_id`,
    [s.tenantId, lineId],
  )).rows.map((row) => row.contract_id));
}

async function contractLines(contractId: string): Promise<string[]> {
  return inTenant(async () => (await client.query(
    `SELECT spend_item_id FROM contract_spend_items WHERE tenant_id = $1 AND contract_id = $2 ORDER BY spend_item_id`,
    [s.tenantId, contractId],
  )).rows.map((row) => row.spend_item_id));
}

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  return inTenant(async () => (await client.query(sql, params)).rows[0] as T);
}

// ---------------------------------------------------------------------------------------------
// Scenarios.


async function testCreateAndUpdate(app: INestApplication): Promise<void> {
  const { persons: p, contracts: c } = s;
  const base = { supplier_id: s.supplier, start_date: '2026-01-01' };

  const outside = await call(app, 'POST', 'contracts', p.rita, { ...base, name: 'DA HTTP outside', company_id: s.es });
  expectLimited(outside, DATA_ACCESS_PLACEMENT_MESSAGE, 'Rita creates in a company outside her access');

  const outsideNode = await call(app, 'POST', 'contracts', p.rita, { ...base, name: 'DA HTTP outside node', company_id: s.es, cost_center_id: s.infFr });
  expectLimited(outsideNode, DATA_ACCESS_PLACEMENT_MESSAGE, 'Rita places in her edit node with a company outside the edit-node companies');

  const inside = await call(app, 'POST', 'contracts', p.rita, { ...base, name: 'DA HTTP inside', company_id: s.fr, cost_center_id: s.infFr });
  assert.equal(inside.status, 201, `Rita creates inside: ${inside.text}`);
  assert.equal(inside.body.company_id, s.fr);
  assert.equal(inside.body.cost_center_id, s.infFr);
  assert.equal(inside.body.editable, true, 'the created contract is editable for its creator');

  // Update: a read-only contract (CX for Rita) refused by the API, nothing written.
  const before = await scalar<{ notes: string | null }>(`SELECT notes FROM contracts WHERE id = $1`, [c.CX]);
  const readOnly = await call(app, 'PATCH', `contracts/${c.CX}`, p.rita, { notes: 'changed by Rita' });
  expectLimited(readOnly, DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE, 'Rita updates a read-only contract');
  assert.equal((await scalar<{ notes: string | null }>(`SELECT notes FROM contracts WHERE id = $1`, [c.CX])).notes, before.notes, 'nothing written');

  // The owner edits a field, never the place.
  const ownerEdit = await call(app, 'PATCH', `contracts/${c.CN}`, p.nina, { notes: 'owner notes' });
  assert.equal(ownerEdit.status, 200, `Nina, owner, edits a field: ${ownerEdit.text}`);
  assert.equal(ownerEdit.body.editable, true);
  assert.equal((await scalar<{ notes: string | null }>(`SELECT notes FROM contracts WHERE id = $1`, [c.CN])).notes, 'owner notes');
  const ownerMove = await call(app, 'PATCH', `contracts/${c.CN}`, p.nina, { company_id: s.es });
  expectLimited(ownerMove, DATA_ACCESS_PLACEMENT_MESSAGE, 'Nina, owner, moves the contract outside');
  assert.equal((await scalar<{ company_id: string }>(`SELECT company_id FROM contracts WHERE id = $1`, [c.CN])).company_id, s.fr, 'the company is kept');
  // The same company in upper case names the same row: not a move, and an owner may edit it.
  const ownerSameCompany = await call(app, 'PATCH', `contracts/${c.CN}`, p.nina, { company_id: s.fr.toUpperCase() });
  assert.equal(ownerSameCompany.status, 200, `Nina, owner, sends the same company in upper case: ${ownerSameCompany.text}`);
  assert.equal(String(ownerSameCompany.body.company_id).toLowerCase(), s.fr, 'the contract keeps its company');
  assert.equal((await scalar<{ company_id: string }>(`SELECT company_id FROM contracts WHERE id = $1`, [c.CN])).company_id, s.fr, 'the stored company is unchanged');

  // A hidden contract answers as a missing one.
  const hidden = await call(app, 'PATCH', `contracts/${c.CH}`, p.rita, { notes: 'hidden' });
  const missing = await call(app, 'PATCH', `contracts/${randomUUID()}`, p.rita, { notes: 'missing' });
  assert.equal(hidden.status, 404, hidden.text);
  assert.equal(missing.status, 404, missing.text);
  assert.equal(hidden.body?.message, missing.body?.message, 'a hidden contract answers as a missing one');

  // Ulla (all data): unchanged, and no `editable` key.
  const ulla = await call(app, 'PATCH', `contracts/${c.CF}`, p.ulla, { notes: 'ulla notes' });
  assert.equal(ulla.status, 200, ulla.text);
  assert.equal(Object.prototype.hasOwnProperty.call(ulla.body, 'editable'), false, 'unscoped: no editable');
  console.log('  create placement, read-only update, owner field and move, hidden as missing, unscoped unchanged: OK');
}

async function testChildWrites(app: INestApplication): Promise<void> {
  const { persons: p, contracts: c } = s;
  const routes: Array<[Method, string, string, unknown]> = [
    ['POST', 'renewal', `contracts/${c.CX}/renewal/renew`, {}],
    ['PATCH', 'compliance', `contracts/${c.CX}/compliance/gdpr_dpa`, { state: 'present' }],
    ['POST', 'contact', `contracts/${c.CX}/contacts`, { contactId: s.contact2, role: 'other' }],
    ['POST', 'documentary link', `contracts/${c.CX}/links`, { url: 'https://example.invalid/read-only' }],
    ['POST', 'task', `contracts/${c.CX}/tasks`, { title: 'Never created' }],
  ];
  for (const [method, what, path, body] of routes) {
    const res = await call(app, method, path, p.rita, body);
    expectLimited(res, DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE, `${what} on a read-only contract`);
  }
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('%PDF-1.4\n')], { type: 'application/pdf' }), 'x.pdf');
  const upload = await callForm(app, `contracts/${c.CX}/attachments`, p.rita, form);
  expectLimited(upload, DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE, 'attachment upload on a read-only contract');
  const remove = await call(app, 'PATCH', `contracts/attachments/${extra.cxAttachment}/delete`, p.rita);
  expectLimited(remove, DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE, 'attachment delete on a read-only contract');

  // Nothing was written.
  const counts = await scalar<{ contacts: number; links: number; attachments: number; tasks: number }>(
    `SELECT
       (SELECT count(*)::int FROM contract_contacts WHERE contract_id = $1) AS contacts,
       (SELECT count(*)::int FROM contract_links WHERE contract_id = $1) AS links,
       (SELECT count(*)::int FROM contract_attachments WHERE contract_id = $1) AS attachments,
       (SELECT count(*)::int FROM tasks WHERE related_object_type = 'contract' AND related_object_id = $1) AS tasks`,
    [c.CX],
  );
  assert.deepEqual(counts, { contacts: 1, links: 1, attachments: 1, tasks: 0 }, 'nothing written on the read-only contract');
  console.log('  renewal, compliance, contact, link, attachment upload and delete, task on a read-only contract: 403 and nothing written: OK');
}

async function testEditable(app: INestApplication): Promise<void> {
  const { persons: p, contracts: c } = s;
  const throughLine = await call(app, 'GET', `contracts/${c.CL}`, p.rita);
  assert.equal(throughLine.status, 200, throughLine.text);
  assert.equal(throughLine.body.editable, false, 'a contract opened through a visible line is read only');
  const inNode = await call(app, 'GET', `contracts/${c.CF}`, p.rita);
  assert.equal(inNode.body.editable, true, 'a contract in an edit node is editable');
  const unscoped = await call(app, 'GET', `contracts/${c.CF}`, p.ulla);
  assert.equal(Object.prototype.hasOwnProperty.call(unscoped.body, 'editable'), false, 'unscoped: no editable');

  const list = await call(app, 'GET', 'contracts?limit=100', p.rita);
  assert.equal(list.status, 200, list.text);
  const rows = new Map<string, any>((list.body.items ?? []).map((row: any) => [row.id, row]));
  assert.equal(rows.get(c.CL)?.editable, false, 'list: opened through a line, read only');
  assert.equal(rows.get(c.CF)?.editable, true, 'list: in an edit node, editable');
  const listUlla = await call(app, 'GET', 'contracts?limit=100', p.ulla);
  assert.ok((listUlla.body.items ?? []).every((row: any) => !Object.prototype.hasOwnProperty.call(row, 'editable')), 'unscoped list: no editable');
  console.log('  editable: false through a line, true in an edit node, absent unscoped, on the detail, the list and the writes: OK');
}

async function testCostCentre(app: INestApplication): Promise<void> {
  const { persons: p, contracts: c } = s;
  const initial = await call(app, 'GET', `contracts/${c.CE}`, p.marta);
  assert.equal(initial.body.cost_center_id, null);
  assert.equal(initial.body.cost_center_name, null);

  const set = await call(app, 'PATCH', `contracts/${c.CE}`, p.marta, { cost_center_id: s.infEs });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.body.cost_center_id, s.infEs);
  const setDetail = await call(app, 'GET', `contracts/${c.CE}`, p.marta);
  assert.equal(setDetail.body.cost_center_name, 'INF-ES');

  const cleared = await call(app, 'PATCH', `contracts/${c.CE}`, p.marta, { cost_center_id: null });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.body.cost_center_id, null);
  const clearedDetail = await call(app, 'GET', `contracts/${c.CE}`, p.marta);
  assert.equal(clearedDetail.body.cost_center_name, null);

  const invalid = await call(app, 'PATCH', `contracts/${c.CE}`, p.marta, { cost_center_id: randomUUID() });
  assert.equal(invalid.status, 400, invalid.text);
  const inactive = await call(app, 'PATCH', `contracts/${c.CE}`, p.marta, { cost_center_id: extra.disabled });
  assert.equal(inactive.status, 400, inactive.text);

  // A group is a valid place for a contract (not for a line).
  const group = await call(app, 'POST', 'contracts', p.ulla, {
    name: 'DA HTTP group place', company_id: s.fr, supplier_id: s.supplier, start_date: '2026-01-01', cost_center_id: s.inf,
  });
  assert.equal(group.status, 201, group.text);
  assert.equal(group.body.cost_center_id, s.inf);
  const groupDetail = await call(app, 'GET', `contracts/${group.body.id}`, p.ulla);
  assert.equal(groupDetail.body.cost_center_name, 'INF');

  const detailCx = await call(app, 'GET', `contracts/${c.CX}`, p.rita);
  assert.equal(detailCx.body.cost_center_id, s.infEs);
  assert.equal(detailCx.body.cost_center_name, 'INF-ES');

  // The list's "without cost centre": a set filter with a null value.
  const filters = JSON.stringify({ cost_center_name: { filterType: 'set', values: [null] } });
  const without = await call(app, 'GET', `contracts?limit=100&filters=${encodeURIComponent(filters)}`, p.ulla);
  assert.equal(without.status, 200, without.text);
  const withoutRows: any[] = without.body.items ?? [];
  assert.ok(withoutRows.some((row) => row.id === c.CE), 'the filter keeps a contract without a cost centre');
  assert.ok(!withoutRows.some((row) => row.id === c.CF), 'the filter leaves out a contract with one');
  assert.ok(withoutRows.every((row) => row.cost_center_id === null), 'every row is without a cost centre');

  // Filter and sort by the node's name, as the list offers them.
  const named = JSON.stringify({ cost_center_name: { filterType: 'set', values: ['INF-FR'] } });
  const filtered = await call(app, 'GET', `contracts?limit=100&filters=${encodeURIComponent(named)}`, p.ulla);
  assert.equal(filtered.status, 200, filtered.text);
  assert.ok((filtered.body.items ?? []).some((row: any) => row.id === c.CF), 'the filter finds the CF contract');
  assert.ok((filtered.body.items ?? []).every((row: any) => row.cost_center_name === 'INF-FR'), 'every row names INF-FR');
  const sorted = await call(app, 'GET', 'contracts?limit=100&sort=cost_center_name:ASC', p.ulla);
  assert.equal(sorted.status, 200, sorted.text);

  const exported = await call(app, 'GET', 'contracts/export?scope=data', p.ulla);
  assert.equal(exported.status, 200, exported.text);
  const [header, ...lines] = exported.text.split('\n');
  assert.ok(header.includes('cost_center'), `the CSV has the cost_center column: ${header}`);
  const cfLine = lines.find((line) => line.startsWith(`DA contract CF`));
  assert.ok(cfLine, 'the CSV has the CF contract');
  assert.ok(cfLine!.includes('INF-FR'), `the CSV writes the node name: ${cfLine}`);
  console.log('  cost centre: set, cleared, invalid and inactive 400, group accepted, detail, list filter, CSV column: OK');
}

async function testLineLinks(app: INestApplication): Promise<void> {
  const { persons: p, contracts: c, lines } = s;

  // Contract side: Rita's own contract carries a modifiable line (L1) and a hidden line (L5);
  // replacing keeps the hidden link.
  const before = await contractLines(extra.ritaContract);
  assert.deepEqual(before, [lines.L1, lines.L5].sort(), 'the fixture links the visible L1 and the hidden L5');
  const replaced = await call(app, 'POST', `contracts/${extra.ritaContract}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [] });
  assert.equal(replaced.status, 201, replaced.text);
  assert.equal(replaced.body.removed, 1, 'only the visible link is removed');
  assert.deepEqual(await contractLines(extra.ritaContract), [lines.L5], 'the hidden link stays');

  const hiddenLine = await call(app, 'POST', `contracts/${extra.ritaContract}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [lines.L5] });
  assert.equal(hiddenLine.status, 404, hiddenLine.text);
  const missingLine = await call(app, 'POST', `contracts/${extra.ritaContract}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [randomUUID()] });
  assert.equal(missingLine.status, 404, missingLine.text);
  assert.equal(hiddenLine.body?.message, missingLine.body?.message, 'a hidden line answers as a missing one');

  const readOnlyLine = await call(app, 'POST', `contracts/${extra.ritaContract}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [lines.L2] });
  expectLimited(readOnlyLine, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, 'Rita links a read-only line');

  // A contract linked to a modifiable line (L1), a read-only one (L3) and a hidden one (L5): a
  // replacement checks only the lines added and removed, never one that stays linked. Both the
  // OPEX route and the Budget route replace the same set through their own service.
  const relationLinks = () => contractLines(extra.relationContract);
  assert.deepEqual(await relationLinks(), [lines.L1, lines.L3, lines.L5].sort(), 'the fixture links L1, L3 and L5');
  const unchanged = await call(app, 'POST', `contracts/${extra.relationContract}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [lines.L1, lines.L3] });
  assert.equal(unchanged.status, 201, `keeping the read-only line linked: ${unchanged.text}`);
  assert.deepEqual({ added: unchanged.body.added, removed: unchanged.body.removed }, { added: 0, removed: 0 }, 'nothing changes');
  const unchangedBudget = await call(app, 'POST', `contracts/${extra.relationContract}/budget-lines/bulk-replace`, p.rita, { budget_line_ids: [lines.L1, lines.L3] });
  assert.equal(unchangedBudget.status, 201, `budget route, keeping the read-only line linked: ${unchangedBudget.text}`);
  assert.deepEqual({ added: unchangedBudget.body.added, removed: unchangedBudget.body.removed }, { added: 0, removed: 0 }, 'nothing changes');
  assert.deepEqual(await relationLinks(), [lines.L1, lines.L3, lines.L5].sort(), 'the hidden link and the read-only one stay');

  // Removing the modifiable line while the read-only one stays linked.
  const removeEditable = await call(app, 'POST', `contracts/${extra.relationContract}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [lines.L3] });
  assert.equal(removeEditable.status, 201, `removing L1 while L3 stays: ${removeEditable.text}`);
  assert.equal(removeEditable.body.removed, 1, removeEditable.text);
  assert.deepEqual(await relationLinks(), [lines.L3, lines.L5].sort(), 'L1 unlinked, L3 and the hidden L5 kept');
  const addEditableBack = await call(app, 'POST', `contracts/${extra.relationContract}/budget-lines/bulk-replace`, p.rita, { budget_line_ids: [lines.L1, lines.L3] });
  assert.equal(addEditableBack.status, 201, `budget route, adding L1 back beside L3: ${addEditableBack.text}`);
  assert.equal(addEditableBack.body.added, 1, addEditableBack.text);
  assert.deepEqual(await relationLinks(), [lines.L1, lines.L3, lines.L5].sort(), 'L1 linked again, L3 and the hidden L5 kept');

  // Adding, or removing, a read-only line is a write on it: refused, and nothing changes.
  for (const [path, body] of [
    [`contracts/${extra.relationContract}/spend-items/bulk-replace`, { spend_item_ids: [lines.L1, lines.L2, lines.L3] }],
    [`contracts/${extra.relationContract}/budget-lines/bulk-replace`, { budget_line_ids: [lines.L1, lines.L2, lines.L3] }],
  ] as const) {
    const refused = await call(app, 'POST', path, p.rita, body);
    expectLimited(refused, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, `${path} adding the read-only L2`);
  }
  for (const [path, body] of [
    [`contracts/${extra.relationContract}/spend-items/bulk-replace`, { spend_item_ids: [lines.L1] }],
    [`contracts/${extra.relationContract}/budget-lines/bulk-replace`, { budget_line_ids: [lines.L1] }],
  ] as const) {
    const refused = await call(app, 'POST', path, p.rita, body);
    expectLimited(refused, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, `${path} removing the read-only L3`);
  }
  assert.deepEqual(await relationLinks(), [lines.L1, lines.L3, lines.L5].sort(), 'every refusal left the links untouched');

  const readOnlyContract = await call(app, 'POST', `contracts/${c.CE}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [] });
  expectLimited(readOnlyContract, DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE, 'Rita changes the lines of a read-only contract');
  const hiddenContract = await call(app, 'POST', `contracts/${c.CH}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [] });
  const missingContract = await call(app, 'POST', `contracts/${randomUUID()}/spend-items/bulk-replace`, p.rita, { spend_item_ids: [] });
  assert.equal(hiddenContract.status, 404, hiddenContract.text);
  assert.equal(missingContract.status, 404, missingContract.text);
  assert.equal(hiddenContract.body?.message, missingContract.body?.message, 'a hidden contract answers as a missing one');

  // Line side: L1 links to CE, CL, CF and the rows contract. Rita replaces with CF: the visible
  // CE, CL and rows links go.
  // A link to a hidden contract cannot exist on a visible line: the contract read rule makes it
  // visible through the line, so the DELETE ... USING contracts form is defensive here.
  const lineReplaced = await call(app, 'POST', `spend-items/${lines.L1}/contracts/bulk-replace`, p.rita, { contract_ids: [c.CF] });
  assert.equal(lineReplaced.status, 201, lineReplaced.text);
  assert.equal(lineReplaced.body.removed, 3, lineReplaced.text);
  assert.deepEqual(await lineContracts(lines.L1), [c.CF], 'the visible links are replaced');

  const hiddenTarget = await call(app, 'POST', `spend-items/${lines.L1}/contracts/bulk-replace`, p.rita, { contract_ids: [c.CH] });
  const missingTarget = await call(app, 'POST', `spend-items/${lines.L1}/contracts/bulk-replace`, p.rita, { contract_ids: [randomUUID()] });
  assert.equal(hiddenTarget.status, 404, hiddenTarget.text);
  assert.equal(missingTarget.status, 404, missingTarget.text);
  assert.equal(hiddenTarget.body?.message, missingTarget.body?.message, 'a hidden contract answers as a missing one');

  const lineReadOnly = await call(app, 'POST', `spend-items/${lines.L2}/contracts/bulk-replace`, p.rita, { contract_ids: [] });
  expectLimited(lineReadOnly, DATA_ACCESS_READ_ONLY_LINE_MESSAGE, 'Rita changes the contracts of a read-only line');

  // The contract-side line routes need the budget reader level, for everyone.
  for (const [path, body] of [
    [`contracts/${extra.ritaContract}/spend-items/bulk-replace`, { spend_item_ids: [] }],
    [`contracts/${extra.ritaContract}/capex-items/bulk-replace`, { capex_item_ids: [] }],
    [`contracts/${extra.ritaContract}/budget-lines/bulk-replace`, { budget_line_ids: [] }],
  ] as const) {
    const res = await call(app, 'POST', path, p.rita, body, { 'x-da-budget': 'none' });
    assert.equal(res.status, 403, `${path} without the budget right: ${res.text}`);
  }
  const unscopedBudget = await call(app, 'POST', `contracts/${c.CF}/spend-items/bulk-replace`, p.ulla, { spend_item_ids: [lines.L1] });
  assert.equal(unscopedBudget.status, 201, `an unscoped contracts member with the budget read passes: ${unscopedBudget.text}`);
  console.log('  line links: hidden line and contract 404 as missing, read-only line 403, hidden links kept on both sides, budget read required: OK');
}

async function testShare(app: INestApplication): Promise<void> {
  const { persons: p, contracts: c } = s;
  // Paul reads CE through L1 only; CE also carries L5, L6 and L7, hidden from him. "Send the link"
  // gives no cannot_open list at all: who could open it would tell where those lines sit.
  const throughHiddenLines = await call(app, 'POST', `contracts/${c.CE}/share`, p.paul, { recipient_user_ids: [p.nina] });
  assert.equal(throughHiddenLines.status, 201, throughHiddenLines.text);
  assert.equal(
    Object.prototype.hasOwnProperty.call(throughHiddenLines.body, 'cannot_open'),
    false,
    `a contract with lines hidden to the sender: no warning (${throughHiddenLines.text})`,
  );
  // CF carries no hidden line for Paul: the warning names the recipient who cannot open it, as before.
  const noHiddenLine = await call(app, 'POST', `contracts/${c.CF}/share`, p.paul, { recipient_user_ids: [p.nina] });
  assert.equal(noHiddenLine.status, 201, noHiddenLine.text);
  assert.deepEqual((noHiddenLine.body?.cannot_open ?? []).map((row: any) => row.id), [p.nina], noHiddenLine.text);
  console.log('  send the link: no warning when the contract carries lines hidden to the sender, the warning otherwise: OK');
}

async function testLineOpenedContract(app: INestApplication): Promise<void> {
  const { persons: p, contracts: c } = s;
  // CL is read through L1 only: read-only, its attachments and links closed, counted (3 documents).
  const opened = await call(app, 'GET', `contracts/${c.CL}`, p.rita);
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.body.editable, false, 'opened through a visible line: read only');
  assert.equal(opened.body.closed_documents_count, 3, 'attachments and document links the person cannot open');
  assert.deepEqual(opened.body.attachments, [], 'no attachment');
  assert.deepEqual(opened.body.links, [], 'no document link');
  const attachments = await call(app, 'GET', `contracts/${c.CL}/attachments`, p.rita);
  assert.equal(attachments.status, 200, attachments.text);
  assert.deepEqual(attachments.body, [], 'the attachments route answers an empty list, never 500');
  const links = await call(app, 'GET', `contracts/${c.CL}/links`, p.rita);
  assert.equal(links.status, 200, links.text);
  assert.deepEqual(links.body, [], 'the links route answers an empty list');
  const attachmentId = await scalar<{ id: string }>(`SELECT id FROM contract_attachments WHERE contract_id = $1 ORDER BY id LIMIT 1`, [c.CL]);
  const download = await call(app, 'GET', `contracts/attachments/${attachmentId.id}`, p.rita);
  assert.equal(download.status, 404, 'a closed attachment answers 404');

  // A directly readable contract keeps its documents, and no closed count.
  const direct = await call(app, 'GET', `contracts/${c.CE}`, p.marta);
  assert.equal(direct.status, 200, direct.text);
  assert.equal(direct.body.closed_documents_count, 0, 'directly readable: nothing closed');
  assert.equal(direct.body.attachments.length, 1);
  assert.equal(direct.body.links.length, 1);
  console.log('  contract opened through a visible line: read only, closed documents counted, lists empty, download 404: OK');
}

async function testImport(app: INestApplication): Promise<void> {
  const csv = [
    'name,company_name,supplier_name,start_date,duration_months,auto_renewal,notice_period_months,yearly_amount_at_signature,currency,billing_frequency,status,owner_email,notes',
    `DA import dry run,${extra.companyName},${extra.supplierName},2026-01-01,12,yes,1,0,EUR,annual,,,`,
  ].join('\n');
  const form = () => {
    const data = new FormData();
    data.append('file', new Blob([Buffer.from(csv, 'utf8')], { type: 'text/csv' }), 'contracts.csv');
    return data;
  };
  const limited = await callForm(app, 'contracts/import?dryRun=true', s.persons.rita, form());
  expectLimited(limited, DATA_ACCESS_RESERVED_MESSAGE, 'a limited person imports contracts');
  const unscoped = await callForm(app, 'contracts/import?dryRun=true', s.persons.ulla, form());
  assert.equal(unscoped.status, 201, `an unscoped person imports: ${unscoped.text}`);
  assert.equal(unscoped.body.dryRun, true, unscoped.text);
  assert.equal(unscoped.body.ok, true, unscoped.text);
  console.log('  import: 403 DATA_ACCESS_LIMITED limited, dry run unchanged unscoped: OK');
}

// ---------------------------------------------------------------------------------------------
// Run.

async function cleanup(): Promise<void> {
  if (!s) return;
  await withTenantExecution(dataSource, s.tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
    .catch((error) => console.error(`could not purge ${s.tenantId}:`, error));
  await client.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId])
    .catch((error: unknown) => console.error(`could not delete ${s.tenantId}:`, error));
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  await dataSource.initialize();
  let app: INestApplication | null = null;
  try {
    hasRole = await roleExists(client);
    console.log(`data access contract routes over HTTP (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log('data access contract routes over HTTP: role absent, skipped');
      return;
    }
    await client.query(`SELECT data_access_sync_policies()`);
    await seedAll();
    app = await createApp();
    await testCreateAndUpdate(app);
    await testEditable(app);
    await testChildWrites(app);
    await testCostCentre(app);
    await testLineOpenedContract(app);
    await testShare(app);
    await testLineLinks(app);
    await testImport(app);
    console.log('data access contract routes over HTTP: all scenarios passed');
  } finally {
    if (app) await app.close();
    try { await cleanup(); } finally { await dataSource.destroy(); await client.end(); }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
