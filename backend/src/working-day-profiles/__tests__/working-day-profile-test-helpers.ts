import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { WorkingDayProfilesCsvService } from '../working-day-profiles-csv.service';
import { WorkingDayProfilesDeleteService } from '../working-day-profiles-delete.service';
import { WorkingDayProfileContext, WorkingDayProfilesService } from '../working-day-profiles.service';

// Shared by the calendar integration specs (not a spec itself: the runner
// only picks up *.spec.ts files).

/** France 218: the working days of a year of 218 days. */
export const FR218 = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];

export async function setCurrentTenant(runner: QueryRunner | EntityManager, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

export async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `wdp-${tag}-${tenantId.slice(0, 8)}`, `Calendars test ${tag}`],
  );
  await setCurrentTenant(runner, tenantId);
  return tenantId;
}

let itemNumber = 910_000;

/** One OPEX or CAPEX line with a version for `year`, written directly. */
export async function seedLine(runner: QueryRunner, kind: 'opex' | 'capex', tenantId: string, year = 2026) {
  itemNumber += 1;
  const itemId = randomUUID();
  const versionId = randomUUID();
  if (kind === 'opex') {
    await runner.query(
      `INSERT INTO spend_items (id, tenant_id, product_name, currency, effective_start, item_number)
       VALUES ($1, $2, 'Calendar test line', 'EUR', '2020-01-01', $3)`,
      [itemId, tenantId, itemNumber],
    );
    await runner.query(
      `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year)
       VALUES ($1, $2, $3, $4, 'monthly', $5, $6)`,
      [versionId, tenantId, itemId, `Y${year}`, `${year}-01-01`, year],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (id, tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
       VALUES ($1, $2, 'Calendar test line', 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', $3)`,
      [itemId, tenantId, itemNumber],
    );
    await runner.query(
      `INSERT INTO capex_versions (id, tenant_id, capex_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, $3, $4, 'monthly', $5, $6, 'default')`,
      [versionId, tenantId, itemId, `Y${year}`, `${year}-01-01`, year],
    );
  }
  return { itemId, versionId };
}

/**
 * A column computed from one line priced per day with the calendar, in raw
 * SQL (the round writes are another module's): its round and its line.
 * `measure` is any of the five columns.
 */
export async function seedCalendarRound(
  runner: QueryRunner,
  kind: 'opex' | 'capex',
  tenantId: string,
  versionId: string,
  calendarId: string,
  measure: string,
  year = 2026,
) {
  const rounds = kind === 'opex' ? 'spend_round_inputs' : 'capex_round_inputs';
  const lines = kind === 'opex' ? 'spend_round_input_lines' : 'capex_round_input_lines';
  const [round] = await runner.query(
    `INSERT INTO ${rounds} (tenant_id, version_id, measure, period_start, period_end, method, fte)
     VALUES ($1, $2, $3, $4, $5, 'computed', 1) RETURNING id`,
    [tenantId, versionId, measure, `${year}-01-01`, `${year}-12-31`],
  );
  await runner.query(
    `INSERT INTO ${lines}
       (tenant_id, round_input_id, sort, quantity_unit, quantity, unit_price, price_basis, frequency, working_day_profile_id, period_start, period_end)
     VALUES ($1, $2, 1, 'people', 1, 400, 'per_day', 'per_month', $3, $4, $5)`,
    [tenantId, round.id, calendarId, `${year}-01-01`, `${year}-12-31`],
  );
}

export function services(manager: EntityManager) {
  const audit = new AuditService(manager.getRepository(AuditLog));
  const svc = new WorkingDayProfilesService(audit);
  return {
    svc,
    del: new WorkingDayProfilesDeleteService(svc, audit),
    csv: new WorkingDayProfilesCsvService(svc),
  };
}

export function context(manager: EntityManager, tenantId: string, userId: string | null = null): WorkingDayProfileContext {
  return { manager, tenantId, userId };
}

export async function auditCount(runner: QueryRunner, tenantId: string, action?: string): Promise<number> {
  const [row] = await runner.query(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'working_day_profiles' AND ($2::text IS NULL OR action = $2::text)`,
    [tenantId, action ?? null],
  );
  return Number(row.n);
}

let savepointCounter = 0;

/** Runs a call that must be refused, inside its own savepoint so the transaction stays usable. */
export async function expectRefused(runner: QueryRunner, pattern: RegExp, run: () => Promise<unknown>) {
  const savepoint = `wdp_test_sp_${savepointCounter += 1}`;
  await runner.query(`SAVEPOINT ${savepoint}`);
  let refused = false;
  try {
    await run();
  } catch (error: any) {
    refused = true;
    await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    assert.match(String(error?.message || error), pattern);
  }
  if (!refused) assert.fail(`the call should have been refused with ${pattern}`);
}

/** One transaction, rolled back at the end whatever happens. */
export async function withRollback(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** Runs each test, collects the failures and exits non-zero when any failed. */
export async function runSpecs(name: string, tests: Array<() => Promise<void>>) {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of tests) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) throw new Error(`${name}: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  console.log(`${name}: ok`);
}
