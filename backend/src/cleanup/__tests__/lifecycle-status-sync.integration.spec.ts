import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { LIFECYCLE_STATUS_TABLES, LifecycleStatusSyncService, LifecycleStatusTable } from '../lifecycle-status-sync.service';
import { ContractsService } from '../../contracts/contracts.service';
import { CapexItemsService, SpendItemsService } from '../../spend/spend-items.service';
import { ItemNumberService } from '../../common/item-number.service';
import { withRlsLifted } from '../../common/__tests__/rls-bypass.fixtures';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  setTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// The hourly `lifecycle-status-sync` task sets the stored status from the end
// of validity on every table where the status is derived from it (the list
// matches the catalog): a past date disables, an empty or future date enables.
// Only `status` changes: no audit row, `updated_at` kept, the search index
// follows. One tenant's pass never touches another tenant's rows, even with RLS
// lifted. Frozen tenants are processed, tenants being deleted are not, and
// `applications` is left alone. A row locked by an edit skips its table until
// the next run, and an edit that disables "now" while the task waits on it is
// never undone. The status-change emails read the status before an edit from
// the stored end of validity, so an edit right after the date passed (task not
// run yet) sends nothing, and the task itself sends nothing.

const PAST = '2021-06-30T12:00:00.000Z';
const FUTURE = '2099-06-30T12:00:00.000Z';
const OLD_UPDATED_AT = '2021-03-04T05:06:07.000Z';

// The tables with an AFTER UPDATE `trg_search_index_*` trigger (the `spend_items` rows of the
// table list are OPEX lines, indexed as `spend_items`).
const INDEXED_TABLES = [
  'accounts', 'analytics_categories', 'business_processes', 'companies',
  'contracts', 'departments', 'spend_items', 'suppliers',
];

// A CAPEX line: a `spend_items` row of nature capex (lot Z1), with what the CAPEX routes require.
const CAPEX_LINE = { nature: 'capex', ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium' };

type Parents = { coaId: string; axisId: string; companyId: string; supplierId: string };
const NO_PARENTS = {} as Parents;

// The required columns of one row per table (labels and numbers unique per tenant).
const ROW: Record<LifecycleStatusTable, (p: Parents, n: number, label: string) => Record<string, unknown>> = {
  accounts: (p, n, label) => ({ coa_id: p.coaId, account_number: 9000 + n, account_name: label }),
  analytics_axes: (_p, n, label) => ({ code: `sync-${n}`, name: label }),
  analytics_categories: (p, _n, label) => ({ axis_id: p.axisId, name: label }),
  business_processes: (_p, _n, label) => ({ name: label }),
  companies: (_p, _n, label) => ({ name: label, country_iso: 'FR', city: 'Lyon' }),
  contracts: (p, _n, label) => ({ name: label, company_id: p.companyId, supplier_id: p.supplierId, start_date: '2020-01-01' }),
  cost_centers: (_p, n, label) => ({ code: `SYNC-${n}`, kind: 'group', name: label }),
  departments: (p, _n, label) => ({ company_id: p.companyId, name: label }),
  spend_items: (_p, n, label) => ({ product_name: label, currency: 'EUR', effective_start: '2020-01-01', item_number: n }),
  suppliers: (_p, _n, label) => ({ name: label }),
  working_day_profiles: (_p, n, label) => ({ code: `SYNC-${n}`, name: label }),
};

// Stored state -> status once the task ran.
const CASES = {
  stale: { status: 'enabled', disabled_at: 'recent', expected: 'disabled' },
  ahead: { status: 'enabled', disabled_at: FUTURE, expected: 'enabled' },
  open: { status: 'enabled', disabled_at: null, expected: 'enabled' },
  ended: { status: 'disabled', disabled_at: PAST, expected: 'disabled' },
  // Never written by the services (a disabled status always gets a date); the task restores the derivation.
  disabledNoDate: { status: 'disabled', disabled_at: null, expected: 'enabled' },
  disabledAhead: { status: 'disabled', disabled_at: FUTURE, expected: 'enabled' },
} as const;
type CaseName = keyof typeof CASES;

let counter = 0;

function task(): LifecycleStatusSyncService {
  return new LifecycleStatusSyncService(dataSource, { register: () => undefined } as any);
}

async function seedParents(runner: QueryRunner, tenantId: string): Promise<Parents> {
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  return {
    coaId: await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'SYNC', 'Sync chart', 'FR') RETURNING id`, [tenantId]),
    axisId: await one(`INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'sync-parent', 'Sync parent axis') RETURNING id`, [tenantId]),
    companyId: await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Sync parent company', 'FR', 'Lyon') RETURNING id`, [tenantId]),
    supplierId: await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Sync parent supplier') RETURNING id`, [tenantId]),
  };
}

async function seedRow(
  runner: QueryRunner,
  tenantId: string,
  parents: Parents,
  table: LifecycleStatusTable,
  state: { status: string; disabled_at: string | null },
  extra: Record<string, unknown> = {},
): Promise<string> {
  counter += 1;
  const disabledAt = state.disabled_at === 'recent' ? new Date(Date.now() - 60 * 60 * 1000).toISOString() : state.disabled_at;
  const values: Record<string, unknown> = {
    tenant_id: tenantId,
    ...ROW[table](parents, counter, `Sync ${table} ${counter}`),
    status: state.status,
    disabled_at: disabledAt,
    updated_at: OLD_UPDATED_AT,
    ...extra,
  };
  const columns = Object.keys(values);
  // Table and column names come from the constants above only.
  const [row] = await runner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(values),
  );
  return row.id;
}

async function readRow(runner: QueryRunner, table: LifecycleStatusTable, id: string) {
  const [row] = await runner.query(`SELECT status::text AS status, updated_at FROM ${table} WHERE id = $1`, [id]);
  return row as { status: string; updated_at: Date };
}

async function auditCount(runner: QueryRunner, tenantId: string): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  return row.n;
}

async function testCatalogMatchesTableList() {
  const rows: Array<{ table_name: string }> = await dataSource.query(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.columns d
         ON d.table_schema = c.table_schema AND d.table_name = c.table_name AND d.column_name = 'disabled_at'
      WHERE c.table_schema = 'public' AND c.column_name = 'status' AND c.udt_name = 'status_state'
        -- Dormant since lot Z1 (its lines are in spend_items), dropped by lot Z2.
        AND c.table_name <> 'capex_items'
      ORDER BY 1`,
  );
  assert.deepEqual(
    rows.map((row) => row.table_name),
    [...LIFECYCLE_STATUS_TABLES].sort(),
    'every status_state table with an end of validity is in LIFECYCLE_STATUS_TABLES',
  );
}

async function testSetsStatusFromEndOfValidity() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'lifecycle-sync');
    const parents = await seedParents(runner, tenantId);
    const ids = {} as Record<LifecycleStatusTable, Record<CaseName, string>>;
    for (const table of LIFECYCLE_STATUS_TABLES) {
      ids[table] = {} as Record<CaseName, string>;
      for (const [name, state] of Object.entries(CASES) as Array<[CaseName, (typeof CASES)[CaseName]]>) {
        ids[table][name] = await seedRow(runner, tenantId, parents, table, state);
      }
    }
    const capexIds = {} as Record<CaseName, string>;
    for (const [name, state] of Object.entries(CASES) as Array<[CaseName, (typeof CASES)[CaseName]]>) {
      capexIds[name] = await seedRow(runner, tenantId, parents, 'spend_items', state, CAPEX_LINE);
    }
    const auditBefore = await auditCount(runner, tenantId);

    const result = await task().syncTenant(tenantId, { manager: runner.manager });

    assert.deepEqual([result.skipped, result.errors], [[], []], 'nothing skipped, no error');
    for (const [name, state] of Object.entries(CASES) as Array<[CaseName, (typeof CASES)[CaseName]]>) {
      const row = await readRow(runner, 'spend_items', capexIds[name]);
      assert.equal(row.status, state.expected, `CAPEX line ${name}: status ${state.expected}`);
      assert.equal(new Date(row.updated_at).toISOString(), OLD_UPDATED_AT, `CAPEX line ${name}: updated_at kept`);
    }
    for (const table of LIFECYCLE_STATUS_TABLES) {
      const expected = table === 'spend_items' ? { disabled: 2, enabled: 4 } : { disabled: 1, enabled: 2 };
      assert.deepEqual(result.changes[table], expected, `${table}: the stale rows disabled, the others enabled`);
      for (const [name, state] of Object.entries(CASES) as Array<[CaseName, (typeof CASES)[CaseName]]>) {
        const row = await readRow(runner, table, ids[table][name]);
        assert.equal(row.status, state.expected, `${table} ${name}: status ${state.expected}`);
        assert.equal(new Date(row.updated_at).toISOString(), OLD_UPDATED_AT, `${table} ${name}: updated_at kept`);
      }
    }
    assert.equal(await auditCount(runner, tenantId), auditBefore, 'no audit row');

    // The AFTER UPDATE search index triggers refresh the indexed status of the rows that changed.
    const staleIds = [...LIFECYCLE_STATUS_TABLES.map((table) => ids[table].stale), capexIds.stale];
    const indexed: Array<{ entity_type: string; status: string }> = await runner.query(
      `SELECT entity_type, status FROM search_index WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[]) ORDER BY entity_type`,
      [tenantId, staleIds],
    );
    assert.deepEqual(
      indexed.map((row) => [row.entity_type, row.status]),
      [...INDEXED_TABLES, 'capex_items'].sort().map((table) => [table, 'disabled']),
      'the search index reads the new status (the CAPEX line under its own type)',
    );

    const again = await task().syncTenant(tenantId, { manager: runner.manager });
    assert.deepEqual(again, { changes: {}, skipped: [], errors: [] }, 'a second run changes nothing');
  });
}

async function testOtherTenantUntouched() {
  // RLS no longer binds `app` on these tables: the tenant predicate alone keeps the other tenant out.
  await withRlsLifted([...LIFECYCLE_STATUS_TABLES], async (runner) => {
    const tenantA = await seedTenant(runner, 'lifecycle-a');
    const parentsA = await seedParents(runner, tenantA);
    const staleA = new Map<LifecycleStatusTable, string>();
    for (const table of LIFECYCLE_STATUS_TABLES) staleA.set(table, await seedRow(runner, tenantA, parentsA, table, CASES.stale));

    const tenantB = await seedTenant(runner, 'lifecycle-b');
    const parentsB = await seedParents(runner, tenantB);
    const staleB = new Map<LifecycleStatusTable, string>();
    for (const table of LIFECYCLE_STATUS_TABLES) staleB.set(table, await seedRow(runner, tenantB, parentsB, table, CASES.stale));

    const resultA = await task().syncTenant(tenantA, { manager: runner.manager });
    for (const table of LIFECYCLE_STATUS_TABLES) {
      assert.deepEqual(resultA.changes[table], { disabled: 1, enabled: 0 }, `${table}: only tenant A's row`);
      assert.equal((await readRow(runner, table, staleA.get(table)!)).status, 'disabled', `${table}: tenant A disabled`);
      assert.equal((await readRow(runner, table, staleB.get(table)!)).status, 'enabled', `${table}: tenant B untouched`);
    }

    const resultB = await task().syncTenant(tenantB, { manager: runner.manager });
    for (const table of LIFECYCLE_STATUS_TABLES) {
      assert.deepEqual(resultB.changes[table], { disabled: 1, enabled: 0 }, `${table}: tenant B's own pass`);
      assert.equal((await readRow(runner, table, staleB.get(table)!)).status, 'disabled', `${table}: tenant B disabled`);
    }
  });
}

async function testRunTenantScope() {
  await inRolledBackTransaction(async (runner) => {
    const seeded: Record<string, { tenantId: string; capexId: string }> = {};
    for (const [tag, status, deleted] of [
      ['active', 'active', false],
      ['frozen', 'frozen', false],
      ['deleting', 'deleting', false],
      ['deleted-at', 'active', true],
    ] as const) {
      const tenantId = await seedTenant(runner, `lifecycle-${tag}`);
      await runner.query(
        `UPDATE tenants SET status = $2, deleted_at = CASE WHEN $3 THEN now() END WHERE id = $1`,
        [tenantId, status, deleted],
      );
      seeded[tag] = { tenantId, capexId: await seedRow(runner, tenantId, NO_PARENTS, 'spend_items', CASES.stale, CAPEX_LINE) };
    }
    await setTenant(runner, seeded.active.tenantId);
    // An application's status is written with no date: the task never reads that table.
    const [app] = await runner.query(
      `INSERT INTO applications (tenant_id, name, status, disabled_at) VALUES ($1, 'Retired application', 'disabled', NULL) RETURNING id`,
      [seeded.active.tenantId],
    );

    const summary = await task().run({ manager: runner.manager });

    assert.deepEqual(summary.errors, [], 'every tenant processed');
    const expected: Record<string, string> = { active: 'disabled', frozen: 'disabled', deleting: 'enabled', 'deleted-at': 'enabled' };
    for (const [tag, row] of Object.entries(seeded)) {
      await setTenant(runner, row.tenantId);
      assert.equal((await readRow(runner, 'spend_items', row.capexId)).status, expected[tag], `${tag} tenant: ${expected[tag]}`);
    }
    await setTenant(runner, seeded.active.tenantId);
    const [stored] = await runner.query(`SELECT status, disabled_at FROM applications WHERE id = $1`, [app.id]);
    assert.deepEqual([stored.status, stored.disabled_at], ['disabled', null], 'the application is left as it is');
  });
}

/** A service from named stubs, in constructor order; the arity check fails when the constructor changes. */
function build<T>(ctor: new (...args: any[]) => T, deps: Record<string, unknown>): T {
  assert.equal(ctor.length, Object.keys(deps).length, `${ctor.name}: the constructor changed, update the stubs`);
  return new ctor(...Object.values(deps));
}

function notifier(sent: any[]) {
  return { notifyStatusChange: (payload: any) => { sent.push({ type: payload.itemType, old: payload.oldStatus, next: payload.newStatus }); } };
}

/** A line service of either nature: `CapexItemsService` declares no constructor of its own, the arity is its twin's. */
function lineService<T>(ctor: typeof SpendItemsService | typeof CapexItemsService, sent: any[]): T {
  const deps = {
    repo: undefined,
    applications: undefined,
    appSpendLinks: undefined,
    audit: captureAudit(),
    allocationCalculator: undefined,
    budgetOps: undefined,
    fxRates: undefined,
    storage: undefined,
    itemContacts: { syncFromSupplier: async () => undefined },
    notifications: notifier(sent),
    itemNumbers: new ItemNumberService(),
  };
  assert.equal(SpendItemsService.length, Object.keys(deps).length, 'SpendItemsService: the constructor changed, update the stubs');
  return new (ctor as any)(...Object.values(deps)) as T;
}

function contractsService(sent: any[]): ContractsService {
  return build(ContractsService, {
    repo: undefined,
    linksRepo: undefined,
    urlsRepo: undefined,
    attachRepo: undefined,
    audit: captureAudit(),
    unifiedTasks: undefined,
    storage: undefined,
    itemContacts: { syncFromSupplier: async () => undefined },
    notifications: notifier(sent),
  });
}

async function testStatusEmails() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'lifecycle-mail');
    const parents = await seedParents(runner, tenantId);
    const [role] = await runner.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, 'Sync role', 'Sync role', false, false, now(), now()) RETURNING id`,
      [tenantId],
    );
    const users: Array<{ id: string }> = [];
    for (const name of ['owner', 'actor']) {
      const [user] = await runner.query(
        `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status, locale)
         VALUES ($1, $2, $3, $4, 'Sync', 'enabled', 'en') RETURNING id`,
        [tenantId, role.id, `${name}-${tenantId.slice(0, 8)}@example.com`, name],
      );
      users.push(user);
    }
    const [owner, actor] = users;
    // End of validity passed an hour ago, the task has not run: stored status still enabled.
    const capexId = await seedRow(runner, tenantId, parents, 'spend_items', CASES.stale, { ...CAPEX_LINE, owner_it_id: owner.id, paying_company_id: parents.companyId });
    const opexId = await seedRow(runner, tenantId, parents, 'spend_items', CASES.stale, { owner_it_id: owner.id, paying_company_id: parents.companyId });
    const contractId = await seedRow(runner, tenantId, parents, 'contracts', CASES.stale, { owner_user_id: owner.id });

    const sent: any[] = [];
    const capex = lineService<CapexItemsService>(CapexItemsService, sent);
    const opex = lineService<SpendItemsService>(SpendItemsService, sent);
    const contracts = contractsService(sent);
    const opts = { manager: runner.manager };
    const editAll = async (body: Record<string, unknown>) => {
      await capex.update(capexId, body as any, actor.id, opts);
      await opex.update(opexId, body as any, actor.id, opts);
      await contracts.update(contractId, body as any, actor.id, opts);
    };
    const byType = () => [...sent].sort((a, b) => a.type.localeCompare(b.type));

    // An unrelated edit right after the date passed: no status change, no email.
    await runner.query('SAVEPOINT unrelated_edit');
    await editAll({ notes: 'Unrelated edit' });
    assert.deepEqual(sent, [], 'an edit right after the end of validity passed sends no status-change email');
    for (const [label, table, id] of [['CAPEX line', 'spend_items', capexId], ['OPEX line', 'spend_items', opexId], ['contract', 'contracts', contractId]] as const) {
      assert.equal((await readRow(runner, table, id)).status, 'disabled', `${label}: the edit stored the derived status`);
    }
    await runner.query('ROLLBACK TO SAVEPOINT unrelated_edit');

    // Enabling again is a real change, from the status the date gave (not the stale stored one).
    await runner.query('SAVEPOINT reenable');
    await editAll({ status: 'enabled' });
    assert.deepEqual(
      byType(),
      [
        { type: 'capex', old: 'disabled', next: 'enabled' },
        { type: 'contract', old: 'disabled', next: 'enabled' },
        { type: 'opex', old: 'disabled', next: 'enabled' },
      ],
      'enabling a line whose end of validity passed emails disabled -> enabled',
    );
    await runner.query('ROLLBACK TO SAVEPOINT reenable');
    sent.length = 0;

    const result = await task().syncTenant(tenantId, opts);
    assert.deepEqual(
      [result.changes.spend_items, result.changes.contracts],
      [{ disabled: 2, enabled: 0 }, { disabled: 1, enabled: 0 }],
      'the task disabled the two budget lines and the contract',
    );
    assert.deepEqual(sent, [], 'the task itself sends nothing');

    await editAll({ notes: 'Unrelated edit after the task' });
    assert.deepEqual(sent, [], 'after the task, an unrelated edit sends nothing either');
  });
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Committed rows (the task's own transactions must see them), removed afterwards. */
type CommittedTable = 'spend_items' | 'suppliers';
type CommittedSeed = (state: { status: string; disabled_at: string | null }, table: CommittedTable, extra?: Record<string, unknown>) => Promise<string>;

async function withCommittedTenant(fn: (tenantId: string, seed: CommittedSeed) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  let tenantId = '';
  try {
    await runner.startTransaction();
    tenantId = await seedTenant(runner, 'lifecycle-lock');
    await runner.commitTransaction();
    const seed: CommittedSeed = async (state, table, extra = {}) => {
      await runner.startTransaction();
      await setTenant(runner, tenantId);
      const id = await seedRow(runner, tenantId, NO_PARENTS, table, state, extra);
      await runner.commitTransaction();
      return id;
    };
    await fn(tenantId, seed);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    if (tenantId) {
      await dataSource.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        await manager.query(`DELETE FROM spend_items WHERE tenant_id = $1`, [tenantId]);
        await manager.query(`DELETE FROM suppliers WHERE tenant_id = $1`, [tenantId]);
        await manager.query(`DELETE FROM search_index WHERE tenant_id = $1`, [tenantId]);
      });
      await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await runner.release();
  }
}

/** A user's transaction holding a row lock until it ends. */
async function lockRow(tenantId: string, table: CommittedTable, id: string): Promise<QueryRunner> {
  const blocker = dataSource.createQueryRunner();
  await blocker.connect();
  await blocker.startTransaction();
  await setTenant(blocker, tenantId);
  await blocker.query(`SELECT id FROM ${table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  return blocker;
}

async function waitForLockWait(table: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const [row] = await dataSource.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE $1 AND query LIKE '%IS DISTINCT FROM%'`,
      [`%UPDATE ${table}%`],
    );
    if (row.n > 0) return;
    await delay(10);
  }
  throw new Error(`the task never waited on the ${table} row lock`);
}

async function testLockedRowSkipsItsTable() {
  await withCommittedTenant(async (tenantId, seed) => {
    const supplierId = await seed(CASES.stale, 'suppliers');
    const capexId = await seed(CASES.stale, 'spend_items', CAPEX_LINE);
    const opexId = await seed(CASES.stale, 'spend_items');
    const blocker = await lockRow(tenantId, 'spend_items', opexId);
    try {
      const result = await task().syncTenant(tenantId);
      assert.deepEqual(result, { changes: { suppliers: { disabled: 1, enabled: 0 } }, skipped: ['spend_items'], errors: [] },
        'the locked table is skipped after the lock timeout (its CAPEX line with it), the other tables are done');
    } finally {
      await blocker.rollbackTransaction();
      await blocker.release();
    }
    const next = await task().syncTenant(tenantId);
    assert.deepEqual(next, { changes: { spend_items: { disabled: 2, enabled: 0 } }, skipped: [], errors: [] }, 'the next run catches up');
    const statuses = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return manager.query(
        `SELECT (SELECT status::text FROM spend_items WHERE id = $1) AS capex, (SELECT status::text FROM spend_items WHERE id = $2) AS opex,
                (SELECT status::text FROM suppliers WHERE id = $3) AS supplier`,
        [capexId, opexId, supplierId],
      );
    });
    assert.deepEqual(statuses[0], { capex: 'disabled', opex: 'disabled', supplier: 'disabled' });
  });
}

async function testDisableNowDuringTheWaitIsKept() {
  await withCommittedTenant(async (tenantId, seed) => {
    const capexId = await seed(CASES.stale, 'spend_items', CAPEX_LINE);
    const blocker = await lockRow(tenantId, 'spend_items', capexId);
    let pending: Promise<unknown> = Promise.resolve();
    try {
      pending = task().syncTenant(tenantId);
      await waitForLockWait('spend_items');
      // The user's edit: disabled, end of validity "now", committed while the task waits on the row.
      await blocker.query(
        `UPDATE spend_items SET status = 'disabled', disabled_at = clock_timestamp() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, capexId],
      );
      await blocker.commitTransaction();
      const result = await pending;
      assert.deepEqual(result, { changes: {}, skipped: [], errors: [] }, 'the task leaves the fresh edit alone');
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
      await Promise.resolve(pending).catch(() => undefined);
    }
    const rows = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return manager.query(`SELECT status::text AS status FROM spend_items WHERE id = $1`, [capexId]);
    });
    assert.equal(rows[0].status, 'disabled', 'the line stays disabled');
  });
}

void runSpecs('lifecycle-status-sync.integration.spec', [
  ['testCatalogMatchesTableList', testCatalogMatchesTableList],
  ['testSetsStatusFromEndOfValidity', testSetsStatusFromEndOfValidity],
  ['testOtherTenantUntouched', testOtherTenantUntouched],
  ['testRunTenantScope', testRunTenantScope],
  ['testStatusEmails', testStatusEmails],
  ['testLockedRowSkipsItsTable', testLockedRowSkipsItsTable],
  ['testDisableNowDuringTheWaitIsKept', testDisableNowDuringTheWaitIsKept],
]);
