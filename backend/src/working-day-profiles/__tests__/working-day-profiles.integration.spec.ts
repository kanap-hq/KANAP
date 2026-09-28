import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { isProfileActive } from '../working-day-profiles.util';
import {
  auditCount,
  context,
  expectRefused,
  FR218,
  runSpecs,
  seedCalendarRound,
  seedLine,
  seedTenant,
  services,
  withRollback,
} from './working-day-profile-test-helpers';

// Working-day calendars against a real database: create, read and list, the
// field and days rules, uniqueness (service sentence, then the unique indexes
// behind it), the per-year merge of a PATCH, the lifecycle, the in-use delete
// refusal counted in lines through the rounds of both item types, and the
// bulk delete that keeps going past a refusal.

const DE_OFFICE = ['21', '20', '22', '20', '19', '21', '23', '21', '21', '21', '20', '20'];

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const { svc, del } = services(runner.manager);
  return { tenantId, svc, del, ctx: context(runner.manager, tenantId) };
}

async function testCreateAndRead() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'read');
    const created = await svc.create({
      code: '  FR218 ',
      name: ' France 218 ',
      description: '  Office staff ',
      // Numbers, a decimal comma and trailing zeros are all normalised; years come back in order.
      days_by_year: { 2027: ['18', 18, '20.000', '20', '15', '20', '15', '16', '20', '19', '18', '19'], 2026: [...FR218.slice(0, 11), '19,0833330'] },
    }, ctx);
    assert.equal(created.code, 'FR218');
    assert.equal(created.name, 'France 218');
    assert.equal(created.description, 'Office staff');
    assert.deepEqual(Object.keys(created.days_by_year), ['2026', '2027']);
    assert.deepEqual(created.days_by_year['2027'], FR218);
    assert.equal(created.days_by_year['2026'][11], '19.083333');
    assert.equal(created.status, 'enabled');
    assert.equal(created.disabled_at, null);
    assert.deepEqual([created.opex_count, created.capex_count], [0, 0]);
    const [stored] = await runner.query(`SELECT days_by_year FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.deepEqual(stored.days_by_year['2027'], FR218, 'stored as decimal strings');

    const empty = await svc.create({ code: 'EMPTY', name: 'No years yet' }, ctx);
    assert.deepEqual(empty.days_by_year, {});
    await svc.create({ code: 'DE-OFF', name: 'Germany office', days_by_year: { 2026: DE_OFFICE } }, ctx);

    const list = await svc.list({}, ctx);
    assert.equal(list.total, 3);
    assert.deepEqual(list.items.map((row) => row.code), ['DE-OFF', 'EMPTY', 'FR218'], 'code order by default');
    assert.deepEqual(list.items.find((row) => row.code === 'FR218')!.years, ['2026', '2027']);
    assert.deepEqual(list.items.find((row) => row.code === 'EMPTY')!.years, []);

    assert.deepEqual((await svc.list({ q: 'france' }, ctx)).items.map((row) => row.code), ['FR218']);
    const byYears = await svc.list({ filters: JSON.stringify({ years: { type: 'contains', filter: '2027' } }) }, ctx);
    assert.deepEqual(byYears.items.map((row) => row.code), ['FR218']);
    const blankYears = await svc.list({ filters: JSON.stringify({ years: { type: 'blank' } }) }, ctx);
    assert.deepEqual(blankYears.items.map((row) => row.code), ['EMPTY']);
    const byName = await svc.list({ sort: 'name:DESC' }, ctx);
    assert.deepEqual(byName.items.map((row) => row.name), ['No years yet', 'Germany office', 'France 218']);
    const page = await svc.list({ page: 2, limit: 2 }, ctx);
    assert.deepEqual([page.total, page.items.length, page.items[0].code], [3, 1, 'FR218']);

    const ids = await svc.listIds({ sort: 'name:ASC' }, ctx);
    assert.equal(ids.total, 3);
    assert.equal(ids.ids[0], created.id);

    await expectRefused(runner, /Calendar not found/, () => svc.get(randomUUID(), ctx));
  });
}

async function testFieldAndDaysRules() {
  await withRollback(async (runner) => {
    const { svc, ctx } = await seed(runner, 'rules');
    await expectRefused(runner, /^Code is required\.$/, () => svc.create({ code: '  ', name: 'Blank code' }, ctx));
    await expectRefused(runner, /^Code must be 50 characters or fewer\.$/, () => svc.create({ code: 'C'.repeat(51), name: 'Long code' }, ctx));
    await expectRefused(runner, /^Name is required\.$/, () => svc.create({ code: 'NONAME' }, ctx));
    await expectRefused(runner, /^Name must be 200 characters or fewer\.$/, () => svc.create({ code: 'LONG', name: 'N'.repeat(201) }, ctx));
    await svc.create({ code: 'C'.repeat(50), name: 'N'.repeat(200) }, ctx);

    const days = (overrides: Record<number, unknown>) => FR218.map((value, index) => (index in overrides ? overrides[index] : value));
    await expectRefused(runner, /^February 2027 has 28 days: enter 28 or less\.$/, () =>
      svc.create({ code: 'FEB', name: 'February', days_by_year: { 2027: days({ 1: '28.5' }) } }, ctx));
    // A leap February holds 29.
    await svc.create({ code: 'LEAP', name: 'Leap', days_by_year: { 2028: days({ 1: '29' }) } }, ctx);
    await expectRefused(runner, /^March 2027 has 31 days: enter 31 or less\.$/, () =>
      svc.create({ code: 'MAR', name: 'March', days_by_year: { 2027: days({ 2: 32 }) } }, ctx));
    await expectRefused(runner, /^Use at most 6 decimals\.$/, () =>
      svc.create({ code: 'DEC', name: 'Decimals', days_by_year: { 2027: days({ 0: '18.1234567' }) } }, ctx));
    await expectRefused(runner, /^Enter the working days of all twelve months of 2027\.$/, () =>
      svc.create({ code: 'ELEVEN', name: 'Eleven', days_by_year: { 2027: FR218.slice(0, 11) } }, ctx));
    await expectRefused(runner, /^Enter 0 or more days for April 2027\.$/, () =>
      svc.create({ code: 'NEG', name: 'Negative', days_by_year: { 2027: days({ 3: '-1' }) } }, ctx));
    await expectRefused(runner, /^1999 is not a year between 2000 and 2100\.$/, () =>
      svc.create({ code: 'OLD', name: 'Old', days_by_year: { 1999: FR218 } }, ctx));
    // Removing a year only means something on an update.
    await expectRefused(runner, /twelve months of 2027/, () =>
      svc.create({ code: 'NULL', name: 'Null year', days_by_year: { 2027: null } }, ctx));

    // The refusal names the field, for the page to show it under the input.
    try {
      await svc.create({ code: 'FIELD', name: 'Field', days_by_year: { 2027: days({ 2: 32 }) } }, ctx);
      assert.fail('should be refused');
    } catch (err: any) {
      assert.equal(err.getResponse().field, 'days_by_year');
    }
  });
}

async function testUniqueness() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'unique');
    const fr = await svc.create({ code: 'FR218', name: 'France 218' }, ctx);
    const de = await svc.create({ code: 'DE-OFF', name: 'Germany office' }, ctx);

    await expectRefused(runner, /^A calendar with code fr218 already exists\.$/, () => svc.create({ code: 'fr218', name: 'Other' }, ctx));
    await expectRefused(runner, /^A calendar named france 218 already exists\.$/, () => svc.create({ code: 'FR2', name: 'france 218' }, ctx));
    await expectRefused(runner, /^A calendar with code FR218 already exists\.$/, () => svc.update(de.id, { code: 'FR218' }, ctx));
    await expectRefused(runner, /^A calendar named FRANCE 218 already exists\.$/, () => svc.update(de.id, { name: 'FRANCE 218' }, ctx));
    // A calendar keeps its own code and name in another case.
    const renamed = await svc.update(fr.id, { code: 'fr218', name: 'FRANCE 218' }, ctx);
    assert.deepEqual([renamed.code, renamed.name], ['fr218', 'FRANCE 218']);

    // Past the service check, the unique indexes answer with the same sentences.
    const values = (code: string, name: string) => ({
      code, name, description: null, days_by_year: {}, status: 'enabled' as any, disabled_at: null,
    });
    await expectRefused(runner, /^A calendar with code FR218 already exists\.$/, () => svc.persist(ctx, null, values('FR218', 'Fresh name')));
    await expectRefused(runner, /^A calendar named Germany Office already exists\.$/, () => svc.persist(ctx, null, values('FRESH', 'Germany Office')));
    await expectRefused(runner, /uniq_working_day_profiles_tenant_code/, () => runner.query(
      `INSERT INTO working_day_profiles (tenant_id, code, name) VALUES ($1, 'De-Off', 'Raw')`,
      [tenantId],
    ));

    // Another tenant has its own codes.
    const other = await seed(runner, 'unique-b');
    await other.svc.create({ code: 'FR218', name: 'France 218' }, other.ctx);
  });
}

async function testPatchMergesYears() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'merge');
    const created = await svc.create({ code: 'FR218', name: 'France 218', days_by_year: { 2026: FR218, 2027: FR218 } }, ctx);
    assert.equal(await auditCount(runner, tenantId, 'create'), 1);

    const next = [...FR218];
    next[2] = '19';
    const replaced = await svc.update(created.id, { days_by_year: { 2027: next } }, ctx);
    assert.deepEqual(replaced.days_by_year, { 2026: FR218, 2027: next }, 'a year sent replaces that year, the others stay');

    const added = await svc.update(created.id, { days_by_year: { 2028: FR218 } }, ctx);
    assert.deepEqual(Object.keys(added.days_by_year), ['2026', '2027', '2028']);

    const removed = await svc.update(created.id, { days_by_year: { 2026: null } }, ctx);
    assert.deepEqual(Object.keys(removed.days_by_year), ['2027', '2028'], 'null removes a year');
    assert.equal(await auditCount(runner, tenantId, 'update'), 3);

    // A refused year leaves every year as it was.
    await expectRefused(runner, /enter 31 or less/, () =>
      svc.update(created.id, { days_by_year: { 2028: null, 2029: FR218.map((v, i) => (i === 0 ? '32' : v)) } }, ctx));
    assert.deepEqual(Object.keys((await svc.get(created.id, ctx)).days_by_year), ['2027', '2028']);
    await expectRefused(runner, /^Give the working days per year\.$/, () => svc.update(created.id, { days_by_year: null }, ctx));

    // An unchanged body (the same days written differently) writes nothing.
    await svc.update(created.id, { name: 'France 218', days_by_year: { 2027: next.map((v) => `${v}.00`) } }, ctx);
    assert.equal(await auditCount(runner, tenantId, 'update'), 3);

    // The audit row of the removal carries both sides.
    const [{ n: removals }] = await runner.query(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'working_day_profiles' AND action = 'update' AND record_id = $2
          AND before_json->'days_by_year' ? '2026' AND NOT (after_json->'days_by_year' ? '2026')`,
      [tenantId, created.id],
    );
    assert.equal(removals, 1);

    await expectRefused(runner, /Calendar not found/, () => svc.update(randomUUID(), { name: 'Ghost' }, ctx));
  });
}

async function testLifecycle() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'life');
    const created = await svc.create({ code: 'FR218', name: 'France 218', days_by_year: { 2026: FR218 } }, ctx);
    await svc.create({ code: 'DE-OFF', name: 'Germany office' }, ctx);

    const disabled = await svc.update(created.id, { status: 'disabled' }, ctx);
    assert.equal(disabled.status, 'disabled');
    assert.ok(disabled.disabled_at, 'disabling sets the end of validity');
    assert.deepEqual(disabled.days_by_year, { 2026: FR218 }, 'a disabled calendar keeps its days');
    const [stored] = await runner.query(`SELECT status, disabled_at FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(isProfileActive(stored), false);

    // Lists show enabled calendars unless asked otherwise.
    assert.deepEqual((await svc.list({}, ctx)).items.map((row) => row.code), ['DE-OFF']);
    assert.deepEqual((await svc.list({ includeDisabled: 'true' }, ctx)).items.map((row) => row.code), ['DE-OFF', 'FR218']);
    assert.deepEqual((await svc.list({ status: 'disabled' }, ctx)).items.map((row) => row.code), ['FR218']);
    const statusFilter = await svc.list({ filters: JSON.stringify({ status: { filterType: 'set', values: ['enabled', 'disabled'] } }) }, ctx);
    assert.equal(statusFilter.total, 2);

    const enabled = await svc.update(created.id, { status: 'enabled' }, ctx);
    assert.deepEqual([enabled.status, enabled.disabled_at], ['enabled', null]);

    // An end of validity still to come keeps the calendar enabled until then.
    const future = await svc.update(created.id, { disabled_at: '2099-12-31' }, ctx);
    assert.equal(future.status, 'enabled');
    assert.equal(future.disabled_at, '2099-12-31T12:00:00.000Z');
    const past = await svc.update(created.id, { disabled_at: '2020-06-30' }, ctx);
    assert.equal(past.status, 'disabled');

    await expectRefused(runner, /Status must be 'enabled' or 'disabled'/, () => svc.update(created.id, { status: 'archived' }, ctx));
    await expectRefused(runner, /Invalid date 'soon'/, () => svc.update(created.id, { disabled_at: 'soon' }, ctx));
  });
}

async function testDeleteInUse() {
  await withRollback(async (runner) => {
    const { tenantId, svc, del, ctx } = await seed(runner, 'delete');
    const fr = await svc.create({ code: 'FR218', name: 'France 218', days_by_year: { 2026: FR218, 2027: FR218 } }, ctx);
    const spare = await svc.create({ code: 'SPARE', name: 'Spare calendar' }, ctx);

    // Three OPEX lines, one of them through two rounds and two years (counted once), and one CAPEX line.
    const a = await seedLine(runner, 'opex', tenantId);
    await seedCalendarRound(runner, 'opex', tenantId, a.versionId, fr.id, 'planned');
    await seedCalendarRound(runner, 'opex', tenantId, a.versionId, fr.id, 'actual');
    const [{ id: a2027 }] = await runner.query(
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year)
       VALUES ($1, $2, 'Y2027', 'monthly', '2027-01-01', 2027) RETURNING id`,
      [tenantId, a.itemId],
    );
    await seedCalendarRound(runner, 'opex', tenantId, a2027, fr.id, 'planned', 2027);
    for (let i = 0; i < 2; i += 1) {
      const line = await seedLine(runner, 'opex', tenantId);
      await seedCalendarRound(runner, 'opex', tenantId, line.versionId, fr.id, 'forecast');
    }
    const capex = await seedLine(runner, 'capex', tenantId);
    await seedCalendarRound(runner, 'capex', tenantId, capex.versionId, fr.id, 'committed');

    const detail = await svc.get(fr.id, ctx);
    assert.deepEqual([detail.opex_count, detail.capex_count], [3, 1]);

    await expectRefused(runner, /^France 218 is used by 3 OPEX lines and 1 CAPEX line\. Disable it instead\.$/, () => del.delete(fr.id, ctx));
    // Disabling stays possible, and the rounds keep it.
    await svc.update(fr.id, { status: 'disabled' }, ctx);
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM spend_round_inputs WHERE tenant_id = $1 AND working_day_profile_id = $2`,
      [tenantId, fr.id],
    );
    assert.equal(n, 5);

    // Only CAPEX left: the sentence names what is there.
    await runner.query(`DELETE FROM spend_round_inputs WHERE tenant_id = $1 AND working_day_profile_id = $2`, [tenantId, fr.id]);
    await expectRefused(runner, /^France 218 is used by 1 CAPEX line\. Disable it instead\.$/, () => del.delete(fr.id, ctx));

    // An unused calendar goes, with an audit row.
    await del.delete(spare.id, ctx);
    const [gone] = await runner.query(`SELECT id FROM working_day_profiles WHERE tenant_id = $1 AND id = $2`, [tenantId, spare.id]);
    assert.equal(gone, undefined);
    assert.equal(await auditCount(runner, tenantId, 'delete'), 1);
    await expectRefused(runner, /Calendar not found/, () => del.delete(spare.id, ctx));

    // The usage counts stay inside the tenant: another tenant's rounds never count.
    const other = await seed(runner, 'delete-b');
    const theirs = await other.svc.create({ code: 'FR218', name: 'France 218' }, other.ctx);
    assert.deepEqual([(await other.svc.get(theirs.id, other.ctx)).opex_count], [0]);
    await other.del.delete(theirs.id, other.ctx);
  });
}

async function testBulkDeleteKeepsGoing() {
  await withRollback(async (runner) => {
    const { tenantId, svc, del, ctx } = await seed(runner, 'bulk');
    const first = await svc.create({ code: 'A', name: 'First' }, ctx);
    const used = await svc.create({ code: 'B', name: 'Used', days_by_year: { 2026: FR218 } }, ctx);
    const last = await svc.create({ code: 'C', name: 'Last' }, ctx);
    const line = await seedLine(runner, 'capex', tenantId);
    await seedCalendarRound(runner, 'capex', tenantId, line.versionId, used.id, 'expected_landing');
    const ghost = randomUUID();

    const result = await del.bulkDelete([first.id, used.id, last.id, ghost, 'not-a-uuid', first.id], ctx);
    assert.deepEqual(result.deleted.sort(), [first.id, last.id].sort());
    assert.deepEqual(result.failed.map((entry) => [entry.id, entry.name, entry.reason]), [
      [used.id, 'Used', 'Used is used by 1 CAPEX line. Disable it instead.'],
      [ghost, 'Unknown', 'Calendar not found.'],
      ['not-a-uuid', 'Unknown', 'Calendar not found.'],
    ]);
    // The refusal rolled back its savepoint only: the transaction goes on.
    const remaining = await runner.query(`SELECT code FROM working_day_profiles WHERE tenant_id = $1 ORDER BY code`, [tenantId]);
    assert.deepEqual(remaining.map((row: any) => row.code), ['B']);
    assert.equal(await auditCount(runner, tenantId, 'delete'), 2);
  });
}

runSpecs('working-day-profiles.integration.spec', [
  testCreateAndRead,
  testFieldAndDaysRules,
  testUniqueness,
  testPatchMergesYears,
  testLifecycle,
  testDeleteInUse,
  testBulkDeleteKeepsGoing,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
