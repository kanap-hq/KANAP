import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CapexAmountsService } from '../../capex/capex-amounts.service';
import { CompaniesService } from '../../companies/companies.service';
import { Company } from '../../companies/company.entity';
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

// Cross-tenant negative spec for working_day_profiles and the quantity ×
// price lines that use them: forced RLS with the named policy on the
// calendars, both round tables and both line tables; tenant B can neither
// list, read, change, delete nor export tenant A's calendar, nor compute
// with A's calendar id; the (tenant_id, working_day_profile_id) keys refuse
// A's calendar on B's line even through raw SQL, where RLS alone would not
// (foreign-key checks bypass RLS); ON DELETE RESTRICT keeps a calendar in
// use; and the line CHECKs refuse a bad line whatever writes it. Standard
// calendars: the year route, the suggestions and the calendar a company
// creation adds stay inside the tenant.

const KINDS = [
  { kind: 'opex' as const, rounds: 'spend_round_inputs', lines: 'spend_round_input_lines', amounts: 'spend_amounts' },
  { kind: 'capex' as const, rounds: 'capex_round_inputs', lines: 'capex_round_input_lines', amounts: 'capex_amounts' },
];

const TABLES = ['working_day_profiles', 'spend_round_inputs', 'capex_round_inputs', 'spend_round_input_lines', 'capex_round_input_lines'];

function amountsService(kind: 'opex' | 'capex') {
  return kind === 'opex'
    ? new SpendAmountsService(undefined as any, undefined as any, undefined as any, captureAudit() as any, noFreeze as any)
    : new CapexAmountsService(undefined as any, undefined as any, captureAudit() as any, noFreeze as any);
}

/** A row of `table` in raw SQL; returns its id. */
async function insertRow(runner: QueryRunner, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const [inserted] = await runner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    columns.map((column) => row[column]),
  );
  return inserted.id;
}

/** A round in raw SQL: whole year 2026, `spread` unless `values` says otherwise. */
function insertRound(runner: QueryRunner, table: string, tenantId: string, versionId: string, measure: string, values: Record<string, unknown> = {}) {
  return insertRow(runner, table, {
    tenant_id: tenantId, version_id: versionId, measure, period_start: '2026-01-01', period_end: '2026-12-31', method: 'spread', ...values,
  });
}

/** A line of a round in raw SQL: one person per month over 2026 unless `values` says otherwise. */
function insertLine(runner: QueryRunner, table: string, tenantId: string, roundId: string, sort: number, values: Record<string, unknown> = {}) {
  return insertRow(runner, table, {
    tenant_id: tenantId, round_input_id: roundId, sort, quantity_unit: 'people', quantity: '1', unit_price: '400', price_basis: 'per_month',
    period_start: '2026-01-01', period_end: '2026-12-31', ...values,
  });
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

  const constraintsOf = async (table: string) => new Map<string, string>((await dataSource.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
    [table],
  )).map((c: { conname: string; def: string }) => [c.conname, c.def]));
  for (const { rounds, lines } of KINDS) {
    const round = await constraintsOf(rounds);
    assert.equal(round.get(`${rounds}_tenant_id_id_key`), 'UNIQUE (tenant_id, id)');
    assert.match(round.get(`${rounds}_method_check`)!, /'spread'.*'copied'.*'manual'.*'computed'/);
    assert.ok(round.has(`${rounds}_fte_check`), `${rounds}_fte_check is missing`);
    for (const gone of ['costing_check', 'costing_calendar_check', 'costing_values_check', 'computed_check', 'working_day_profile_fk']) {
      assert.equal(round.has(`${rounds}_${gone}`), false, `${rounds}_${gone} is gone`);
    }
    const columns = (await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
      [rounds],
    )).map((c: { column_name: string }) => c.column_name);
    assert.deepEqual(columns, [
      'created_at', 'fte', 'id', 'last_calculation', 'measure', 'method', 'period_end', 'period_start',
      'spread_profile_name', 'tenant_id', 'updated_at', 'updated_by', 'version_id',
    ], `${rounds}: the lines hold the quantities and prices, the round its FTE`);

    const line = await constraintsOf(lines);
    assert.match(
      line.get(`${lines}_working_day_profile_fk`) ?? '',
      /^FOREIGN KEY \(tenant_id, working_day_profile_id\) REFERENCES working_day_profiles\(tenant_id, id\) ON DELETE RESTRICT$/,
    );
    assert.equal(
      line.get(`${lines}_round_input_fk`),
      `FOREIGN KEY (tenant_id, round_input_id) REFERENCES ${rounds}(tenant_id, id) ON DELETE CASCADE`,
    );
    assert.equal(line.get(`${lines}_round_sort_key`), 'UNIQUE (tenant_id, round_input_id, sort)');
    for (const check of ['basis_check', 'calendar_check', 'quantity_check', 'label_check', 'period_check']) {
      assert.ok(line.has(`${lines}_${check}`), `${lines}_${check} is missing`);
    }
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
    for (const { kind, rounds, lines, amounts } of KINDS) {
      const { versionId } = await seedLine(runner, kind, tenantB, 2026);
      const service = amountsService(kind);
      const payload = (calendarId: string) => ({
        kind: 'lines' as const,
        year: 2026,
        measure: 'planned' as const,
        lines: [{
          label: 'Consultant', quantity_unit: 'people' as const, quantity: '1', unit_price: '400', price_basis: 'per_day' as const,
          period_start: '2026-02-01', period_end: '2026-10-30', working_day_profile_id: calendarId,
        }],
      });

      await expectHttpRefusal(runner, 400, /^Line 1: the calendar was not found\.$/, () =>
        service.bulkUpsert(versionId, payload(calendarA), null, { manager: runner.manager }));
      const [written] = await runner.query(
        `SELECT (SELECT count(*)::int FROM ${amounts} WHERE tenant_id = $1 AND version_id = $2) AS amounts,
                (SELECT count(*)::int FROM ${rounds} WHERE tenant_id = $1 AND version_id = $2) AS rounds,
                (SELECT count(*)::int FROM ${lines} WHERE tenant_id = $1) AS lines`,
        [tenantB, versionId],
      );
      assert.deepEqual(written, { amounts: 0, rounds: 0, lines: 0 }, `${kind}: nothing written with A's calendar`);

      // Control: B's own calendar computes the same line.
      await service.bulkUpsert(versionId, payload(calendarB), null, { manager: runner.manager });
      const [round] = await runner.query(
        `SELECT r.method, l.working_day_profile_id
           FROM ${rounds} r JOIN ${lines} l ON l.tenant_id = r.tenant_id AND l.round_input_id = r.id
          WHERE r.tenant_id = $1 AND r.version_id = $2 AND r.measure = 'planned'`,
        [tenantB, versionId],
      );
      assert.deepEqual(round, { method: 'computed', working_day_profile_id: calendarB }, `${kind}: B's own calendar is used`);
    }
  });
}

async function testStandardCalendarsStayInTenant() {
  await withRollback(async (runner) => {
    const tenantA = await seedTenant(runner, 'std-a');
    const a = services(runner.manager);
    const ctxA = context(runner.manager, tenantA);
    const franceA = await a.svc.create({ code: 'FR', name: 'France', country_iso: 'FR', days_by_year: { 2026: FR218 } }, ctxA);
    await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'A Italia', 'IT', 'Roma'), ($1, 'A France', 'FR', 'Paris')`,
      [tenantA],
    );

    const tenantB = await seedTenant(runner, 'std-b');
    const b = services(runner.manager);
    const ctxB = context(runner.manager, tenantB);
    await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'B France', 'FR', 'Lyon')`, [tenantB]);

    // The year route: A's calendar is not found for B, whatever the year.
    await expectHttpRefusal(runner, 404, /Calendar not found/, () => b.svc.getYear(franceA.id, '2026', ctxB));
    await expectHttpRefusal(runner, 404, /Calendar not found/, () => b.svc.getYear(franceA.id, '2027', ctxB));

    // Suggestions: B's companies only; A's calendar (coded FR, named France) does not take the country out for B.
    assert.deepEqual((await b.svc.suggestions(ctxB)).items, [{ country_iso: 'FR', country_name: 'France', companies: ['B France'] }]);

    // A company created in B adds B's own standard calendar although A has one for the country.
    const companies = new CompaniesService(runner.manager.getRepository(Company), new AuditService(runner.manager.getRepository(AuditLog)), undefined as any);
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      await companies.create({ name: 'B Paris', country_iso: 'FR', city: 'Paris' } as any, undefined, { manager: runner.manager });
    } finally {
      console.warn = warn;
    }
    const [calendarB] = await runner.query(
      `SELECT id, tenant_id, code, days_by_year FROM working_day_profiles WHERE tenant_id = $1 AND country_iso = 'FR'`,
      [tenantB],
    );
    assert.equal(calendarB?.tenant_id, tenantB);
    assert.notEqual(calendarB.id, franceA.id);
    assert.deepEqual(calendarB.days_by_year, {}, "A's edited year is not B's");
    assert.deepEqual((await b.svc.suggestions(ctxB)).items, []);
    assert.equal((await b.svc.getYear(calendarB.id, '2026', ctxB)).source, 'standard');

    // A still sees its own calendar and suggestion only.
    await setCurrentTenant(runner, tenantA);
    assert.deepEqual((await a.svc.suggestions(ctxA)).items.map((item) => [item.country_iso, item.companies]), [['IT', ['A Italia']]]);
    assert.equal((await a.svc.getYear(franceA.id, '2026', ctxA)).source, 'edited');
    await expectHttpRefusal(runner, 404, /Calendar not found/, () => a.svc.getYear(calendarB.id, '2026', ctxA));
    assert.equal((await a.svc.list({ includeDisabled: '1' }, ctxA)).total, 1);
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

    for (const { kind, rounds, lines } of KINDS) {
      // One calendar per line table, so the RESTRICT refusal can only come from this table's key.
      const calendarB = await insertCalendar(runner, tenantB, `OWN-${kind}`, `Own ${kind}`);
      const { versionId } = await seedLine(runner, kind, tenantB, 2026);
      const roundId = await insertRound(runner, rounds, tenantB, versionId, 'forecast', { method: 'computed', fte: '1' });
      const perDay = (calendarId: string) => ({ price_basis: 'per_day', working_day_profile_id: calendarId });

      // The composite key refuses A's calendar on B's line, on insert and on update.
      await expectRefused(runner, new RegExp(`${lines}_working_day_profile_fk`), () =>
        insertLine(runner, lines, tenantB, roundId, 1, perDay(calendarA)));
      const lineId = await insertLine(runner, lines, tenantB, roundId, 1, perDay(calendarB));
      await expectRefused(runner, new RegExp(`${lines}_working_day_profile_fk`), () => runner.query(
        `UPDATE ${lines} SET working_day_profile_id = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantB, lineId, calendarA],
      ));

      // RESTRICT: a calendar used by a line cannot be deleted, raw SQL included.
      await expectRefused(runner, new RegExp(`${lines}_working_day_profile_fk`), () => runner.query(
        `DELETE FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`,
        [tenantB, calendarB],
      ));
      // Once the round and its lines go (CASCADE), the delete goes through.
      await runner.query(`DELETE FROM ${rounds} WHERE tenant_id = $1 AND version_id = $2`, [tenantB, versionId]);
      const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${lines} WHERE tenant_id = $1`, [tenantB]);
      assert.equal(n, 0, `${kind}: the lines went with their round`);
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

async function testLineChecks() {
  await withRollback(async (runner) => {
    const tenant = await seedTenant(runner, 'chk');
    const calendar = await insertCalendar(runner, tenant, 'FR218', 'France 218');
    const perDay = { price_basis: 'per_day', working_day_profile_id: calendar };

    for (const { kind, rounds, lines } of KINDS) {
      const { versionId } = await seedLine(runner, kind, tenant, 2026);
      const roundId = await insertRound(runner, rounds, tenant, versionId, 'planned', { method: 'computed', fte: '0.75' });
      const refused = (constraint: RegExp | string, values: Record<string, unknown>) => expectRefused(
        runner,
        typeof constraint === 'string' ? new RegExp(`${lines}_${constraint}`) : constraint,
        () => insertLine(runner, lines, tenant, roundId, 9, values),
      );

      // A unit and its price basis go together.
      await refused('basis_check', { price_basis: 'once' });
      await refused('basis_check', { quantity_unit: 'days', price_basis: 'per_month' });
      await refused('basis_check', { quantity_unit: 'units', ...perDay });
      // A calendar exactly for a price per day.
      await refused('calendar_check', { price_basis: 'per_day' });
      await refused('calendar_check', { working_day_profile_id: calendar });
      // Values, period, description.
      await refused('quantity_check', { quantity: '-0.001' });
      await refused('period_check', { period_start: '2026-06-01', period_end: '2026-05-31' });
      await refused('period_check', { period_start: '2026-06-01', period_end: '2027-01-31' });
      await refused('label_check', { label: 'x'.repeat(201) });
      await refused(/invalid input value for enum line_quantity_unit/, { quantity_unit: 'weeks' });
      await refused(/invalid input value for enum line_price_basis/, { price_basis: 'per_period' });
      // One line per place in its round.
      await insertLine(runner, lines, tenant, roundId, 1, { label: 'Kept' });
      await expectRefused(runner, new RegExp(`${lines}_round_sort_key`), () => insertLine(runner, lines, tenant, roundId, 1));
      // Rounds: no unknown method, no negative FTE.
      await expectRefused(runner, new RegExp(`${rounds}_method_check`), () => insertRound(runner, rounds, tenant, versionId, 'forecast', { method: 'estimated' }));
      await expectRefused(runner, new RegExp(`${rounds}_fte_check`), () => insertRound(runner, rounds, tenant, versionId, 'forecast', { fte: '-1' }));

      // Accepted: the five combinations, credits, a description of 200 characters.
      await insertLine(runner, lines, tenant, roundId, 2, { ...perDay, unit_price: '-400' });
      await insertLine(runner, lines, tenant, roundId, 3, { quantity_unit: 'days', ...perDay, label: 'y'.repeat(200) });
      await insertLine(runner, lines, tenant, roundId, 4, { quantity_unit: 'units', price_basis: 'per_month' });
      await insertLine(runner, lines, tenant, roundId, 5, { quantity_unit: 'units', price_basis: 'once', quantity: '0' });
      const stored = await runner.query(
        `SELECT sort, quantity_unit::text, price_basis::text, quantity::text, unit_price::text, working_day_profile_id
         FROM ${lines} WHERE tenant_id = $1 AND round_input_id = $2 ORDER BY sort`,
        [tenant, roundId],
      );
      assert.deepEqual(stored.map((r: any) => [r.sort, r.quantity_unit, r.price_basis, r.quantity, r.unit_price, r.working_day_profile_id]), [
        [1, 'people', 'per_month', '1.000', '400.0000', null],
        [2, 'people', 'per_day', '1.000', '-400.0000', calendar],
        [3, 'days', 'per_day', '1.000', '400.0000', calendar],
        [4, 'units', 'per_month', '1.000', '400.0000', null],
        [5, 'units', 'once', '0.000', '400.0000', null],
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
      testStandardCalendarsStayInTenant,
      testRawSqlKeysAndRestrict,
      testKeyShareLockHoldsOffADelete,
      testLineChecks,
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
