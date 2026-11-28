import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot K2a of 26.12.1 (leftovers, item 3): `PATCH /spend-items/:id/versions` and
// `PATCH /capex-items/:id/versions` change a version's allocation method or driver as the
// Allocations tab does (`PUT …/versions/:id/allocations`): an automatic method removes the stored
// manual split with its audit row, a new driver computes the split again. For each gesture and
// nature, the route's audit rows and the version's allocation are compared with the tab's.

process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Nature = 'opex' | 'capex';
type Seed = { tenantId: string; companyId: string; secondCompanyId: string; accountId: string };
type Harness = { app: any; dataSource: DataSource; lines: any; routes: Record<Nature, any>; tab: Record<Nature, any> };

type Gesture = {
  name: string;
  /** The version's allocation before the gesture, saved by the Allocations tab. */
  start: (s: Seed) => Record<string, unknown> | null;
  /** The PATCH body (without `id`). */
  patch: Record<string, unknown>;
  /** The same gesture on the Allocations tab. */
  tab: (s: Seed) => Record<string, unknown>;
};

const twoCompanies = (s: Seed) => [{ company_id: s.companyId, department_id: null }, { company_id: s.secondCompanyId, department_id: null }];

const GESTURES: Gesture[] = [
  {
    name: 'manual to automatic',
    start: (s) => ({ method: 'manual_company', driver: 'headcount', rows: twoCompanies(s) }),
    patch: { allocation_method: 'headcount' },
    tab: () => ({ method: 'headcount', driver: 'headcount', rows: [] }),
  },
  {
    name: 'automatic to manual',
    start: () => null,
    patch: { allocation_method: 'manual_company' },
    tab: () => ({ method: 'manual_company', driver: 'headcount', rows: [] }),
  },
  {
    name: 'driver change',
    start: (s) => ({ method: 'manual_company', driver: 'headcount', rows: twoCompanies(s) }),
    patch: { allocation_driver: 'it_users' },
    tab: (s) => ({ method: 'manual_company', driver: 'it_users', rows: twoCompanies(s) }),
  },
];

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return String((await runner.query(sql, params))[0].id);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `version-patch-${tenantId.slice(0, 8)}`, `Version patch ${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const chart = await one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, 'Chart', 'FR') RETURNING id`, [tenantId, `C${tenantId.slice(0, 8)}`]);
  const companyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Patch company', 'FR', 'Lyon', $2) RETURNING id`, [tenantId, chart]);
  const secondCompanyId = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Second company', 'FR', 'Nantes', $2) RETURNING id`, [tenantId, chart]);
  const accountId = await one(runner, `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6100, 'Software') RETURNING id`, [tenantId, chart]);
  for (const [id, headcount, itUsers] of [[companyId, 80, 30], [secondCompanyId, 20, 70]] as const) {
    await runner.query(`INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users, turnover) VALUES ($1, $2, 2026, $3, $4, 0)`,
      [tenantId, id, headcount, itUsers]);
  }
  return { tenantId, companyId, secondCompanyId, accountId };
}

/** A line of the nature with its 2026 version, allocated as `start` says (by the Allocations tab). */
async function line(h: Harness, runner: QueryRunner, s: Seed, nature: Nature, start: Record<string, unknown> | null) {
  const created = await h.lines.create({
    nature, product_name: `Patch ${nature} line`, paying_company_id: s.companyId, account_id: s.accountId, currency: 'EUR', effective_start: '2026-01-01',
  }, null, { manager: runner.manager });
  const itemId = String(created.id);
  await h.routes[nature].createForItem(itemId, { version_name: 'Y2026', budget_year: 2026, as_of_date: '2026-01-01', input_grain: 'annual' }, request(runner));
  const [{ id: versionId }] = await runner.query(`SELECT id FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2`, [s.tenantId, itemId]);
  if (start) await h.tab[nature].put(versionId, { ...start, base_signature: null }, null, { manager: runner.manager, tenantId: s.tenantId });
  return { itemId, versionId: String(versionId) };
}

const request = (runner: QueryRunner) => ({ queryRunner: { manager: runner.manager }, user: { sub: null } });

/** The audit rows `write` adds, attribution and ids set aside. */
async function rowsWrittenBy(runner: QueryRunner, s: Seed, write: () => Promise<unknown>) {
  const known = new Set((await runner.query(`SELECT id FROM audit_log WHERE tenant_id = $1`, [s.tenantId])).map((row: any) => row.id));
  await write();
  const rows = await runner.query(
    `SELECT id, table_name, record_id, action, before_json, after_json FROM audit_log WHERE tenant_id = $1 ORDER BY created_at, id`, [s.tenantId]);
  // A split's rows as a set: the order they were sent in is not part of the gesture.
  const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null, (key, item) => (['id', 'created_at', 'updated_at'].includes(key) ? '<volatile>'
    : Array.isArray(item) ? [...item].sort((a: any, b: any) => `${a?.company_id}:${a?.department_id}`.localeCompare(`${b?.company_id}:${b?.department_id}`)) : item)));
  return rows.filter((row: any) => !known.has(row.id))
    .map((row: any) => JSON.stringify({ table: row.table_name, action: row.action, record: row.record_id, before: strip(row.before_json), after: strip(row.after_json) }))
    .sort();
}

async function allocation(runner: QueryRunner, s: Seed, versionId: string) {
  const [version] = await runner.query(`SELECT allocation_method, allocation_driver FROM spend_versions WHERE tenant_id = $1 AND id = $2`, [s.tenantId, versionId]);
  const rows = await runner.query(
    `SELECT company_id, department_id, allocation_pct::text AS pct FROM spend_allocations WHERE tenant_id = $1 AND version_id = $2 ORDER BY company_id`,
    [s.tenantId, versionId]);
  return { method: version.allocation_method, driver: version.allocation_driver, rows };
}

async function runGesture(h: Harness, nature: Nature, gesture: Gesture) {
  const runner = h.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seed(runner);
    const { itemId, versionId } = await line(h, runner, s, nature, gesture.start(s));

    await runner.query('SAVEPOINT tab');
    const tabRows = await rowsWrittenBy(runner, s, () => h.tab[nature].put(versionId, { ...gesture.tab(s), base_signature: null }, null, { manager: runner.manager, tenantId: s.tenantId }));
    const tabState = await allocation(runner, s, versionId);
    await runner.query('ROLLBACK TO SAVEPOINT tab');

    let answer: any;
    const routeRows = await rowsWrittenBy(runner, s, async () => {
      answer = await h.routes[nature].updateForItem(itemId, { id: versionId, ...gesture.patch }, request(runner));
    });
    const routeState = await allocation(runner, s, versionId);
    assert.deepEqual(routeRows, tabRows, `the route writes the audit rows of the Allocations tab`);
    assert.deepEqual(routeState, tabState, `the route leaves the allocation the Allocations tab leaves`);
    assert.deepEqual({ method: answer.allocation_method, driver: answer.allocation_driver }, { method: tabState.method, driver: tabState.driver },
      'the route answers the version as stored');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for version-patch-allocation.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { BudgetLinesService } = require('../budget-lines.service');
  const { SpendVersionsController } = require('../spend-versions.controller');
  const { CapexVersionsController } = require('../capex-versions.controller');
  const { SpendAllocationsService, CapexAllocationsService } = require('../spend-allocations.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const h: Harness = {
    app,
    dataSource: app.get(DataSource),
    lines: app.get(BudgetLinesService, { strict: false }),
    routes: { opex: app.get(SpendVersionsController, { strict: false }), capex: app.get(CapexVersionsController, { strict: false }) },
    tab: { opex: app.get(SpendAllocationsService, { strict: false }), capex: app.get(CapexAllocationsService, { strict: false }) },
  };
  try {
    const failures: string[] = [];
    for (const nature of ['opex', 'capex'] as const) {
      for (const gesture of GESTURES) {
        try {
          await runGesture(h, nature, gesture);
        } catch (error) {
          failures.push(`${nature}, ${gesture.name}: ${(error as Error).message}`);
        }
      }
    }
    if (failures.length) throw new Error(`${failures.length} of ${GESTURES.length * 2} cases failed:\n${failures.join('\n\n')}`);
    console.log(`version-patch-allocation.integration.spec.ts passed (${GESTURES.length * 2} cases)`);
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
