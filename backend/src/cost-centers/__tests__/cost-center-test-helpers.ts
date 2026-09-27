import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CostCentersCsvService } from '../cost-centers-csv.service';
import { CostCentersDeleteService } from '../cost-centers-delete.service';
import { CostCenterContext, CostCentersService } from '../cost-centers.service';

// Shared by the cost-center integration specs (not a spec itself: the runner
// only picks up *.spec.ts files).

export async function setCurrentTenant(runner: QueryRunner | EntityManager, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

export async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `cc-${tag}-${tenantId.slice(0, 8)}`, `Cost centers test ${tag}`],
  );
  await setCurrentTenant(runner, tenantId);
  return tenantId;
}

export async function seedCompany(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  opts: { disabled?: boolean } = {},
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, disabled_at)
     VALUES ($1, $2, 'FR', 'Paris', $3, $4) RETURNING id`,
    [tenantId, name, opts.disabled ? 'disabled' : 'enabled', opts.disabled ? new Date(Date.now() - 86_400_000) : null],
  );
  return row.id;
}

export async function seedUser(
  runner: QueryRunner,
  tenantId: string,
  email: string,
  status: 'enabled' | 'disabled' = 'enabled',
): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Test role ${randomUUID().slice(0, 8)}`],
  );
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, email, role_id, status, first_name, last_name)
     VALUES ($1, $2, $3, $4, 'Test', $5) RETURNING id`,
    [tenantId, email, role.id, status, email.split('@')[0]],
  );
  return user.id;
}

let itemNumber = 900_000;

/** One OPEX or CAPEX line, written directly (the item services are another implementer's). */
export async function seedLine(
  runner: QueryRunner | EntityManager,
  kind: 'opex' | 'capex',
  tenantId: string,
  costCenterId: string | null,
): Promise<string> {
  itemNumber += 1;
  if (kind === 'opex') {
    const [row] = await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, cost_center_id)
       VALUES ($1, 'Cost center test line', 'EUR', '2026-01-01', $2, $3) RETURNING id`,
      [tenantId, itemNumber, costCenterId],
    );
    return row.id;
  }
  const [row] = await runner.query(
    `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number, cost_center_id)
     VALUES ($1, 'Cost center test line', 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $2, $3) RETURNING id`,
    [tenantId, itemNumber, costCenterId],
  );
  return row.id;
}

export function services(manager: EntityManager) {
  const audit = new AuditService(manager.getRepository(AuditLog));
  const svc = new CostCentersService(audit);
  return {
    svc,
    del: new CostCentersDeleteService(svc, audit),
    csv: new CostCentersCsvService(svc),
  };
}

export function context(manager: EntityManager, tenantId: string, userId: string | null = null): CostCenterContext {
  return { manager, tenantId, userId };
}

let savepointCounter = 0;

/** Runs a call that must be refused, inside its own savepoint so the transaction stays usable. */
export async function expectRefused(runner: QueryRunner, pattern: RegExp, run: () => Promise<unknown>) {
  const savepoint = `cc_test_sp_${savepointCounter += 1}`;
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

/** Runs `fn` in a committed transaction (for the specs that need parallel connections). */
export async function committed<T>(fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const result = await fn(runner);
    await runner.commitTransaction();
    return result;
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
  }
}

export async function openTenantTransaction(tenantId: string): Promise<QueryRunner> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await setCurrentTenant(runner, tenantId);
  return runner;
}

export async function closeRunner(runner: QueryRunner) {
  if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
  await runner.release();
}

/** Waits until the backend `pid` is blocked on a lock (row or advisory). */
export async function waitUntilBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${pid} never waited for the lock`);
}

export async function backendPid(runner: QueryRunner): Promise<number> {
  const [{ pid }] = await runner.query(`SELECT pg_backend_pid() AS pid`);
  return pid;
}

/** Removes a committed test tenant: lines before nodes, nodes before companies and users. */
export async function deleteTenant(tenantId: string) {
  await dataSource.transaction(async (manager) => {
    await setCurrentTenant(manager, tenantId);
    for (const table of ['spend_items', 'capex_items', 'cost_centers', 'audit_log', 'companies', 'users', 'roles']) {
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}
