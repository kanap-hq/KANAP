// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PgClient, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-working-day-calendars-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The family `working_day_calendars` of Plaid and the MCP server (Plaid L9, lot B), against the
// database and the real `WorkingDayProfilesService` of Master data › Working-day calendars:
// - a standard calendar stores no year, and the year filter still gives its working days, equal to
//   the screen's year (`getYear`), with their total summed exactly by the server; a standard one
//   with an edited year reads `edited`; a custom one reads its stored year, fractional months
//   summed exactly, and a year it lacks reads `source: none` with no total (never 0);
// - a year out of 2000-2100, or another operator than eq, refused in words;
// - the country and the public holidays in the person's language (French and English);
// - the detail by code: the twelve months, the holidays by name, the lines using the calendar as
//   the screen counts them;
// - refused in words without the right on working-day calendars;
// - another tenant's calendars never show;
// - the calendar's History tab reads by its code.
//
// Fixture: FR (France, standard, no year stored), DE (Germany, standard, 2026 edited to 200 days),
// CAD (custom, 2026 at 19.083333 a month, 2025 at 18 a month); one OPEX line with a per-day price
// line on CAD.

const CUSTOM_2026 = Array(12).fill('19.083333');
const EDITED_DE_2026 = ['16', '16', '16', '16', '16', '16', '16', '16', '18', '18', '18', '18'];

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  tag: string;
  ids: { fr: string; de: string; cad: string };
  otherCalendar: string;
  english: string;
  french: string;
  noRight: string;
};

async function inTransaction(fn: (runner: QueryRunner) => Promise<void>): Promise<void> {
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

function pg(runner: QueryRunner): PgClient {
  return {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }),
  };
}

async function seedTenantRow(runner: QueryRunner, slug: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `${slug}-${tenantId.slice(0, 8)}`, `${slug} ${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

function calendarService() {
  const { WorkingDayProfilesService } = require('../../working-day-profiles/working-day-profiles.service');
  return app.get(WorkingDayProfilesService);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');
  const service = calendarService();
  const client = pg(runner);

  // Another tenant first, so the tenant of the spec stays the current one.
  const other = await seedTenantRow(runner, 'ai-wdc-other');
  const otherAdmin = await seedPerson(client, other, 'all', await seedRole(client, other, 'Administrator'));
  const otherCalendar = (await service.create({ code: 'ZULU', name: `Zulu ${other.slice(0, 8)}` }, { manager: runner.manager, tenantId: other, userId: otherAdmin })).id;

  const tenantId = await seedTenantRow(runner, 'ai-wdc');
  const tag = tenantId.slice(0, 8);
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const english = await seedPerson(client, tenantId, 'all', administrator);
  const french = await seedPerson(client, tenantId, 'all', administrator);
  await runner.query(`UPDATE users SET locale = 'en' WHERE id = $1`, [english]);
  await runner.query(`UPDATE users SET locale = 'fr' WHERE id = $1`, [french]);
  const budgetOnly = await seedRole(client, tenantId, 'Budget reader');
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'admin')`, [tenantId, budgetOnly]);
  const noRight = await seedPerson(client, tenantId, 'all', budgetOnly);

  // Through the screen's service, which writes the History tab's entries.
  const ctx = { manager: runner.manager, tenantId, userId: english };
  const fr = (await service.create({ code: 'FR', name: `France ${tag}`, country_iso: 'FR' }, ctx)).id;
  const de = (await service.create({ code: 'DE', name: `Germany ${tag}`, country_iso: 'DE', days_by_year: { 2026: EDITED_DE_2026 } }, ctx)).id;
  const cad = (await service.create({
    code: 'CAD',
    name: `Custom ${tag}`,
    description: 'A custom calendar',
    days_by_year: { 2025: Array(12).fill('18'), 2026: CUSTOM_2026 },
  }, ctx)).id;

  // One OPEX line with a per-day price line on CAD.
  const [{ id: itemId }] = await runner.query(
    `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status)
     VALUES ($1, 'opex', 1, 'Calendar line', 'EUR', '2020-01-01', 'enabled') RETURNING id`, [tenantId]);
  const [{ id: versionId }] = await runner.query(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, 'Budget', '2026-01-01', 2026) RETURNING id`,
    [tenantId, itemId]);
  const [{ id: roundId }] = await runner.query(
    `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method)
     VALUES ($1, $2, 'planned', '2026-01-01', '2026-12-31', 'manual') RETURNING id`, [tenantId, versionId]);
  await runner.query(
    `INSERT INTO spend_round_input_lines (tenant_id, round_input_id, sort, label, quantity_unit, quantity, unit_price, price_basis, frequency, period_start, period_end, working_day_profile_id)
     VALUES ($1, $2, 1, 'Days', 'days', 10, 500, 'per_day', 'once', '2026-01-01', '2026-12-31', $3)`, [tenantId, roundId, cad]);

  return { tenantId, tag, ids: { fr, de, cad }, otherCalendar, english, french, noRight };
}

function context(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'api_key', manager: runner.manager } as any;
}

function executors() {
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiRecordHistoryService } = require('../ai-record-history.service');
  return { query: app.get(AiQueryExecutor), aggregates: app.get(AiAggregateExecutor), history: app.get(AiRecordHistoryService) };
}

async function rejection(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected a refusal');
}

async function withoutSurfaceChecks<T>(fn: () => Promise<T>): Promise<T> {
  const { AiPolicyService } = require('../ai-policy.service');
  const policy = app.get(AiPolicyService);
  const original = policy.assertSurfaceAccess;
  policy.assertSurfaceAccess = async () => undefined;
  try {
    return await fn();
  } finally {
    policy.assertSurfaceAccess = original;
  }
}

/** The exact sum of decimal day strings, in millionths, as the test's own arithmetic. */
function exactSum(days: string[]): number {
  const millionths = days.reduce((sum, day) => {
    const [whole, fraction = ''] = day.split('.');
    return sum + BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  }, 0n);
  return Number(millionths) / 1_000_000;
}

function byCode(result: any): Map<string, any> {
  return new Map(result.items.map((item: any) => [item.ref, item]));
}

async function testYearAsTheScreen(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const ctx = context(runner, s, s.english);
    const service = calendarService();
    const sctx = { manager: runner.manager, tenantId: s.tenantId };

    // Without a year: every calendar, by code, no days, and the note asking for a year.
    const plain: any = await query.execute(ctx, { entity_type: 'working_day_calendars' });
    assert.deepEqual(plain.items.map((item: any) => item.ref), ['CAD', 'DE', 'FR'], 'the screen\'s order, by code');
    assert.equal(plain.total, 3);
    assert.equal(plain.calendar_year, null);
    assert.match(plain.calendar_note, /Give the year filter/);
    const fr = byCode(plain).get('FR');
    assert.equal(fr.metadata.kind, 'standard');
    assert.equal(fr.metadata.country, 'France');
    assert.equal(fr.metadata.years_edited, null, 'a standard calendar stores no year');
    assert.equal(fr.metadata.total_days, undefined, 'no days without a year');
    assert.equal(byCode(plain).get('CAD').metadata.kind, 'custom');
    assert.equal(byCode(plain).get('CAD').metadata.years_edited, '2025, 2026');

    // 2026: each row as the screen's year, the total summed exactly.
    const listed: any = await query.execute(ctx, { entity_type: 'working_day_calendars', filters: { year: { op: 'eq', value: 2026 } } });
    assert.deepEqual(listed.filters_applied, ['year']);
    assert.equal(listed.calendar_year, 2026);
    assert.match(listed.calendar_note, /computed by the server/);
    for (const [code, id] of Object.entries({ FR: s.ids.fr, DE: s.ids.de, CAD: s.ids.cad })) {
      const screen = await service.getYear(id, '2026', sctx, 'en');
      const item = byCode(listed).get(code);
      assert.equal(item.metadata.source, screen.source, `${code}: the source of the screen's year`);
      assert.equal(item.metadata.total_days, exactSum(screen.days), `${code}: the total of the screen's months`);
    }
    assert.equal(byCode(listed).get('FR').metadata.source, 'standard', 'no year stored: the public holidays');
    assert.ok(byCode(listed).get('FR').metadata.total_days > 240 && byCode(listed).get('FR').metadata.total_days < 260, 'France 2026: weekdays less holidays');
    assert.equal(byCode(listed).get('DE').metadata.source, 'edited');
    assert.equal(byCode(listed).get('DE').metadata.total_days, 200);
    assert.equal(byCode(listed).get('CAD').metadata.source, 'edited');
    assert.equal(byCode(listed).get('CAD').metadata.total_days, 228.999996, 'twelve months of 19.083333, exactly');

    // A year given alone, as a number or as a string of one, is the year (Plaid L9, lot G).
    for (const year of [2026, '2026']) {
      const bare: any = await query.execute(ctx, { entity_type: 'working_day_calendars', filters: { year } as any });
      assert.deepEqual(bare.filters_applied, ['year'], `year ${JSON.stringify(year)} applied`);
      assert.equal(bare.calendar_year, 2026);
      assert.deepEqual(bare.items.map((item: any) => [item.ref, item.metadata.total_days]), listed.items.map((item: any) => [item.ref, item.metadata.total_days]));
    }

    // The year argument of query_entities sets it too; a year the custom calendar lacks has no days.
    const next: any = await query.execute(ctx, { entity_type: 'working_day_calendars', year: 2027 });
    assert.equal(next.calendar_year, 2027);
    assert.equal(byCode(next).get('CAD').metadata.source, 'none');
    assert.equal(byCode(next).get('CAD').metadata.total_days, null, 'a missing year has no total, never 0');
    assert.equal(byCode(next).get('DE').metadata.source, 'standard', 'an unedited year of a standard calendar');
    const none: any = await query.execute(ctx, { entity_type: 'working_day_calendars', filters: { year: { op: 'eq', value: 2027 }, source: ['none'] } });
    assert.deepEqual(none.items.map((item: any) => item.ref), ['CAD']);

    // Sorted by total, filtered on a part of the country.
    const sorted: any = await query.execute(ctx, { entity_type: 'working_day_calendars', year: 2026, sort: { field: 'total_days', direction: 'asc' } });
    assert.deepEqual(sorted.items.map((item: any) => item.ref), ['DE', 'CAD', 'FR']);
    const france: any = await query.execute(ctx, { entity_type: 'working_day_calendars', filters: { country: 'fran' } });
    assert.deepEqual(france.items.map((item: any) => item.ref), ['FR']);

    // Out of the years, or another operator: refused in words.
    for (const filters of [{ year: { op: 'eq', value: 2101 } }, { year: { op: 'gte', value: 2026 } }]) {
      const refused = await rejection(() => query.execute(ctx, { entity_type: 'working_day_calendars', filters }));
      assert.equal(refused?.getStatus?.(), 400);
      assert.match(String(refused?.message), /reads one year, from 2000 to 2100/);
    }
    const refusedArgument = await rejection(() => query.execute(ctx, { entity_type: 'working_day_calendars', year: 1950 }));
    assert.match(String(refusedArgument?.message), /reads one year/);
  });
  console.log('ok - working_day_calendars: the year as the screen, exact totals, a missing year none, years out of range refused');
}

async function testLanguageAndDetail(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const service = calendarService();
    const sctx = { manager: runner.manager, tenantId: s.tenantId };

    const names = async (userId: string) => {
      const detail: any = await query.executeDetail(context(runner, s, userId), { entity_type: 'working_day_calendars', entity_id: 'FR', year: 2026 });
      return detail;
    };
    const english = await names(s.english);
    const french = await names(s.french);
    for (const [detail, lang] of [[english, 'en'], [french, 'fr']] as const) {
      const screen = await service.getYear(s.ids.fr, '2026', sctx, lang);
      assert.deepEqual(detail.data.holidays.map((holiday: any) => [holiday.date, holiday.name]), screen.holidays.map((holiday: any) => [holiday.date, holiday.name]), `${lang}: the screen's holidays`);
      assert.equal(detail.data.months.length, 12);
      assert.deepEqual(detail.data.months.map((month: any) => month.days), screen.days.map(Number), `${lang}: the twelve months`);
      assert.equal(detail.data.total_days, exactSum(screen.days));
    }
    const newYear = (detail: any) => detail.data.holidays.find((holiday: any) => holiday.date === '2026-01-01')?.name;
    assert.ok(newYear(english) && newYear(french) && newYear(english) !== newYear(french), `the holidays in each language (${newYear(english)} / ${newYear(french)})`);
    const germany = async (userId: string) => (await query.execute(context(runner, s, userId), { entity_type: 'working_day_calendars', filters: { code: 'DE' } })).items[0].metadata.country;
    assert.equal(await germany(s.english), 'Germany');
    assert.equal(await germany(s.french), 'Allemagne');

    // The detail by code: the lines using it as the screen counts them, the year's months.
    const cad: any = await query.executeDetail(context(runner, s, s.english), { entity_type: 'working_day_calendars', entity_id: 'cad', year: 2026 });
    const screen = await service.get(s.ids.cad, sctx, 'en');
    assert.equal(cad.entity.id, s.ids.cad);
    assert.equal(cad.entity.ref, 'CAD');
    assert.deepEqual(cad.data.lines_using, { opex: screen.opex_count, capex: screen.capex_count });
    assert.deepEqual(cad.data.lines_using, { opex: 1, capex: 0 });
    assert.equal(cad.data.kind, 'custom');
    assert.equal(cad.data.source, 'edited');
    assert.equal(cad.data.total_days, 228.999996);
    assert.deepEqual(cad.data.holidays, [], 'a custom calendar has no public holidays');
    assert.equal(cad.data.days_by_year, undefined, 'the stored years are never read as the days');
    const noYear: any = await query.executeDetail(context(runner, s, s.english), { entity_type: 'working_day_calendars', entity_id: 'CAD' });
    assert.equal(noYear.data.months, undefined);
    assert.match(noYear.data.year_note, /Give the year filter/);
    const missing: any = await query.executeDetail(context(runner, s, s.english), { entity_type: 'working_day_calendars', entity_id: 'CAD', year: 2030 });
    assert.equal(missing.data.source, 'none');
    assert.equal(missing.data.total_days, null);
    assert.equal(missing.data.months, null);

    // The aggregate counts the calendars in memory.
    const { aggregates } = executors();
    const grouped: any = await aggregates.execute(context(runner, s, s.english), { entity_type: 'working_day_calendars', group_by: 'kind' });
    assert.deepEqual(grouped.groups.map((group: any) => [group.key, group.count]), [['standard', 2], ['custom', 1]]);
    assert.equal(grouped.total, 3);
    const bySource: any = await aggregates.execute(context(runner, s, s.english), { entity_type: 'working_day_calendars', group_by: 'source', filters: { year: { op: 'eq', value: 2027 } } });
    assert.deepEqual(bySource.groups.map((group: any) => [group.key, group.count]), [['standard', 2], ['none', 1]]);
  });
  console.log('ok - working_day_calendars: holidays and country in the person\'s language, the detail by code with the lines using it');
}

async function testRightTenantAndHistory(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates, history } = executors();

    // Without the right on working-day calendars: refused in words, naming the screen.
    const ctx = context(runner, s, s.noRight);
    for (const run of [
      () => query.execute(ctx, { entity_type: 'working_day_calendars' }),
      () => query.executeDetail(ctx, { entity_type: 'working_day_calendars', entity_id: s.ids.fr }),
      () => aggregates.execute(ctx, { entity_type: 'working_day_calendars', group_by: 'kind' }),
    ]) {
      const refused = await rejection(run);
      assert.equal(refused?.getStatus?.(), 403);
      assert.match(String(refused?.message), /^You need the right to read working-day calendars \(the right the Master data › Working-day calendars screen asks for\)/, String(refused?.message));
    }

    // Another tenant's calendar never shows, by code nor by id.
    const admin = context(runner, s, s.english);
    const all: any = await query.execute(admin, { entity_type: 'working_day_calendars', limit: 100 });
    assert.doesNotMatch(JSON.stringify(all), /ZULU|Zulu/);
    const byCodeRefused = await rejection(() => query.executeDetail(admin, { entity_type: 'working_day_calendars', entity_id: 'ZULU' }));
    assert.equal(byCodeRefused?.getStatus?.(), 404);
    const byIdRefused = await rejection(() => query.executeDetail(admin, { entity_type: 'working_day_calendars', entity_id: s.otherCalendar }));
    assert.equal(byIdRefused?.getStatus?.(), 404);

    // The History tab, by the calendar's code (the surface checks, tenant settings and features,
    // are ai-record-history.integration.spec's).
    const page: any = await withoutSurfaceChecks(() => history.getRecordHistory(admin, { entity_type: 'working_day_calendars', entity_id: 'CAD', limit: 20 }));
    assert.deepEqual(page.items.map((item: any) => item.action), ['create']);
    assert.equal(page.entity.type, 'working_day_calendars');
  });
  console.log('ok - working_day_calendars: refused in words without the right, another tenant invisible, history by code');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-working-day-calendars-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['year as the screen', testYearAsTheScreen],
      ['language and detail', testLanguageAndDetail],
      ['right, tenant and history', testRightTenantAndHistory],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
      } catch (error: any) {
        failures.push(`${name}: ${error?.stack ?? error}`);
      }
    }
  } finally {
    await app.close();
  }
  if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
  console.log('ai-working-day-calendars-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
