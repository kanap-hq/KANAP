import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CompaniesService } from '../../companies/companies.service';
import { Company } from '../../companies/company.entity';
import { SpendAmountsService } from '../../spend/spend-amounts.service';
import { captureAudit, noFreeze, readMeasure } from '../../spend/__tests__/round-inputs.fixtures';
import { calendarDaysFor, isProfileActive, loadWorkingDayProfiles } from '../working-day-profiles.util';
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
// refusal counted in budget lines through the quantity × price lines of both
// item types, and the
// bulk delete that keeps going past a refusal. Standard calendars: the source
// set at creation and never changed, the year route in its three cases, reset
// to standard, the standard values in a computation, the suggestions from the
// companies, and the calendar a company creation adds.

const DE_OFFICE = ['21', '20', '22', '20', '19', '21', '23', '21', '21', '21', '20', '20'];
const FRANCE_2026 = ['21', '20', '22', '21', '17', '22', '22', '21', '22', '22', '20', '22'];
const SOURCE_REFUSAL = /^The country of a calendar cannot be changed\. Create another calendar\.$/;

async function seedCompany(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  countryIso: string,
  lifecycle: { status?: 'enabled' | 'disabled'; disabledAt?: string | null } = {},
) {
  await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, disabled_at) VALUES ($1, $2, $3, 'Test city', $4, $5)`,
    [tenantId, name, countryIso, lifecycle.status ?? 'enabled', lifecycle.disabledAt ?? null],
  );
}

async function seedUser(runner: QueryRunner, tenantId: string, locale: string | null): Promise<string> {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Calendar tester', 'Calendar tester', false, false, now(), now())`,
    [roleId, tenantId],
  );
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale)
     VALUES ($1, $2, 'Cal', 'Tester', $3, $4, false, 'enabled', $5)`,
    [userId, tenantId, `cal.tester.${userId.slice(0, 8)}@example.test`, roleId, locale],
  );
  return userId;
}

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

    // Three OPEX lines, one of them through two columns and two years (counted once), and one CAPEX line.
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
    // Disabling stays possible, and the lines keep it.
    await svc.update(fr.id, { status: 'disabled' }, ctx);
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM spend_round_input_lines WHERE tenant_id = $1 AND working_day_profile_id = $2`,
      [tenantId, fr.id],
    );
    assert.equal(n, 5);

    // Only CAPEX left: the sentence names what is there.
    await runner.query(`DELETE FROM spend_round_input_lines WHERE tenant_id = $1 AND working_day_profile_id = $2`, [tenantId, fr.id]);
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

async function testStandardCalendarSource() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'source');
    const moselle = await svc.create({ code: 'FR-57', name: 'France (Moselle)', country_iso: ' fr ', region_code: '57' }, ctx);
    assert.deepEqual(
      [moselle.country_iso, moselle.region_code, moselle.country_name, moselle.region_name, moselle.days_by_year],
      ['FR', '57', 'France', 'Département Moselle', {}],
      'codes as the rules know them, names in English by default, no stored year',
    );
    const bavaria = await svc.create({ code: 'DE-BY', name: 'Bavaria', country_iso: 'DE', region_code: 'by', days_by_year: { 2026: DE_OFFICE } }, ctx);
    assert.deepEqual([bavaria.region_code, Object.keys(bavaria.days_by_year)], ['BY', ['2026']], 'days given at creation are edited years');
    const custom = await svc.create({ code: 'CUSTOM', name: 'Custom days', country_iso: '', region_code: null }, ctx);
    assert.deepEqual([custom.country_iso, custom.region_code, custom.country_name, custom.region_name], [null, null, null, null]);

    // Names in the language asked for, on the detail and the list.
    const french = await svc.get(bavaria.id, ctx, 'fr');
    assert.deepEqual([french.country_name, french.region_name], ['Allemagne', 'Bayern']);
    const list = await svc.list({ lang: 'fr', sort: 'country:ASC' }, ctx);
    assert.deepEqual(list.items.map((row) => [row.code, row.country_name]), [['DE-BY', 'Allemagne'], ['FR-57', 'France'], ['CUSTOM', null]]);
    assert.deepEqual(list.items.find((row) => row.code === 'FR-57')!.years, [], 'years keeps its meaning: the stored years');
    assert.deepEqual((await svc.list({ q: 'moselle' }, ctx)).items.map((row) => row.code), ['FR-57']);
    const byCountry = await svc.list({ filters: JSON.stringify({ country_iso: { filterType: 'set', values: ['FR'] } }) }, ctx);
    assert.deepEqual(byCountry.items.map((row) => row.code), ['FR-57']);

    // The rules must know the country and the region.
    await expectRefused(runner, /^Country ZZ is not in the list\.$/, () => svc.create({ code: 'ZZ', name: 'Nowhere', country_iso: 'ZZ' }, ctx));
    await expectRefused(runner, /^BY is not a region of France\.$/, () =>
      svc.create({ code: 'FR-BY', name: 'Wrong region', country_iso: 'FR', region_code: 'BY' }, ctx));
    await expectRefused(runner, /^Give the country of region 57\.$/, () => svc.create({ code: 'R57', name: 'Region only', region_code: '57' }, ctx));
    const [{ n: refusedRows }] = await runner.query(`SELECT count(*)::int AS n FROM working_day_profiles WHERE tenant_id = $1`, [tenantId]);
    assert.equal(refusedRows, 3);

    // The source never changes, whichever side the change comes from; the same values pass.
    const updates = await auditCount(runner, tenantId, 'update');
    for (const body of [
      { country_iso: 'DE' },
      { region_code: '67' },
      { region_code: null },
      { country_iso: null },
      { country_iso: 'FR', region_code: '' },
    ]) {
      await expectRefused(runner, SOURCE_REFUSAL, () => svc.update(moselle.id, body, ctx));
    }
    await expectRefused(runner, SOURCE_REFUSAL, () => svc.update(custom.id, { country_iso: 'FR' }, ctx));
    try {
      await svc.update(moselle.id, { country_iso: 'PL' }, ctx);
      assert.fail('should be refused');
    } catch (err: any) {
      assert.equal(err.getResponse().field, 'country_iso');
    }
    const same = await svc.update(moselle.id, { country_iso: 'fr', region_code: '57', name: 'France (Moselle)' }, ctx);
    assert.deepEqual([same.country_iso, same.region_code], ['FR', '57']);
    await svc.update(custom.id, { country_iso: null, region_code: '' }, ctx);
    assert.equal(await auditCount(runner, tenantId, 'update'), updates, 'an unchanged source writes nothing');
    const renamed = await svc.update(moselle.id, { name: 'Moselle office' }, ctx);
    assert.deepEqual([renamed.name, renamed.country_iso, renamed.region_code], ['Moselle office', 'FR', '57'], 'other fields change freely');

    // The database keeps the shape, raw SQL included.
    for (const [pattern, country, region] of [
      [/working_day_profiles_country_iso_check/, 'fr', null],
      [/working_day_profiles_country_iso_check/, 'FRA', null],
      [/working_day_profiles_region_country_check/, null, '57'],
      [/working_day_profiles_region_code_check/, 'FR', 'ABCDEFGHIJK'],
    ] as const) {
      await expectRefused(runner, pattern, () => runner.query(
        `INSERT INTO working_day_profiles (tenant_id, code, name, country_iso, region_code) VALUES ($1, 'RAW', 'Raw', $2, $3)`,
        [tenantId, country, region],
      ));
    }
  });
}

async function testYearRouteAndReset() {
  await withRollback(async (runner) => {
    const { svc, ctx } = await seed(runner, 'year');
    const france = await svc.create({ code: 'FR', name: 'France', country_iso: 'FR' }, ctx);
    const custom = await svc.create({ code: 'CUSTOM', name: 'Custom days', days_by_year: { 2027: FR218 } }, ctx);

    // A year nobody edited follows the rules: its standard values, and the holidays behind them.
    const standard = await svc.getYear(france.id, '2026', ctx, 'fr');
    assert.deepEqual([standard.year, standard.source, standard.days, standard.standard_days], [2026, 'standard', FRANCE_2026, FRANCE_2026]);
    assert.equal(standard.holidays.length, 11);
    assert.deepEqual(standard.holidays[0], { date: '2026-01-01', name: 'Nouvel An', weekend: false });
    assert.deepEqual(standard.holidays.filter((holiday) => holiday.weekend).map((holiday) => holiday.name), ['Assomption', 'Toussaint']);
    // Any year of the range exists by construction.
    assert.equal((await svc.getYear(france.id, '2100', ctx)).source, 'standard');

    // Editing a month stores the whole year: it is now edited, the standard values stay alongside.
    const edited = [...FRANCE_2026];
    edited[4] = '16.5';
    await svc.update(france.id, { days_by_year: { 2026: edited } }, ctx);
    const afterEdit = await svc.getYear(france.id, 2026, ctx);
    assert.deepEqual([afterEdit.source, afterEdit.days, afterEdit.standard_days], ['edited', edited, FRANCE_2026]);
    assert.equal(afterEdit.holidays[0].name, "New Year's Day");
    assert.equal((await svc.getYear(france.id, 2027, ctx)).source, 'standard', 'the other years keep following the rules');

    // Reset to standard: the edited year is removed and the rules apply again.
    const reset = await svc.update(france.id, { days_by_year: { 2026: null } }, ctx);
    assert.deepEqual(reset.days_by_year, {});
    const afterReset = await svc.getYear(france.id, 2026, ctx);
    assert.deepEqual([afterReset.source, afterReset.days], ['standard', FRANCE_2026]);

    // A custom calendar: its stored years only, no standard values, no holidays.
    assert.deepEqual(await svc.getYear(custom.id, 2027, ctx), { year: 2027, source: 'edited', days: FR218, standard_days: null, holidays: [] });
    assert.deepEqual(await svc.getYear(custom.id, 2026, ctx), { year: 2026, source: 'none', days: null, standard_days: null, holidays: [] });

    await expectRefused(runner, /^Pick a year between 2000 and 2100\.$/, () => svc.getYear(france.id, '1999', ctx));
    await expectRefused(runner, /^Pick a year between 2000 and 2100\.$/, () => svc.getYear(france.id, '2026a', ctx));
    await expectRefused(runner, /Calendar not found/, () => svc.getYear(randomUUID(), '2026', ctx));

    // The countries route: every country of the rules, names in the language asked for.
    const countries = svc.countries('es').items;
    assert.equal(countries.length, 207);
    assert.equal(countries.find((country) => country.code === 'DE')!.name, 'Alemania');
  });
}

async function testStandardValuesInComputation() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'compute');
    const france = await svc.create({ code: 'FR', name: 'France', country_iso: 'FR', days_by_year: { 2027: FR218 } }, ctx);
    const custom = await svc.create({ code: 'CUSTOM', name: 'Custom days', days_by_year: { 2027: FR218 } }, ctx);

    const loaded = await loadWorkingDayProfiles(runner.manager, tenantId, [france.id, custom.id]);
    assert.deepEqual([loaded.get(france.id)!.country_iso, loaded.get(france.id)!.region_code], ['FR', null]);
    assert.deepEqual(calendarDaysFor(loaded.get(france.id)!, 2026), FRANCE_2026, 'a standard calendar computes any year');
    assert.deepEqual(calendarDaysFor(loaded.get(france.id)!, 2027), FR218, 'an edited year wins');
    assert.deepEqual(calendarDaysFor(loaded.get(custom.id)!, 2027), FR218);
    assert.equal(calendarDaysFor(loaded.get(custom.id)!, 2026), null);

    // A line priced per day reads the same days.
    const { versionId } = await seedLine(runner, 'opex', tenantId, 2026);
    const amounts = new SpendAmountsService(undefined as any, undefined as any, undefined as any, captureAudit() as any, noFreeze as any);
    const payload = (calendarId: string) => ({
      kind: 'lines' as const,
      year: 2026,
      measure: 'planned' as const,
      lines: [{
        label: '', quantity_unit: 'people' as const, quantity: '1', unit_price: '400', price_basis: 'per_day' as const,
        period_start: '2026-01-01', period_end: '2026-12-31', working_day_profile_id: calendarId,
      }],
    });
    const written: any = await amounts.bulkUpsert(versionId, payload(france.id), null, { manager: runner.manager });
    const calculation = written.round_inputs[0].last_calculation;
    assert.deepEqual([calculation.lines[0].day_counts, calculation.lines[0].total_days, calculation.total], [FRANCE_2026, '252', '100800.00']);
    assert.deepEqual(await readMeasure(runner, 'opex', versionId, 'planned', 2026), FRANCE_2026.map((days) => `${Number(days) * 400}.00`));
    await expectRefused(
      runner,
      /^Line 1: Custom days has no working days for 2026\. Add them on the Working-day calendars page\.$/,
      () => amounts.bulkUpsert(versionId, payload(custom.id), null, { manager: runner.manager }),
    );
  });
}

async function testSuggestions() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'suggest');
    await seedCompany(runner, tenantId, 'Fromagerie Nord', 'FR');
    await seedCompany(runner, tenantId, 'Atelier Sud', 'fr');
    await seedCompany(runner, tenantId, 'Kaas BV', 'NL');
    await seedCompany(runner, tenantId, 'Formaggi', 'IT', { status: 'disabled', disabledAt: '2020-01-01T12:00:00Z' });
    await seedCompany(runner, tenantId, 'Cheese Inc', 'US');
    await seedCompany(runner, tenantId, 'Käse GmbH', 'DE');
    await seedCompany(runner, tenantId, 'Nowhere Ltd', 'ZZ');
    // A standard calendar for the whole country (whatever its status) takes the country out; a region does not.
    const us = await svc.create({ code: 'US-OFFICE', name: 'US office', country_iso: 'US' }, ctx);
    await svc.update(us.id, { status: 'disabled' }, ctx);
    await svc.create({ code: 'DE-BY', name: 'Bavaria', country_iso: 'DE', region_code: 'BY' }, ctx);

    const isos = async (lang?: string) => (await svc.suggestions(ctx, lang)).items.map((item) => item.country_iso);
    assert.deepEqual((await svc.suggestions(ctx)).items, [
      { country_iso: 'FR', country_name: 'France', companies: ['Atelier Sud', 'Fromagerie Nord'] },
      { country_iso: 'DE', country_name: 'Germany', companies: ['Käse GmbH'] },
      { country_iso: 'NL', country_name: 'Netherlands', companies: ['Kaas BV'] },
    ].sort((a, b) => a.country_name.localeCompare(b.country_name)));
    assert.deepEqual((await svc.suggestions(ctx, 'fr')).items.map((item) => item.country_name), ['Allemagne', 'France', 'Pays-Bas']);

    // A custom calendar with the country's code (without case) takes it out: creating it would be refused.
    const custom = await svc.create({ code: 'fr', name: 'Head office' }, ctx);
    assert.deepEqual(await isos(), ['DE', 'NL']);
    await svc.update(custom.id, { code: 'HQ' }, ctx);
    assert.deepEqual(await isos(), ['FR', 'DE', 'NL']);
    // So does one named like the country, without case.
    await svc.update(custom.id, { name: 'FRANCE' }, ctx);
    assert.deepEqual(await isos(), ['DE', 'NL']);
    // The name compared is the one in the language asked for.
    await svc.create({ code: 'DE-OFFICE', name: 'germany' }, ctx);
    assert.deepEqual(await isos(), ['NL']);
    assert.deepEqual((await svc.suggestions(ctx, 'fr')).items.map((item) => item.country_name), ['Allemagne', 'Pays-Bas']);

    // Once created, a country leaves the suggestions.
    await svc.create({ code: 'NL', name: 'Netherlands', country_iso: 'NL' }, ctx);
    assert.deepEqual(await isos(), []);
  });
}

async function testCompanyCreationAddsCalendar() {
  await withRollback(async (runner) => {
    const { tenantId, svc, ctx } = await seed(runner, 'company');
    const audit = new AuditService(runner.manager.getRepository(AuditLog));
    const companies = new CompaniesService(runner.manager.getRepository(Company), audit, undefined as any);
    const frenchUser = await seedUser(runner, tenantId, 'fr');
    const create = (name: string, country: string, userId: string | undefined) =>
      companies.create({ name, country_iso: country, city: 'Test city' } as any, userId, { manager: runner.manager });
    const standardCalendars = async () => runner.query(
      `SELECT code, name, country_iso, region_code FROM working_day_profiles WHERE tenant_id = $1 AND country_iso IS NOT NULL ORDER BY code`,
      [tenantId],
    );

    // The first company of a country adds its standard calendar, named in the creator's language.
    await create('Käse GmbH', 'DE', frenchUser);
    assert.deepEqual(await standardCalendars(), [{ code: 'DE', name: 'Allemagne', country_iso: 'DE', region_code: null }]);
    const [{ n: created }] = await runner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'working_day_profiles' AND action = 'create' AND user_id = $2`,
      [tenantId, frenchUser],
    );
    assert.equal(created, 1, 'audited as the creator');

    // Once only: a second company of the country adds nothing, nor does a calendar already there.
    await create('Käse Zwei', 'DE', frenchUser);
    await svc.create({ code: 'IT-OFFICE', name: 'Italy office', country_iso: 'IT' }, ctx);
    await create('Formaggi', 'IT', frenchUser);
    // Without a creator, the name is English.
    await create('Cheese Inc', 'us', undefined);
    assert.deepEqual((await standardCalendars()).map((row: any) => [row.code, row.name]), [
      ['DE', 'Allemagne'], ['IT-OFFICE', 'Italy office'], ['US', 'United States'],
    ]);

    // A taken code, or a country without rules, never fails the company, and the transaction goes on.
    await svc.create({ code: 'NL', name: 'Netherlands custom' }, ctx);
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
      const dutch = await create('Kaas BV', 'NL', frenchUser);
      assert.ok(dutch.id, 'the company is created');
      // A broken audit fails the calendar write after its insert: rolled back to the savepoint, the company stays.
      const broken = new CompaniesService(runner.manager.getRepository(Company), {
        log: async (entry: any) => {
          if (entry.table === 'working_day_profiles') throw new Error('audit down');
          return audit.log(entry, { manager: runner.manager });
        },
      } as any, undefined as any);
      const spanish = await broken.create({ name: 'Queso SL', country_iso: 'ES', city: 'Test city' } as any, frenchUser, { manager: runner.manager });
      assert.ok(spanish.id);
      await create('Nowhere Ltd', 'ZZ', frenchUser);
    } finally {
      console.warn = warn;
    }
    const calendarWarnings = warnings.filter((warning) => warning.includes('Standard calendar'));
    assert.equal(calendarWarnings.length, 2, calendarWarnings.join(' | '));
    assert.match(calendarWarnings[0], /Standard calendar for NL not created: A calendar with code NL already exists\./);
    assert.match(calendarWarnings[1], /Standard calendar for ES not created: audit down/);
    assert.deepEqual((await standardCalendars()).map((row: any) => row.code), ['DE', 'IT-OFFICE', 'US']);
    const names = await runner.query(`SELECT name FROM companies WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
    assert.deepEqual(names.map((row: any) => row.name), ['Cheese Inc', 'Formaggi', 'Kaas BV', 'Käse GmbH', 'Käse Zwei', 'Nowhere Ltd', 'Queso SL']);

    // Not on update.
    const [dutch] = await runner.query(`SELECT id FROM companies WHERE tenant_id = $1 AND name = 'Kaas BV'`, [tenantId]);
    await companies.update(dutch.id, { country_iso: 'BE' } as any, frenchUser, { manager: runner.manager });
    assert.deepEqual((await standardCalendars()).map((row: any) => row.code), ['DE', 'IT-OFFICE', 'US']);
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
  testStandardCalendarSource,
  testYearRouteAndReset,
  testStandardValuesInComputation,
  testSuggestions,
  testCompanyCreationAddsCalendar,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
