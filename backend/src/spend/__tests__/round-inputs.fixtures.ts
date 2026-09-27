import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendAmountsService } from '../spend-amounts.service';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { SpendItemsCsvService } from '../spend-items-csv.service';
import { CapexAmountsService } from '../../capex/capex-amounts.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { FreezeService } from '../../freeze/freeze.service';

// Shared fixtures of the round-inputs and budget-rows specs (not a spec itself).
// Every seed runs inside the caller's transaction, which the spec rolls back.

export type Kind = 'opex' | 'capex';
export type Measure = 'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing';
export const MEASURES: Measure[] = ['planned', 'forecast', 'committed', 'actual', 'expected_landing'];

export const noFreeze = { assertNotFrozen: async () => undefined };

export type AuditEntry = { table: string; recordId?: string | null; action: string; before?: any; after?: any; userId?: string | null };

/** An audit double that keeps what was logged; `failOn` throws for a matching entry. */
export function captureAudit(failOn?: (entry: AuditEntry) => boolean) {
  const entries: AuditEntry[] = [];
  return {
    entries,
    log: async (entry: AuditEntry) => {
      if (failOn?.(entry)) throw new Error(`forced failure on ${entry.table} ${entry.recordId}`);
      entries.push(entry);
    },
  };
}

export function realFreeze() {
  return new FreezeService(undefined as any, undefined as any, undefined as any, undefined as any);
}

export function amountsService(kind: Kind, audit: unknown = captureAudit(), freeze: unknown = noFreeze): {
  bulkUpsert: (...args: any[]) => Promise<any>;
  listByYear: (...args: any[]) => Promise<any>;
} {
  return kind === 'opex'
    ? new SpendAmountsService(undefined as any, undefined as any, undefined as any, audit as any, freeze as any)
    : new CapexAmountsService(undefined as any, undefined as any, audit as any, freeze as any);
}

/** The service each scope's copy and clear routes call. */
export function budgetOperations(kind: Kind, audit: unknown = captureAudit(), freeze: unknown = noFreeze): {
  copyBudgetColumn: (...args: any[]) => Promise<any>;
  clearBudgetColumn: (...args: any[]) => Promise<any>;
} {
  if (kind === 'opex') {
    return new SpendBudgetOperationsService(
      undefined as any, undefined as any, undefined as any, undefined as any, audit as any, freeze as any, undefined as any,
    );
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[5] = audit;
  args[6] = freeze;
  return new (CapexItemsService as any)(...args);
}

/** The legacy item CSV importer of each scope, on the real service class. */
export function itemCsvImporter(kind: Kind, audit: unknown = captureAudit()): { writeImportedTotals: (...args: any[]) => Promise<void> } {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 11 }, () => undefined);
    args[7] = audit;
    args[8] = noFreeze;
    return new (SpendItemsCsvService as any)(...args);
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[5] = audit;
  args[6] = noFreeze;
  return new (CapexItemsService as any)(...args);
}

export const TABLES = {
  opex: { items: 'spend_items', versions: 'spend_versions', amounts: 'spend_amounts', rounds: 'spend_round_inputs' },
  capex: { items: 'capex_items', versions: 'capex_versions', amounts: 'capex_amounts', rounds: 'capex_round_inputs' },
} as const;

export function period(month: number, year: number) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

export async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `rnd-${tag}-${tenantId.slice(0, 8)}`, `Round inputs test ${tag}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

export async function seedItem(runner: QueryRunner, kind: Kind, tenantId: string, itemNumber = 1, name = 'Round inputs line') {
  const itemId = randomUUID();
  if (kind === 'opex') {
    await runner.query(
      `INSERT INTO spend_items (id, tenant_id, product_name, currency, effective_start, item_number)
       VALUES ($1, $2, $3, 'EUR', '2020-01-01', $4)`,
      [itemId, tenantId, name, itemNumber],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (id, tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
       VALUES ($1, $2, $3, 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', $4)`,
      [itemId, tenantId, name, itemNumber],
    );
  }
  return itemId;
}

export async function seedVersion(runner: QueryRunner, kind: Kind, tenantId: string, itemId: string, year: number, inputGrain = 'monthly') {
  const versionId = randomUUID();
  if (kind === 'opex') {
    await runner.query(
      `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [versionId, tenantId, itemId, `Y${year}`, inputGrain, `${year}-01-01`, year],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_versions (id, tenant_id, capex_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'default')`,
      [versionId, tenantId, itemId, `Y${year}`, inputGrain, `${year}-01-01`, year],
    );
  }
  return versionId;
}

/** Twelve months of the given measures (decimal strings or numbers); other measures stay at their default. */
export async function seedMonths(
  runner: QueryRunner,
  kind: Kind,
  tenantId: string,
  versionId: string,
  year: number,
  values: Partial<Record<Measure, Array<string | number>>>,
) {
  const measures = Object.keys(values) as Measure[];
  for (let month = 1; month <= 12; month++) {
    await runner.query(
      `INSERT INTO ${TABLES[kind].amounts} (tenant_id, version_id, period${measures.map((m) => `, ${m}`).join('')})
       VALUES ($1, $2, $3${measures.map((_, i) => `, $${i + 4}`).join('')})`,
      [tenantId, versionId, period(month, year), ...measures.map((m) => String(values[m]![month - 1]))],
    );
  }
}

/** One line, its version for `year` and twelve seeded months per measure given. */
export async function seedLine(
  runner: QueryRunner,
  kind: Kind,
  tenantId: string,
  year: number,
  values: Partial<Record<Measure, Array<string | number>>> = {},
  itemNumber = 1,
) {
  const itemId = await seedItem(runner, kind, tenantId, itemNumber);
  const versionId = await seedVersion(runner, kind, tenantId, itemId, year);
  if (Object.keys(values).length > 0) await seedMonths(runner, kind, tenantId, versionId, year, values);
  return { itemId, versionId };
}

/** The twelve stored values of one measure as numeric strings ('0.00' for a missing month). */
export async function readMeasure(runner: QueryRunner, kind: Kind, versionId: string, measure: Measure, year: number): Promise<string[]> {
  const rows: Array<{ period: string; value: string | null }> = await runner.query(
    `SELECT to_char(period, 'YYYY-MM-DD') AS period, ${measure}::text AS value
     FROM ${TABLES[kind].amounts} WHERE version_id = $1 ORDER BY period`,
    [versionId],
  );
  const byPeriod = new Map(rows.map((r) => [r.period, r.value ?? '0.00']));
  return Array.from({ length: 12 }, (_, i) => byPeriod.get(period(i + 1, year)) ?? '0.00');
}

export type StoredRecord = {
  id: string;
  tenant_id: string;
  version_id: string;
  measure: string;
  period_start: string;
  period_end: string;
  method: string;
  spread_profile_name: string | null;
  last_calculation: any;
  updated_at: Date;
  updated_by: string | null;
};

export async function readRecords(runner: QueryRunner, kind: Kind, versionId: string): Promise<Record<string, StoredRecord>> {
  const rows: StoredRecord[] = await runner.query(
    `SELECT id, tenant_id, version_id, measure, to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end, method, spread_profile_name, last_calculation, updated_at, updated_by
     FROM ${TABLES[kind].rounds} WHERE version_id = $1`,
    [versionId],
  );
  return Object.fromEntries(rows.map((r) => [r.measure, r]));
}

export async function findVersion(runner: QueryRunner, kind: Kind, itemId: string, year: number) {
  const column = kind === 'opex' ? 'spend_item_id' : 'capex_item_id';
  const rows = await runner.query(
    `SELECT id, input_grain::text AS input_grain FROM ${TABLES[kind].versions} WHERE ${column} = $1 AND budget_year = $2`,
    [itemId, year],
  );
  return rows[0] as { id: string; input_grain: string } | undefined;
}

export async function freezeColumn(runner: QueryRunner, kind: Kind, tenantId: string, year: number, column: string) {
  await runner.query(
    `INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, $3, $4, true)`,
    [tenantId, year, kind, column],
  );
}

/** Store budget column settings on the tenant (merged onto the product defaults when read). */
export async function setBudgetColumns(runner: QueryRunner, tenantId: string, settings: Record<string, unknown>) {
  await runner.query(
    `UPDATE tenants SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{budget_columns}', $2::jsonb, true) WHERE id = $1`,
    [tenantId, JSON.stringify(settings)],
  );
}

/** Run `fn` in a transaction that is always rolled back. */
export async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
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

/** Run `fn` inside a savepoint that is rolled back, like the request transaction after an error. */
export async function underSavepoint<T>(runner: QueryRunner, fn: () => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT spec_request');
  try {
    const result = await fn();
    await runner.query('RELEASE SAVEPOINT spec_request');
    return result;
  } catch (err) {
    await runner.query('ROLLBACK TO SAVEPOINT spec_request');
    throw err;
  }
}

export function repeat<T>(value: T, count: number): T[] {
  return Array.from({ length: count }, () => value);
}

/** Runs the named tests, collects failures, and exits non-zero when any fails. */
export async function runSpecs(name: string, tests: Array<[string, () => Promise<void>]>) {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const [label, test] of tests) {
      try {
        await test();
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`${name}: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`${name}: ok`);
}

export { assert };
