import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { AnalyticsCategory } from '../analytics-category.entity';
import { AnalyticsAxesService } from '../analytics-axes.service';
import { AnalyticsCategoriesCsvService } from '../analytics-categories-csv.service';
import { AnalyticsCategoriesService } from '../analytics-categories.service';
import { AnalyticsContext } from '../analytics-context';

// Shared by the analytics integration specs (not a spec itself: the runner
// only picks up *.spec.ts files). Every spec runs in a transaction rolled back
// at the end, so nothing reaches the database.

export async function setCurrentTenant(runner: QueryRunner | EntityManager, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** A tenant inserted raw (no bootstrap, so no default dimension yet), made current. */
export async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ax-${tag}-${tenantId.slice(0, 8)}`, `Analytics test ${tag}`],
  );
  await setCurrentTenant(runner, tenantId);
  return tenantId;
}

let itemNumber = 910_000;

/**
 * One OPEX or CAPEX line, written directly (the item services are another implementer's). Both
 * natures live in `spend_items` since lot Z1: a CAPEX line has its title in `product_name` and
 * its CPX number in `legacy_number`; the counter keeps `item_number` unique across both.
 */
export async function seedLine(runner: QueryRunner, kind: 'opex' | 'capex', tenantId: string): Promise<string> {
  itemNumber += 1;
  if (kind === 'opex') {
    const [row] = await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number)
       VALUES ($1, 'Analytics test line', 'EUR', '2026-01-01', $2) RETURNING id`,
      [tenantId, itemNumber],
    );
    return row.id;
  }
  const [row] = await runner.query(
    `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number)
     VALUES ($1, 'capex', 'Analytics test line', 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $2, 'CPX-' || $2::int) RETURNING id`,
    [tenantId, itemNumber],
  );
  return row.id;
}

/** A line's value on one dimension, written raw (the item write gate is another implementer's); one table for both natures since lot Z1. */
export async function linkValue(
  runner: QueryRunner,
  kind: 'opex' | 'capex',
  tenantId: string,
  itemId: string,
  axisId: string,
  categoryId: string,
) {
  void kind;
  await runner.query(
    `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
    [tenantId, itemId, axisId, categoryId],
  );
}

export function services(manager: EntityManager) {
  const audit = new AuditService(manager.getRepository(AuditLog));
  const values = new AnalyticsCategoriesService(manager.getRepository(AnalyticsCategory), audit);
  return {
    axes: new AnalyticsAxesService(audit),
    values,
    csv: new AnalyticsCategoriesCsvService(values),
  };
}

export function context(manager: EntityManager, tenantId: string, userId: string | null = null): AnalyticsContext {
  return { manager, tenantId, userId };
}

export function csvFile(content: string, name = 'analytics_values.csv'): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8'), originalname: name } as Express.Multer.File;
}

let savepointCounter = 0;

/** Runs a call that must be refused, inside its own savepoint so the transaction stays usable. */
export async function expectRefused(runner: QueryRunner, pattern: RegExp, run: () => Promise<unknown>) {
  const savepoint = `ax_test_sp_${savepointCounter += 1}`;
  await runner.query(`SAVEPOINT ${savepoint}`);
  let refused = false;
  try {
    await run();
  } catch (error: any) {
    refused = true;
    await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    const text = [error?.message, error?.response?.message, error?.constraint, error?.detail].filter(Boolean).join(' | ');
    assert.match(text, pattern);
  }
  if (!refused) {
    await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    assert.fail(`the call should have been refused with ${pattern}`);
  }
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

export async function runSpecs(name: string, tests: Array<() => Promise<void>>) {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of tests) {
      try {
        await test();
      } catch (err) {
        console.error(`${test.name}:`, err);
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`${name}: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log(`${name}: ok`);
}
