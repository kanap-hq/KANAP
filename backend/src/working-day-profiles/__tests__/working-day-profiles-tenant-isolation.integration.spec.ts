import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CapexAmountsService } from '../../capex/capex-amounts.service';
import { SpendAmountsService } from '../../spend/spend-amounts.service';
import { captureAudit, noFreeze } from '../../spend/__tests__/round-inputs.fixtures';
import { loadWorkingDayProfiles, loadWorkingDayProfilesByCode } from '../working-day-profiles.util';
import {
  context,
  expectRefused,
  FR218,
  seedLine,
  seedTenant,
  services,
  setCurrentTenant,
  withRollback,
} from './working-day-profile-test-helpers';

// Cross-tenant negative spec for working_day_profiles and the costed rounds
// (decisions D2, D3): forced RLS with the named policy on the calendars and
// both round tables; tenant B can neither list, read, change, delete nor
// export tenant A's calendar, nor compute with A's calendar id; the
// (tenant_id, working_day_profile_id) keys refuse A's calendar on B's round
// even through raw SQL, where RLS alone would not (foreign-key checks bypass
// RLS); ON DELETE RESTRICT keeps a calendar in use; and the costing CHECKs
// refuse a bad recipe whatever writes it.

const KINDS = [
  { kind: 'opex' as const, rounds: 'spend_round_inputs', amounts: 'spend_amounts' },
  { kind: 'capex' as const, rounds: 'capex_round_inputs', amounts: 'capex_amounts' },
];

const TABLES = ['working_day_profiles', 'spend_round_inputs', 'capex_round_inputs'];

function amountsService(kind: 'opex' | 'capex') {
  return kind === 'opex'
    ? new SpendAmountsService(undefined as any, undefined as any, undefined as any, captureAudit() as any, noFreeze as any)
    : new CapexAmountsService(undefined as any, undefined as any, captureAudit() as any, noFreeze as any);
}

/** A round of `table` in raw SQL: whole year 2026, `spread` unless `values` says otherwise. */
async function insertRound(
  runner: QueryRunner,
  table: string,
  tenantId: string,
  versionId: string,
  measure: string,
  values: Record<string, unknown> = {},
) {
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    version_id: versionId,
    measure,
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    method: 'spread',
    ...values,
  };
  const columns = Object.keys(row);
  await runner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    columns.map((column) => row[column]),
  );
}

async function insertCalendar(runner: QueryRunner, tenantId: string, code: string, name: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO working_day_profiles (tenant_id, code, name, days_by_year) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [tenantId, code, name, JSON.stringify({ 2026: FR218 })],
  );
  return row.id;
}

/** The call is refused with this HTTP status and a message matching `pattern`, in its own savepoint. */
async function expectHttpRefusal(runner: QueryRunner, status: number, pattern: RegExp, run: () => Promise<unknown>) {
  await expectRefused(runner, pattern, async () => {
    try {
      await run();
    } catch (error) {
      assert.ok(error instanceof HttpException, `an HTTP refusal, got ${String(error)}`);
      assert.equal(error.getStatus(), status);
      throw error;
    }
  });
}

async function testSchemaIsTenantIsolated() {
  for (const table of TABLES) {
    const [state] = await dataSource.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = $1`,
      [table],
    );
    assert.ok(state, `${table} is missing: run the migrations first`);
    assert.equal(state.relrowsecurity, true, `${table}: RLS is not enabled`);
    assert.equal(state.relforcerowsecurity, true, `${table}: FORCE RLS is not enabled`);
    const policies = await dataSource.query(
      `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      [table],
    );
    assert.equal(policies.length, 1, `${table}: exactly one policy`);
    assert.equal(policies[0].policyname, `${table}_tenant_isolation`);
    assert.equal(policies[0].cmd, 'ALL');
    assert.match(policies[0].qual, /tenant_id = app_current_tenant\(\)/);
    assert.match(policies[0].with_check, /tenant_id = app_current_tenant\(\)/);
  }

  const [unique] = await dataSource.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'working_day_profiles_tenant_id_id_key'`,
  );
  assert.equal(unique?.def, 'UNIQUE (tenant_id, id)');

  for (const { rounds } of KINDS) {
    const constraints: Array<{ conname: string; def: string }> = await dataSource.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = $1::regclass ORDER BY conname`,
      [rounds],
    );
    const byName = new Map(constraints.map((c) => [c.conname, c.def]));
    assert.match(
      byName.get(`${rounds}_working_day_profile_fk`) ?? '',
      /^FOREIGN KEY \(tenant_id, working_day_profile_id\) REFERENCES working_day_profiles\(tenant_id, id\) ON DELETE RESTRICT$/,
    );
    for (const check of ['costing_check', 'costing_calendar_check', 'costing_values_check', 'computed_check', 'method_check']) {
      assert.ok(byName.has(`${rounds}_${check}`), `${rounds}_${check} is missing`);
    }
    assert.match(byName.get(`${rounds}_method_check`)!, /'spread'.*'copied'.*'manual'.*'computed'/);
  }
}

async function testServicesRefuseOtherTenantsCalendar() {
  await withRollback(async (runner) => {
    const tenantA = await seedTenant(runner, 'iso-a');
    const a = services(runner.manager);
    const ctxA = context(runner.manager, tenantA);
    const calendarA = await a.svc.create({ code: 'FR218', name: 'France 218', days_by_year: { 2026: FR218 } }, ctxA);

    const tenantB = await seedTenant(runner, 'iso-b');
    const b = services(runner.manager);
    const ctxB = context(runner.manager, tenantB);

    // Reads: nothing of A is visible to B.
    assert.equal((await b.svc.list({ includeDisabled: '1' }, ctxB)).total, 0);
    assert.equal((await b.svc.listIds({ includeDisabled: '1' }, ctxB)).total, 0);
    await expectHttpRefusal(runner, 404, /Calendar not found/, () => b.svc.get(calendarA.id, ctxB));
    const exported = await b.csv.exportCsv('data', ctxB);
    assert.doesNotMatch(exported.content, /FR218|France 218/);

    // The shared loaders carry the tenant predicate: A's id and code resolve to nothing for B,
    // and naming tenant A from B's session finds nothing either (RLS).
    assert.equal((await loadWorkingDayProfiles(runner.manager, tenantB, [calendarA.id])).size, 0);
    assert.equal((await loadWorkingDayProfilesByCode(runner.manager, tenantB, ['FR218'])).size, 0);
    assert.equal((await loadWorkingDayProfiles(runner.manager, tenantA, [calendarA.id])).size, 0);

    // Writes on A's calendar: not found for B.
    await expectHttpRefusal(runner, 404, /Calendar not found/, () => b.svc.update(calendarA.id, { name: 'Taken over' }, ctxB));
    await expectHttpRefusal(runner, 404, /Calendar not found/, () =>
      b.svc.update(calendarA.id, { days_by_year: { 2026: null } }, ctxB));
    await expectHttpRefusal(runner, 404, /Calendar not found/, () => b.del.delete(calendarA.id, ctxB));
    const bulk = await b.del.bulkDelete([calendarA.id], ctxB);
    assert.deepEqual(bulk.deleted, []);
    assert.deepEqual(bulk.failed.map((entry) => entry.name), ['Unknown'], 'no name of A leaks to B');

    // The same code in another tenant is fine: codes are unique per tenant.
    const calendarB = await b.svc.create({ code: 'FR218', name: 'France 218' }, ctxB);
    assert.notEqual(calendarB.id, calendarA.id);

    // B's writes left A's calendar as it was.
    await setCurrentTenant(runner, tenantA);
    const after = await a.svc.get(calendarA.id, ctxA);
    assert.equal(after.name, 'France 218');
    assert.deepEqual(after.days_by_year, { 2026: FR218 });
    assert.equal((await a.svc.list({ includeDisabled: '1' }, ctxA)).total, 1);
  });
}

async function testComputeRefusesOtherTenantsCalendar() {
  await withRollback(async (runner) => {
    const tenantA = await seedTenant(runner, 'cmp-a');
    const calendarA = await insertCalendar(runner, tenantA, 'FR218', 'France 218');

    const tenantB = await seedTenant(runner, 'cmp-b');
    const calendarB = await insertCalendar(runner, tenantB, 'FR218', 'France 218');
    for (const { kind, rounds, amounts } of KINDS) {
      const { itemId, versionId } = await seedLine(runner, kind, tenantB, 2026);
      const service = amountsService(kind);
      const payload = (calendarId: string) => ({
        kind: 'computed' as const,
        year: 2026,
        measure: 'planned',
        period_start: '2026-02-01',
        period_end: '2026-10-30',
        pricing_basis: 'per_day',
        quantity: '1',
        unit_price: '400',
        price_index_pct: '0',
        working_day_profile_id: calendarId,
        counts_as_fte: true,
      });

      await expectHttpRefusal(runner, 400, /calendar was not found/i, () =>
        service.bulkUpsert(versionId, payload(calendarA) as any, null, { manager: runner.manager }));
      await expectHttpRefusal(runner, 400, /calendar was not found/i, () =>
        service.computePreview({ ...payload(calendarA), item_id: itemId }, { manager: runner.manager }));
      const [written] = await runner.query(
        `SELECT (SELECT count(*)::int FROM ${amounts} WHERE tenant_id = $1 AND version_id = $2) AS amounts,
                (SELECT count(*)::int FROM ${rounds} WHERE tenant_id = $1 AND version_id = $2) AS rounds`,
        [tenantB, versionId],
      );
      assert.deepEqual(written, { amounts: 0, rounds: 0 }, `${kind}: nothing written with A's calendar`);

      // Control: B's own calendar computes the same round.
      await service.bulkUpsert(versionId, payload(calendarB) as any, null, { manager: runner.manager });
      const [round] = await runner.query(
        `SELECT method, working_day_profile_id FROM ${rounds} WHERE tenant_id = $1 AND version_id = $2 AND measure = 'planned'`,
        [tenantB, versionId],
      );
      assert.deepEqual(round, { method: 'computed', working_day_profile_id: calendarB }, `${kind}: B's own calendar is used`);
    }
  });
}

async function testRawSqlKeysAndRestrict() {
  await withRollback(async (runner) => {
    const tenantA = await seedTenant(runner, 'raw-a');
    const calendarA = await insertCalendar(runner, tenantA, 'FR218', 'France 218');

    const tenantB = await seedTenant(runner, 'raw-b');

    // RLS: B cannot write a calendar for A, nor see, change or delete A's.
    await expectRefused(runner, /row-level security/i, () => runner.query(
      `INSERT INTO working_day_profiles (tenant_id, code, name) VALUES ($1, 'RAW', 'Raw')`,
      [tenantA],
    ));
    assert.equal((await runner.query(`SELECT 1 FROM working_day_profiles WHERE id = $1`, [calendarA])).length, 0);
    assert.equal((await runner.query(`UPDATE working_day_profiles SET name = 'Taken over' WHERE id = $1 RETURNING id`, [calendarA]))[0].length, 0);
    assert.equal((await runner.query(`DELETE FROM working_day_profiles WHERE id = $1 RETURNING id`, [calendarA]))[0].length, 0);

    for (const { kind, rounds } of KINDS) {
      // One calendar per round table, so the RESTRICT refusal can only come from this table's key.
      const calendarB = await insertCalendar(runner, tenantB, `OWN-${kind}`, `Own ${kind}`);
      const { versionId } = await seedLine(runner, kind, tenantB, 2026);
      const recipe = (calendarId: string) => ({
        method: 'computed', pricing_basis: 'per_day', quantity: '1', unit_price: '400', price_index_pct: '0',
        working_day_profile_id: calendarId, counts_as_fte: true,
      });

      // The composite key refuses A's calendar on B's round, on insert and on update.
      await expectRefused(runner, new RegExp(`${rounds}_working_day_profile_fk`), () =>
        insertRound(runner, rounds, tenantB, versionId, 'planned', recipe(calendarA)));
      await insertRound(runner, rounds, tenantB, versionId, 'forecast', recipe(calendarB));
      await expectRefused(runner, new RegExp(`${rounds}_working_day_profile_fk`), () => runner.query(
        `UPDATE ${rounds} SET working_day_profile_id = $3 WHERE tenant_id = $1 AND version_id = $2 AND measure = 'forecast'`,
        [tenantB, versionId, calendarA],
      ));

      // RESTRICT: a calendar used by a round cannot be deleted, raw SQL included.
      await expectRefused(runner, new RegExp(`${rounds}_working_day_profile_fk`), () => runner.query(
        `DELETE FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`,
        [tenantB, calendarB],
      ));
      // Once the round lets go of it, the delete goes through.
      await runner.query(`DELETE FROM ${rounds} WHERE tenant_id = $1 AND version_id = $2`, [tenantB, versionId]);
      const deleted = await runner.query(`DELETE FROM working_day_profiles WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantB, calendarB]);
      assert.equal(deleted[0].length, 1);
    }

    // B's session left A's calendar as it was.
    await setCurrentTenant(runner, tenantA);
    const [row] = await runner.query(`SELECT name FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`, [tenantA, calendarA]);
    assert.equal(row?.name, 'France 218');
  });
}

/**
 * D-N2: a caller about to write a round reads the calendar FOR KEY SHARE, so a
 * concurrent delete waits for it instead of committing first. Two connections,
 * on a committed throwaway tenant removed at the end.
 */
async function testKeyShareLockHoldsOffADelete() {
  const tenantId = randomUUID();
  let calendarId = '';
  await dataSource.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Calendars lock test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `wdp-lock-${tenantId.slice(0, 8)}`],
    );
    await setCurrentTenant(manager, tenantId);
    const [row] = await manager.query(
      `INSERT INTO working_day_profiles (tenant_id, code, name) VALUES ($1, 'LOCK', 'Lock test') RETURNING id`,
      [tenantId],
    );
    calendarId = row.id;
  });
  const writer = dataSource.createQueryRunner();
  const deleter = dataSource.createQueryRunner();
  const tryDelete = async () => {
    await deleter.startTransaction();
    await setCurrentTenant(deleter, tenantId);
    await deleter.query(`SET LOCAL lock_timeout = '300ms'`);
    try {
      const [rows] = await deleter.query(`DELETE FROM working_day_profiles WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantId, calendarId]);
      return `deleted ${rows.length}`;
    } catch (error: any) {
      return String(error?.message);
    } finally {
      await deleter.rollbackTransaction();
    }
  };
  try {
    await writer.connect();
    await deleter.connect();
    await writer.startTransaction();
    await setCurrentTenant(writer, tenantId);

    // Read without a lock: the delete goes through at once (rolled back).
    assert.equal((await loadWorkingDayProfiles(writer.manager, tenantId, [calendarId])).size, 1);
    assert.equal(await tryDelete(), 'deleted 1');

    // Read with the lock, by id and by code: the delete waits until it times out.
    assert.equal((await loadWorkingDayProfiles(writer.manager, tenantId, [calendarId], { lock: 'key share' })).size, 1);
    assert.match(await tryDelete(), /lock timeout/);
    await writer.rollbackTransaction();
    await writer.startTransaction();
    await setCurrentTenant(writer, tenantId);
    assert.equal((await loadWorkingDayProfilesByCode(writer.manager, tenantId, ['lock'], { lock: 'key share' })).size, 1);
    assert.match(await tryDelete(), /lock timeout/);

    // Once the writer's transaction ends, the delete goes through.
    await writer.rollbackTransaction();
    assert.equal(await tryDelete(), 'deleted 1');
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction().catch(() => undefined);
    await writer.release();
    await deleter.release();
    // The tenant row cascades to its calendar.
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
}

async function testCostingChecks() {
  await withRollback(async (runner) => {
    const tenant = await seedTenant(runner, 'chk');
    const calendar = await insertCalendar(runner, tenant, 'FR218', 'France 218');
    const perMonth = { pricing_basis: 'per_month', quantity: '10', unit_price: '200', price_index_pct: '0' };
    const perDay = { pricing_basis: 'per_day', quantity: '1', unit_price: '400', price_index_pct: '0', working_day_profile_id: calendar };

    for (const { kind, rounds } of KINDS) {
      const { versionId } = await seedLine(runner, kind, tenant, 2026);
      const refused = (constraint: string, values: Record<string, unknown>) =>
        expectRefused(runner, new RegExp(`${rounds}_${constraint}`), () => insertRound(runner, rounds, tenant, versionId, 'planned', values));

      // The recipe is all or nothing.
      await refused('costing_check', { pricing_basis: 'per_month', quantity: '10' });
      await refused('costing_check', { ...perMonth, price_index_pct: null });
      await refused('costing_check', { quantity: '1' });
      await refused('costing_check', { unit_price: '400' });
      await refused('costing_check', { counts_as_fte: true });
      // A calendar exactly for a price per day.
      await refused('costing_calendar_check', { ...perDay, working_day_profile_id: null });
      await refused('costing_calendar_check', { ...perMonth, working_day_profile_id: calendar });
      await refused('costing_calendar_check', { ...perMonth, pricing_basis: 'per_period', working_day_profile_id: calendar });
      // Values.
      await refused('costing_values_check', { ...perMonth, quantity: '-0.001' });
      await refused('costing_values_check', { ...perMonth, price_index_pct: '-100.0001' });
      // No computed round without a recipe; no unknown method.
      await refused('computed_check', { method: 'computed' });
      await refused('method_check', { method: 'estimated' });
      await expectRefused(runner, /invalid input value for enum pricing_basis/, () =>
        insertRound(runner, rounds, tenant, versionId, 'planned', { ...perMonth, pricing_basis: 'per_year' }));

      // Accepted: a computed round per day, a spread round keeping its recipe (credits and
      // the -100 % floor allowed), a round without a recipe.
      await insertRound(runner, rounds, tenant, versionId, 'planned', { ...perDay, method: 'computed', counts_as_fte: true });
      await insertRound(runner, rounds, tenant, versionId, 'forecast', { ...perMonth, unit_price: '-200', price_index_pct: '-100' });
      await insertRound(runner, rounds, tenant, versionId, 'committed', { method: 'manual' });
      const stored = await runner.query(
        `SELECT measure, method, pricing_basis, quantity::text, unit_price::text, price_index_pct::text, counts_as_fte
         FROM ${rounds} WHERE tenant_id = $1 AND version_id = $2 ORDER BY measure`,
        [tenant, versionId],
      );
      assert.deepEqual(stored.map((r: any) => [r.measure, r.method, r.pricing_basis, r.quantity, r.unit_price, r.price_index_pct, r.counts_as_fte]), [
        ['committed', 'manual', null, null, null, null, false],
        ['forecast', 'spread', 'per_month', '10.000', '-200.0000', '-100.0000', false],
        ['planned', 'computed', 'per_day', '1.000', '400.0000', '0.0000', true],
      ]);
    }

    // The calendars' own CHECKs and case-insensitive uniques.
    const calendarRefused = (pattern: RegExp, code: string, name: string, days = '{}') =>
      expectRefused(runner, pattern, () => runner.query(
        `INSERT INTO working_day_profiles (tenant_id, code, name, days_by_year) VALUES ($1, $2, $3, $4::jsonb)`,
        [tenant, code, name, days],
      ));
    await calendarRefused(/working_day_profiles_code_check/, ' FR ', 'Padded code');
    await calendarRefused(/working_day_profiles_code_check/, '', 'Empty code');
    await calendarRefused(/working_day_profiles_name_check/, 'EMPTY', '  ');
    await calendarRefused(/working_day_profiles_days_by_year_check/, 'ARRAY', 'Array days', JSON.stringify([FR218]));
    await calendarRefused(/uniq_working_day_profiles_tenant_code/, 'fr218', 'Another name');
    await calendarRefused(/uniq_working_day_profiles_tenant_name/, 'OTHER', 'FRANCE 218');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testSchemaIsTenantIsolated,
      testServicesRefuseOtherTenantsCalendar,
      testComputeRefusesOtherTenantsCalendar,
      testRawSqlKeysAndRestrict,
      testKeyShareLockHoldsOffADelete,
      testCostingChecks,
    ]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`working-day-profiles-tenant-isolation.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('working-day-profiles-tenant-isolation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
