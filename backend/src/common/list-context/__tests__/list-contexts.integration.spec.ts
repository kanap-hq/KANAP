import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { ListContexts1853750000000 } from '../../../migrations/1853750000000-list-contexts';
import { ListContextPurgeService } from '../../../cleanup/list-context-purge.service';
import { listContextId, normalizeListContextState } from '../list-context';
import { evictListContexts, LIST_CONTEXTS_PER_TENANT, ListContextsService, purgeListContexts } from '../list-contexts.service';
import { inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../../spend/__tests__/round-inputs.fixtures';

// `list_contexts` (lot 2B, PR B2) on a real database, each case in a
// rolled-back transaction:
// - RLS: a tenant reads, saves and purges only its own contexts; a row naming
//   another tenant is refused (WITH CHECK), and RLS is forced;
// - content addressing: saving the same state twice keeps one row and the
//   same id; the id matches `listContextId`; only filters are saved;
// - a read moves the use date at most once a day;
// - a tenant keeps at most LIST_CONTEXTS_PER_TENANT contexts: saving a new one
//   deletes the least recently used, per tenant;
// - the purge deletes the contexts unused for 90 days, of every tenant, and
//   keeps the others;
// - the migration runs again on a migrated database, and repairs a table that
//   lost its policy, RLS, index or a check.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const svc = new ListContextsService();
const FILTERS = { supplier_name: { filterType: 'set', values: Array.from({ length: 1200 }, (_, i) => `Supplier ${String(i).padStart(4, '0')}`) } };
/** FILTERS plus a text filter: another state per label. */
const filtersFor = (label: string) => ({ ...FILTERS, product_name: { filterType: 'text', type: 'contains', filter: label } });

/** The service with a small cap, to exercise the eviction without saving a thousand rows. */
class SmallCapContexts extends ListContextsService {
  protected readonly cap = 3;
}

async function count(runner: QueryRunner, tenantId: string): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM list_contexts WHERE tenant_id = $1`, [tenantId]);
  return row.n;
}

/** Ages a context by `days` days (as its tenant: the row is under RLS). */
async function age(runner: QueryRunner, tenantId: string, id: string, days: number) {
  await setTenant(runner, tenantId);
  await runner.query(
    `UPDATE list_contexts SET last_used_at = now() - make_interval(days => $3::int), created_at = now() - make_interval(days => $3::int)
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, days],
  );
}

async function lastUsedAgeDays(runner: QueryRunner, tenantId: string, id: string): Promise<number> {
  const [row] = await runner.query(
    `SELECT extract(epoch FROM now() - last_used_at) / 86400 AS days FROM list_contexts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return Number(row.days);
}

async function testRlsIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'ctx-a');
    const b = await seedTenant(runner, 'ctx-b');
    await setTenant(runner, a);
    const { id } = await svc.save(runner.manager, a, 'spend-items', { filters: FILTERS });
    assert.ok((await svc.find(runner.manager, a, id)) != null, 'its own tenant reads it');

    await setTenant(runner, b);
    assert.equal(await svc.find(runner.manager, b, id), null, 'tenant B does not see A\'s context');
    assert.equal(await svc.find(runner.manager, a, id), null, 'not even naming tenant A: RLS filters the row');
    await assert.rejects(() => svc.get(runner.manager, b, id), NotFoundException);
    await assert.rejects(
      () => svc.require(runner.manager, b, id),
      (err: unknown) => err instanceof BadRequestException && (err.getResponse() as { code?: string }).code === 'list_context_not_found',
    );
    // Writing a row for tenant A while the session is tenant B: refused by the policy.
    await runner.query('SAVEPOINT cross_write');
    await assert.rejects(
      () => runner.query(`INSERT INTO list_contexts (tenant_id, id, list_key, state) VALUES ($1, $2, 'x', '{}'::jsonb)`, [a, 'B'.repeat(22)]),
      /row-level security/,
    );
    await runner.query('ROLLBACK TO SAVEPOINT cross_write');
    // Tenant B purging everything only touches its own rows.
    assert.equal(await purgeListContexts(runner.manager, b, 0), 0);
    await setTenant(runner, a);
    assert.equal(await count(runner, a), 1);

    const [rls] = await runner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'list_contexts'`);
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    // Without a tenant, nothing is visible.
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const [none] = await runner.query(`SELECT count(*)::int AS n FROM list_contexts`);
    assert.equal(none.n, 0);
  });
}

async function testContentAddressing() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'ctx-hash');
    const first = await svc.save(runner.manager, a, 'spend-items', { filters: FILTERS });
    assert.equal(first.id, listContextId(a, 'spend-items', normalizeListContextState({ filters: FILTERS })));
    // The same filters as a string, or with the set values in another order: same id, one row.
    const again = await svc.save(runner.manager, a, '/spend-items', { filters: JSON.stringify(FILTERS) });
    assert.equal(again.id, first.id);
    const shuffled = await svc.save(runner.manager, a, 'spend-items', {
      filters: { supplier_name: { values: [...FILTERS.supplier_name.values].reverse(), filterType: 'set' } },
    });
    assert.equal(shuffled.id, first.id);
    assert.equal(await count(runner, a), 1);
    // Other filters or another list: another row.
    const other = await svc.save(runner.manager, a, 'spend-items', { filters: filtersFor('cloud') });
    const otherList = await svc.save(runner.manager, a, 'capex-items', { filters: FILTERS });
    assert.notEqual(other.id, first.id);
    assert.notEqual(otherList.id, first.id);
    assert.equal(await count(runner, a), 3);

    const stored = await svc.get(runner.manager, a, first.id);
    assert.deepEqual(stored, { id: first.id, list: 'spend-items', state: { filters: FILTERS } });
    // Requests that are not ids are no context.
    assert.equal(await svc.find(runner.manager, a, 'not-an-id'), null);
    // Only the filters are saved: a state with any other list parameter is refused, nothing stored.
    for (const extra of [{ ctx: first.id }, { sort: 'supplier_name:ASC' }, { status: 'all' }, { limit: 100000 }, { q: 'x' }]) {
      await assert.rejects(() => svc.save(runner.manager, a, 'spend-items', { filters: filtersFor('extra'), ...extra }), BadRequestException, JSON.stringify(extra));
    }
    assert.equal(await count(runner, a), 3);
  });
}

async function testUseDateMovesOncePerDay() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'ctx-touch');
    const { id } = await svc.save(runner.manager, a, 'spend-items', { filters: FILTERS });
    // Used within the day: the row is not written again.
    await age(runner, a, id, 0);
    await runner.query(`UPDATE list_contexts SET last_used_at = now() - interval '2 hours' WHERE tenant_id = $1 AND id = $2`, [a, id]);
    await svc.find(runner.manager, a, id);
    assert.ok((await lastUsedAgeDays(runner, a, id)) > 0.08, 'read within a day: use date kept');
    // Older than a day: a read or a save moves it to now.
    await age(runner, a, id, 30);
    await svc.find(runner.manager, a, id);
    assert.ok((await lastUsedAgeDays(runner, a, id)) < 0.01, 'read after a day: use date now');
    await age(runner, a, id, 30);
    await svc.save(runner.manager, a, 'spend-items', { filters: FILTERS });
    assert.ok((await lastUsedAgeDays(runner, a, id)) < 0.01, 'saved again after a day: use date now');
  });
}

async function testPurge() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'ctx-purge-a');
    const b = await seedTenant(runner, 'ctx-purge-b');
    const ids: Record<string, string> = {};
    for (const [tenant, label, days] of [[a, 'a-old', 91], [a, 'a-edge', 89], [a, 'a-new', 0], [b, 'b-old', 120], [b, 'b-new', 3]] as const) {
      await setTenant(runner, tenant);
      ids[label] = (await svc.save(runner.manager, tenant, 'spend-items', { filters: filtersFor(label) })).id;
      await age(runner, tenant, ids[label], days);
    }
    const task = new ListContextPurgeService(dataSource, { register: () => undefined } as any);
    const summary = await task.run({ manager: runner.manager });
    assert.deepEqual(summary.errors, []);
    assert.ok(summary.tenantsProcessed >= 2);
    assert.ok(summary.purged >= 2, `purged ${summary.purged}`);
    await setTenant(runner, a);
    assert.equal(await svc.find(runner.manager, a, ids['a-old']), null, 'unused 91 days: purged');
    assert.ok(await svc.find(runner.manager, a, ids['a-edge']), 'unused 89 days: kept');
    assert.ok(await svc.find(runner.manager, a, ids['a-new']), 'used today: kept');
    await setTenant(runner, b);
    assert.equal(await svc.find(runner.manager, b, ids['b-old']), null, 'tenant B, unused 120 days: purged');
    assert.ok(await svc.find(runner.manager, b, ids['b-new']), 'tenant B, used 3 days ago: kept');
  });
}

async function testCapEvictsLeastRecentlyUsed() {
  await inRolledBackTransaction(async (runner) => {
    assert.equal(LIST_CONTEXTS_PER_TENANT, 1000);
    const small = new SmallCapContexts();
    const a = await seedTenant(runner, 'ctx-cap-a');
    const b = await seedTenant(runner, 'ctx-cap-b');
    // Tenant B's contexts do not count against tenant A's cap, and are never evicted by it.
    await setTenant(runner, b);
    const kept = (await small.save(runner.manager, b, 'spend-items', { filters: filtersFor('b-old') })).id;
    await age(runner, b, kept, 60);
    await setTenant(runner, a);
    const ids: Record<string, string> = {};
    for (const [label, days] of [['oldest', 30], ['middle', 10], ['recent', 2]] as const) {
      ids[label] = (await small.save(runner.manager, a, 'spend-items', { filters: filtersFor(label) })).id;
      await age(runner, a, ids[label], days);
    }
    assert.equal(await count(runner, a), 3);
    // Reading the oldest makes it the most recently used.
    assert.ok(await small.find(runner.manager, a, ids.oldest));
    // Saving an existing state adds nothing and evicts nothing.
    assert.equal((await small.save(runner.manager, a, 'spend-items', { filters: filtersFor('recent') })).id, ids.recent);
    assert.equal(await count(runner, a), 3);
    // A fourth state: the least recently used one (middle) goes.
    ids.fresh = (await small.save(runner.manager, a, 'spend-items', { filters: filtersFor('fresh') })).id;
    assert.equal(await count(runner, a), 3);
    assert.equal(await small.find(runner.manager, a, ids.middle), null, 'least recently used: evicted');
    for (const label of ['oldest', 'recent', 'fresh']) assert.ok(await small.find(runner.manager, a, ids[label]), `${label}: kept`);
    await setTenant(runner, b);
    assert.ok(await small.find(runner.manager, b, kept), 'another tenant: untouched');
    // The eviction itself, at any cap: keeps the most recent rows of the tenant.
    await age(runner, a, ids.oldest, 5);
    await age(runner, a, ids.recent, 3);
    assert.equal(await evictListContexts(runner.manager, a, 1), 2);
    assert.equal(await count(runner, a), 1);
    assert.ok(await small.find(runner.manager, a, ids.fresh), 'the most recently used stays');
  });
}

async function testMigrationHeals() {
  await inRolledBackTransaction(async (runner) => {
    const migration = new ListContexts1853750000000();
    await migration.up(runner);
    // Broken table: no policy, no RLS, no index, no check.
    await runner.query(`DROP POLICY IF EXISTS list_contexts_tenant_isolation ON list_contexts`);
    await runner.query(`ALTER TABLE list_contexts NO FORCE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE list_contexts DISABLE ROW LEVEL SECURITY`);
    await runner.query(`DROP INDEX IF EXISTS idx_list_contexts_tenant_last_used`);
    await runner.query(`ALTER TABLE list_contexts DROP CONSTRAINT IF EXISTS chk_list_contexts_id`);
    await migration.up(runner);
    const [rls] = await runner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'list_contexts'`);
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    const policies = await runner.query(`SELECT policyname, qual, with_check FROM pg_policies WHERE tablename = 'list_contexts'`);
    assert.equal(policies.length, 1);
    assert.match(policies[0].qual, /app_current_tenant\(\)/);
    assert.match(policies[0].with_check, /app_current_tenant\(\)/);
    const [index] = await runner.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_list_contexts_tenant_last_used'`);
    assert.equal(index.n, 1);
    const checks = await runner.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'list_contexts'::regclass AND contype = 'c' ORDER BY conname`);
    assert.deepEqual(checks.map((c: { conname: string }) => c.conname), ['chk_list_contexts_id', 'chk_list_contexts_list_key', 'chk_list_contexts_state']);
    const a = await seedTenant(runner, 'ctx-check');
    await runner.query('SAVEPOINT bad_id');
    await assert.rejects(() => runner.query(`INSERT INTO list_contexts (tenant_id, id, list_key, state) VALUES ($1, 'short', 'x', '{}'::jsonb)`, [a]), /chk_list_contexts_id/);
    await runner.query('ROLLBACK TO SAVEPOINT bad_id');
    await runner.query('SAVEPOINT bad_state');
    await assert.rejects(() => runner.query(`INSERT INTO list_contexts (tenant_id, id, list_key, state) VALUES ($1, $2, 'x', '[]'::jsonb)`, [a, 'C'.repeat(22)]), /chk_list_contexts_state/);
    await runner.query('ROLLBACK TO SAVEPOINT bad_state');
  });
}

runSpecs('list contexts', [
  ['RLS: a tenant only sees and writes its own contexts', testRlsIsolation],
  ['content addressing: same state, same id, one row', testContentAddressing],
  ['the use date moves at most once a day', testUseDateMovesOncePerDay],
  ['the purge deletes contexts unused for 90 days, per tenant', testPurge],
  ['past the cap, saving a new context evicts the least recently used', testCapEvictsLeastRecentlyUsed],
  ['the migration runs again and repairs a broken table', testMigrationHeals],
]);
