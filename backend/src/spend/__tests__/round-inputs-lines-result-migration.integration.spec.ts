import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { RoundInputsLinesResult1853880000000 as Migration } from '../../migrations/1853880000000-round-inputs-lines-result';
import { upsertRoundInput } from '../round-inputs.util';
import {
  amountsService,
  assert,
  captureAudit,
  inRolledBackTransaction,
  Kind,
  period,
  readRecords,
  repeat,
  runSpecs,
  seedCalendar,
  seedItem,
  seedTenant,
  seedVersion,
  setTenant,
  StoredRecord,
  TABLES,
} from './round-inputs.fixtures';

// Migration 1853880000000 (the result of their lines on the rounds that keep
// an FTE while their amounts do not follow the lines), against a real
// database, each test in a transaction that is rolled back, run like a
// migration: without app.current_tenant. Two tenants, OPEX and CAPEX:
// - rounds to fill (a yearly spread, a quarterly spread, a copy of reference
//   lines written before lot 2a) get the result of their stored lines,
//   computed with the tenant's calendars as they are now; their FTE, method,
//   period and `updated_at` stay (a copy keeps the source's FTE even when its
//   lines now give another one);
// - rounds already filled, computed rounds, computed rounds edited by hand
//   are untouched;
// - a round whose calendar has no working days for its year is skipped and
//   named in the log, never a failure;
// - row level security and the round tables' update trigger are restored;
// - with a tenant context set, the versions keep their budget_rev (the
//   trigger is off during the run; without a context, FORCE row level
//   security on the versions hides them from it anyway);
// - a second run writes nothing.
// The assertions read this test's own rows; the log counts the whole table
// (the database may hold other tenants' rows).

const migration = new Migration();
const LOG_PREFIX = '[Migration] RoundInputsLinesResult:';
const YEAR = 2036;
const NEXT = YEAR + 1;
const KINDS: Kind[] = ['opex', 'capex'];
const RLS_TABLES = ['spend_round_inputs', 'spend_round_input_lines', 'capex_round_inputs', 'capex_round_input_lines', 'working_day_profiles'];

/** A consultant 5 days a month and a developer full time January to June, on the calendar; licences without one. */
function staffLines(calendarId: string, year: number) {
  return [
    {
      label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '400', price_basis: 'per_day', frequency: 'per_month',
      days_per_month: '5', period_start: `${year}-01-01`, period_end: `${year}-12-31`, working_day_profile_id: calendarId,
    },
    {
      label: 'Developer', quantity_unit: 'people', quantity: '1', unit_price: '300', price_basis: 'per_day', frequency: 'per_month',
      days_per_month: null, period_start: `${year}-01-01`, period_end: `${year}-06-30`, working_day_profile_id: calendarId,
    },
    {
      label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '20', price_basis: 'per_piece', frequency: 'per_month',
      days_per_month: null, period_start: `${year}-01-01`, period_end: `${year}-12-31`, working_day_profile_id: null,
    },
  ];
}

const svc = (kind: Kind) => amountsService(kind);

function writeLines(runner: QueryRunner, kind: Kind, versionId: string, measure: string, lines: unknown[], year = YEAR) {
  return svc(kind).bulkUpsert(versionId, { kind: 'lines', year, measure, lines }, null, { manager: runner.manager });
}

/** The calculation as a round written before lot 2a stored it: without the result of the lines. */
async function stripResult(runner: QueryRunner, kind: Kind, versionId: string, measure: string) {
  await runner.query(
    `UPDATE ${TABLES[kind].rounds} SET last_calculation = last_calculation - 'lines_result' WHERE version_id = $1 AND measure = $2`,
    [versionId, measure],
  );
}

function resultOf(calculation: Record<string, unknown>) {
  const { kind, ...rest } = calculation;
  assert.equal(kind, 'computed');
  return rest;
}

type Seeded = {
  tenantId: string;
  calendarId: string;
  /** Version → measure → what the round must hold after the migration (`lines_result` undefined: untouched). */
  expect: Array<{ kind: Kind; versionId: string; measure: string; label: string; result?: Record<string, unknown>; fte: string | null }>;
  /** The round whose calendar has no days for its year. */
  skipped: Array<{ kind: Kind; versionId: string }>;
  versionIds: Record<Kind, string[]>;
};

/**
 * One tenant: per scope, a line of YEAR with Budget spread over its lines and
 * Revision edited quarterly over them (both stripped to the old shape), Actual
 * computed, Landing computed then edited by hand, Forecast spread and already
 * filled; a line of NEXT copied from reference lines the old way (the source's
 * FTE); a line whose calendar loses its days for YEAR. The calendar has
 * `days` working days a month in YEAR; with `laterDays`, they change after
 * the writes, and the migration must use those.
 */
async function seedOneTenant(runner: QueryRunner, tag: string, days: string, laterDays?: string): Promise<Seeded> {
  const tenantId = await seedTenant(runner, tag);
  const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: repeat(days, 12), [NEXT]: repeat('16', 12) } });
  const lost = await seedCalendar(runner, tenantId, { code: 'L', name: 'Lost days', days_by_year: { [YEAR]: repeat('20', 12) } });
  const seeded: Seeded = { tenantId, calendarId, expect: [], skipped: [], versionIds: { opex: [], capex: [] } };
  const pending: Array<() => Promise<void>> = [];

  for (const kind of KINDS) {
    const itemId = await seedItem(runner, kind, tenantId, 1);
    const versionId = await seedVersion(runner, kind, tenantId, itemId, YEAR);
    seeded.versionIds[kind].push(versionId);
    for (const measure of ['planned', 'committed', 'forecast', 'actual', 'expected_landing']) {
      await writeLines(runner, kind, versionId, measure, staffLines(calendarId, YEAR));
    }
    // Budget: a yearly spread; Revision: a quarterly edit; both as written before lot 2a.
    await svc(kind).bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { planned: 12000 } }, null, { manager: runner.manager });
    await svc(kind).bulkUpsert(versionId, { kind: 'quarterly', year: YEAR, measure: 'committed', Q1: 300 }, null, { manager: runner.manager });
    await stripResult(runner, kind, versionId, 'planned');
    await stripResult(runner, kind, versionId, 'committed');
    // Forecast: spread with the result already carried (a sentinel FTE shows it is not recomputed).
    await svc(kind).bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { forecast: 600 } }, null, { manager: runner.manager });
    await runner.query(
      `UPDATE ${TABLES[kind].rounds} SET last_calculation = jsonb_set(last_calculation, '{lines_result,fte}', '"9.99"') WHERE version_id = $1 AND measure = 'forecast'`,
      [versionId],
    );
    // Landing: computed, then edited by hand (kind computed, method manual).
    await svc(kind).bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), expected_landing: 1 }] }, null, { manager: runner.manager });
    for (const measure of ['forecast', 'actual', 'expected_landing']) {
      seeded.expect.push({ kind, versionId, measure, label: `${tag} ${kind} ${measure} untouched`, fte: null });
    }
    // The result each round to fill must get, once the calendar holds its final days: read after the change below.
    pending.push(async () => {
      await writeLines(runner, kind, versionId, 'actual', staffLines(calendarId, YEAR));
      const reference = resultOf((await readRecords(runner, kind, versionId)).actual.last_calculation);
      for (const measure of ['planned', 'committed']) {
        seeded.expect.push({ kind, versionId, measure, label: `${tag} ${kind} ${measure} filled`, result: reference, fte: '0.75' });
      }
    });

    // A NEXT round copied from reference lines before lot 2a: the source's FTE (0.75), the lines shifted to NEXT.
    const nextItem = await seedItem(runner, kind, tenantId, 2);
    const nextVersion = await seedVersion(runner, kind, tenantId, nextItem, NEXT);
    seeded.versionIds[kind].push(nextVersion);
    await upsertRoundInput(
      { manager: runner.manager, scope: kind, version: { id: nextVersion, tenant_id: tenantId, budget_year: NEXT }, userId: null, audit: captureAudit() },
      'planned',
      {
        period_start: `${NEXT}-01-01`, period_end: `${NEXT}-12-31`, method: 'copied', spread_profile_name: null, fte: '0.75',
        last_calculation: {
          kind: 'copy', source_year: YEAR, source_measure: 'planned', uplift_pct: '0', source_total: '62400.00', total: '62400.00', source_method: 'manual',
        },
      },
      staffLines(calendarId, NEXT) as any,
    );
    // 16 days a month in NEXT: (0.3125 × 12 + 6) ÷ 12 = 0.8125.
    seeded.expect.push({ kind, versionId: nextVersion, measure: 'planned', label: `${tag} ${kind} copy filled`, result: { fte: '0.81' }, fte: '0.75' });

    // A line whose calendar has no days for YEAR any more: skipped.
    const lostItem = await seedItem(runner, kind, tenantId, 3);
    const lostVersion = await seedVersion(runner, kind, tenantId, lostItem, YEAR);
    seeded.versionIds[kind].push(lostVersion);
    await writeLines(runner, kind, lostVersion, 'planned', staffLines(lost, YEAR).slice(0, 1));
    await svc(kind).bulkUpsert(lostVersion, { kind: 'annual', year: YEAR, totals: { planned: 100 } }, null, { manager: runner.manager });
    await stripResult(runner, kind, lostVersion, 'planned');
    seeded.skipped.push({ kind, versionId: lostVersion });
  }
  await runner.query(`UPDATE working_day_profiles SET days_by_year = '{}'::jsonb WHERE id = $1`, [lost]);
  if (laterDays) {
    await runner.query(
      `UPDATE working_day_profiles SET days_by_year = jsonb_set(days_by_year, '{${YEAR}}', $2::jsonb) WHERE id = $1`,
      [calendarId, JSON.stringify(repeat(laterDays, 12))],
    );
  }
  for (const fn of pending) await fn();
  return seeded;
}

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

/** Every round of the seeded versions, by version and measure. */
async function snapshot(runner: QueryRunner, seeded: Seeded): Promise<Map<string, StoredRecord>> {
  await setTenant(runner, seeded.tenantId);
  const rows = new Map<string, StoredRecord>();
  for (const kind of KINDS) {
    for (const versionId of seeded.versionIds[kind]) {
      for (const [measure, record] of Object.entries(await readRecords(runner, kind, versionId))) rows.set(`${versionId}:${measure}`, record);
    }
  }
  return rows;
}

async function security(runner: QueryRunner) {
  const tables = await runner.query(
    `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
    [RLS_TABLES],
  );
  const triggers = await runner.query(
    `SELECT tgname, tgenabled::text AS enabled FROM pg_trigger WHERE tgname = ANY($1::text[]) ORDER BY tgname`,
    [['spend_round_inputs_budget_rev_update', 'capex_round_inputs_budget_rev_update']],
  );
  return { tables, triggers };
}

const summary = (lines: string[], kind: Kind) => lines.find((l) => l.startsWith(`${LOG_PREFIX} ${TABLES[kind].rounds}:`)) ?? '';
const filledCount = (line: string) => Number(/: (\d+) round\(s\) given the result of their lines/.exec(line)?.[1] ?? 0);

/** Two tenants, both scopes: filled, untouched, skipped; security restored; a second run writes nothing. */
async function testBackfill() {
  await inRolledBackTransaction(async (runner) => {
    const one = await seedOneTenant(runner, 'lr-mig-a', '20');
    // The second tenant's calendar changes after its writes: the migration reads the days of now.
    const two = await seedOneTenant(runner, 'lr-mig-b', '20', '10');
    const tenants = [one, two];
    const before = new Map<Seeded, Map<string, StoredRecord>>();
    for (const seeded of tenants) {
      before.set(seeded, await snapshot(runner, seeded));
    }
    const securityBefore = await security(runner);
    assert.ok(securityBefore.tables.every((t: any) => t.enabled && t.forced), 'harness: row level security forced on every table');

    // Run like a migration: no tenant context.
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const first = await captureLog(() => migration.up(runner));

    for (const seeded of tenants) {
      const after = await snapshot(runner, seeded);
      const was = before.get(seeded)!;
      for (const expected of seeded.expect) {
        const key = `${expected.versionId}:${expected.measure}`;
        const [old, now] = [was.get(key)!, after.get(key)!];
        assert.equal(now.updated_at.getTime(), old.updated_at.getTime(), `${expected.label}: updated_at kept`);
        assert.deepEqual([now.method, now.period_start, now.period_end, now.fte], [old.method, old.period_start, old.period_end, old.fte], `${expected.label}: the record kept`);
        if (!expected.result) {
          assert.deepEqual(now.last_calculation, old.last_calculation, expected.label);
          continue;
        }
        assert.equal(now.fte, expected.fte, `${expected.label}: the FTE is not changed`);
        assert.equal(old.last_calculation.lines_result, undefined, `${expected.label}: harness, the old shape`);
        const { lines_result: result, ...rest } = now.last_calculation;
        assert.deepEqual(rest, old.last_calculation, `${expected.label}: the calculation otherwise as it was`);
        if ('lines' in expected.result) {
          assert.deepEqual(result, expected.result, `${expected.label}: the result of the lines with the calendars of now`);
        } else {
          assert.equal(result.fte, expected.result.fte, `${expected.label}: computed for its own year`);
          assert.deepEqual(result.lines.map((l: any) => [l.label, l.day_counts?.[0] ?? null]), [['Consultant', '16'], ['Developer', '16'], ['Licences', null]]);
        }
      }
      for (const skipped of seeded.skipped) {
        const key = `${skipped.versionId}:planned`;
        assert.deepEqual(after.get(key), was.get(key), `${skipped.kind}: the round that cannot be computed is untouched`);
        const named = first.lines.find((l) => l.includes(`skipped round ${was.get(key)!.id} (tenant ${seeded.tenantId})`));
        assert.match(named ?? '', /a calendar has no working days for the year: Line 1: Lost days has no working days for 2036/, `${skipped.kind}: the skip is named with its reason`);
      }
    }
    // The calendars are each tenant's: the second tenant's result reads 10 days, the first's 20.
    const dayOf = (seeded: Seeded) => (seeded.expect.find((e) => e.measure === 'planned' && e.result && 'lines' in e.result)!.result as any).lines[0].day_counts[0];
    assert.deepEqual([dayOf(one), dayOf(two)], ['20', '10'], 'harness: the two tenants differ');

    assert.deepEqual(await security(runner), securityBefore, 'row level security and the triggers as found');
    for (const kind of KINDS) {
      const line = summary(first.lines, kind);
      assert.ok(filledCount(line) >= 6, `${kind}: the fills are counted (${line})`);
      assert.match(line, /\(\d+ whose lines now give another FTE than the stored one, kept\)/, `${kind}: the FTE gaps are counted`);
      assert.match(line, /, \d+ skipped \(.*\d+ a calendar has no working days for the year/, `${kind}: the skips are counted by reason`);
    }

    // A second run: nothing written, the skipped rounds named again.
    const settled = new Map<Seeded, Map<string, StoredRecord>>();
    for (const seeded of tenants) settled.set(seeded, await snapshot(runner, seeded));
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    const second = await captureLog(() => migration.up(runner));
    for (const seeded of tenants) assert.deepEqual(await snapshot(runner, seeded), settled.get(seeded), 'a second run changes nothing');
    for (const kind of KINDS) assert.equal(filledCount(summary(second.lines, kind)), 0, `${kind}: a second run fills nothing (${summary(second.lines, kind)})`);
    for (const seeded of tenants) {
      for (const skipped of seeded.skipped) {
        const id = settled.get(seeded)!.get(`${skipped.versionId}:planned`)!.id;
        assert.ok(second.lines.some((l) => l.includes(`skipped round ${id}`)), 'skipped again');
      }
    }
  });
}

/**
 * With a tenant context set (a script run by hand), the versions still keep
 * their budget_rev: the update trigger is off while the rounds are written.
 * This is the case that proves it: without a context, FORCE row level
 * security on the versions hides them from the trigger, which is not
 * SECURITY DEFINER, so it would bump nothing either way.
 */
async function testBudgetRevKeptWithATenantContext() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'lr-mig-ctx');
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: repeat('20', 12) } });
    for (const kind of KINDS) {
      const itemId = await seedItem(runner, kind, tenantId, 1);
      const versionId = await seedVersion(runner, kind, tenantId, itemId, YEAR);
      await writeLines(runner, kind, versionId, 'planned', staffLines(calendarId, YEAR));
      await svc(kind).bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } }, null, { manager: runner.manager });
      await stripResult(runner, kind, versionId, 'planned');
      const [{ rev }] = await runner.query(`SELECT budget_rev::int AS rev FROM ${TABLES[kind].versions} WHERE id = $1`, [versionId]);
      await captureLog(() => migration.up(runner));
      await setTenant(runner, tenantId);
      const { planned } = await readRecords(runner, kind, versionId);
      assert.equal(planned.last_calculation.lines_result?.fte, '0.75', `${kind}: filled`);
      const [after] = await runner.query(`SELECT budget_rev::int AS rev FROM ${TABLES[kind].versions} WHERE id = $1`, [versionId]);
      assert.equal(after.rev, rev, `${kind}: budget_rev kept`);
    }
  });
}

void runSpecs('round-inputs-lines-result-migration.integration.spec', [
  ['testBackfill', testBackfill],
  ['testBudgetRevKeptWithATenantContext', testBudgetRevKeptWithATenantContext],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
