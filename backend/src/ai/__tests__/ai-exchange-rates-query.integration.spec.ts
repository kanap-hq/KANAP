// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PgClient, roleExists, seedNodes, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-exchange-rates-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The family `exchange_rates` of Plaid and the MCP server (Plaid L9, lot D), against the database
// and the real services of the Currency settings screen:
// - one row per year and currency of `ManualRatesService.listRateMatrix`, the reporting currency
//   included, with the same rate and source; the latest set of a year wins, a set captured in
//   another base is left out, a currency of the set not in use has no row;
// - `inverse_rate` and, with `against`, `cross_rate` computed by the server; a year without the
//   rate of either currency says so, with no value;
// - the settings (reporting currency, defaults, allowed currencies, empty said in words) and the
//   missing pairs (`listMissingPairs`) in every response;
// - a read writes nothing and starts no download: no statement but reads, the counts of the rate
//   sets, the currencies and the tenant metadata unchanged, `reportMissingYears` never called;
// - a workspace without any rate set says so; a year out of 1900-3000 and two `against` currencies
//   are refused in words;
// - without budget:reader, refused in words naming the exchange rates;
// - another tenant's sets and currencies never show;
// - a person limited to one company: the currencies of their lines only, the result marked limited.
//
// Fixture (reporting currency EUR, no allowed list):
// - L1 USD, paid by Alpha, versions 2026 and 2027; L2 CHF, paid by Bravo, versions 2026 and 2027;
// - 2026: an older set (USD 0.8), then the latest set (USD 0.89222, CHF 1.085591, GBP and JPY not
//   in use), downloaded spot rates;
// - 2027: USD 0.9 entered by hand, no CHF rate (a missing pair);
// - 2028: one set in USD (another base), left out;
// - another tenant: a 2026 set in EUR with USD 5 and a NOK line.

const SPOT_2026 = { EUR: 1, USD: 0.89222, CHF: 1.085591, GBP: 1.17, JPY: 0.0061 };

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  emptyTenantId: string;
  alpha: string;
  admin: string;
  noBudget: string;
  emptyAdmin: string;
  roles: { budgetReader: string };
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

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seedTenantRow(runner: QueryRunner, slug: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `${slug}-${tenantId.slice(0, 8)}`, `${slug} ${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

async function seedCompany(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  return insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'enabled', 'EUR')`,
    [tenantId, name]);
}

async function seedLine(runner: QueryRunner, tenantId: string, number: number, currency: string, payer: string, years: number[]): Promise<void> {
  const id = await insertId(runner,
    `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id)
     VALUES ($1, 'opex', $2, $3, $4, '2020-01-01', 'enabled', $5)`,
    [tenantId, number, `FX line ${number} ${tenantId.slice(0, 8)}`, currency, payer]);
  for (const year of years) {
    await runner.query(
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year) VALUES ($1, $2, $4, make_date($3, 1, 1), $3)`,
      [tenantId, id, year, `Budget ${year}`],
    );
  }
}

async function seedSet(
  runner: QueryRunner,
  tenantId: string,
  set: { year: number; base: string; rates: Record<string, number | null>; sources: Record<string, string> | null; source: string; capturedAt: string },
): Promise<void> {
  await runner.query(
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, rate_sources, rate_basis, source, captured_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'annual_avg', $6, $7)`,
    [tenantId, set.year, set.base, JSON.stringify(set.rates), set.sources ? JSON.stringify(set.sources) : null, set.source, set.capturedAt],
  );
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');
  await runner.query(`INSERT INTO currencies (code, name) VALUES ('EUR', 'Euro'), ('USD', 'US dollar'), ('CHF', 'Swiss franc'), ('NOK', 'Norwegian krone') ON CONFLICT (code) DO NOTHING`);

  // Another tenant, and a tenant without any rate set, first: the tenant of the spec stays the current one.
  const other = await seedTenantRow(runner, 'ai-fx-other');
  const zulu = await seedCompany(runner, other, `Zulu ${other.slice(0, 8)}`);
  await seedLine(runner, other, 1, 'NOK', zulu, [2026]);
  await seedSet(runner, other, { year: 2026, base: 'EUR', rates: { EUR: 1, USD: 5, NOK: 0.09 }, sources: { EUR: 'identity', USD: 'manual', NOK: 'manual' }, source: 'manual', capturedAt: '2026-06-01T00:00:00Z' });
  const emptyTenantId = await seedTenantRow(runner, 'ai-fx-empty');
  const emptyAdministrator = await seedRole(pg(runner), emptyTenantId, 'Administrator');
  const emptyAdmin = await seedPerson(pg(runner), emptyTenantId, 'all', emptyAdministrator);

  const tenantId = await seedTenantRow(runner, 'ai-fx');
  const alpha = await seedCompany(runner, tenantId, `Alpha ${tenantId.slice(0, 8)}`);
  const bravo = await seedCompany(runner, tenantId, `Bravo ${tenantId.slice(0, 8)}`);
  await seedLine(runner, tenantId, 1, 'USD', alpha, [2026, 2027]);
  await seedLine(runner, tenantId, 2, 'CHF', bravo, [2026, 2027]);
  await seedSet(runner, tenantId, { year: 2026, base: 'EUR', rates: { EUR: 1, USD: 0.8, CHF: 1 }, sources: { EUR: 'identity', USD: 'world-bank-annual', CHF: 'world-bank-annual' }, source: 'world-bank-annual', capturedAt: '2026-01-05T00:00:00Z' });
  await seedSet(runner, tenantId, {
    year: 2026,
    base: 'EUR',
    rates: SPOT_2026,
    sources: { EUR: 'identity', USD: 'exchangerateapi-spot', CHF: 'exchangerateapi-spot', GBP: 'exchangerateapi-spot', JPY: 'exchangerateapi-spot' },
    source: 'exchangerateapi-spot',
    capturedAt: '2026-10-01T08:00:00Z',
  });
  await seedSet(runner, tenantId, { year: 2027, base: 'EUR', rates: { EUR: 1, USD: 0.9 }, sources: { EUR: 'identity', USD: 'manual' }, source: 'world-bank-forward', capturedAt: '2026-10-02T08:00:00Z' });
  await seedSet(runner, tenantId, { year: 2028, base: 'USD', rates: { USD: 1, EUR: 1.1, CHF: 1.2 }, sources: { USD: 'identity', EUR: 'manual', CHF: 'manual' }, source: 'manual', capturedAt: '2026-10-03T08:00:00Z' });

  const client = pg(runner);
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const budgetReader = await seedRole(client, tenantId, 'Budget reader');
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'reader')`, [tenantId, budgetReader]);
  const reporter = await seedRole(client, tenantId, 'Report reader');
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'reporting', 'admin')`, [tenantId, reporter]);
  return {
    tenantId,
    emptyTenantId,
    alpha,
    admin: await seedPerson(client, tenantId, 'all', administrator),
    noBudget: await seedPerson(client, tenantId, 'all', reporter),
    emptyAdmin,
    roles: { budgetReader },
  };
}

function context(runner: QueryRunner, tenantId: string, userId: string) {
  return { tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'api_key', manager: runner.manager } as any;
}

function services() {
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { ManualRatesService } = require('../../currency/manual-rates.service');
  const { FxRateService } = require('../../currency/fx-rate.service');
  return {
    query: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    rates: app.get(ManualRatesService),
    fx: app.get(FxRateService),
  };
}

async function rejection(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected a refusal');
}

/** The rows as `[year, currency, rate, source]`. */
function rows(result: any): unknown[][] {
  return result.items.map((item: any) => [item.metadata.year, item.metadata.currency, item.metadata.rate, item.metadata.source]);
}

const round6 = (value: number) => Number(value.toFixed(6));

async function testMatrixAsTheScreen(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, rates } = services();
    const ctx = context(runner, s.tenantId, s.admin);
    const listed: any = await query.execute(ctx, { entity_type: 'exchange_rates', limit: 50 });
    assert.deepEqual(rows(listed), [
      [2026, 'EUR', 1, 'identity'],
      [2026, 'CHF', 1.085591, 'exchangerateapi-spot'],
      [2026, 'USD', 0.89222, 'exchangerateapi-spot'],
      [2027, 'EUR', 1, 'identity'],
      [2027, 'CHF', null, null],
      [2027, 'USD', 0.9, 'manual'],
    ], `the screen's matrix (${JSON.stringify(rows(listed))})`);

    // Parity with the screen's service: the same years, currencies, rates and sources.
    const matrix = await rates.listRateMatrix(s.tenantId, runner.manager);
    assert.deepEqual(matrix.currencies, ['EUR', 'CHF', 'USD']);
    const fromService = matrix.rates.flatMap((set: any) => matrix.currencies.map((code: string) => [set.fiscalYear, code, set.rates[code] ?? null, set.rateSources[code] ?? null]));
    assert.deepEqual(rows(listed), fromService, 'listRateMatrix, cell by cell');

    const usd = listed.items.find((item: any) => item.label === 'USD 2026');
    assert.equal(usd.id, '2026:USD');
    assert.equal(usd.ref, null, 'no reference');
    assert.equal(usd.metadata.inverse_rate, round6(1 / 0.89222), '1 EUR in USD, computed by the server');
    assert.equal(usd.metadata.inverse_rate, 1.1208);
    assert.equal(usd.metadata.reporting_currency, 'EUR');
    assert.equal(usd.metadata.manual, false);
    assert.equal(usd.metadata.captured_at, '2026-10-01T08:00:00.000Z', 'the latest set of the year');
    assert.equal(listed.items.find((item: any) => item.label === 'USD 2027').metadata.manual, true);
    assert.equal(listed.items.find((item: any) => item.label === 'CHF 2027').summary, 'No CHF rate is recorded for 2027, a year where CHF is used (missing_rates).');
    assert.ok(!('page_url' in usd), 'no page link: the Currency settings page is an administration setting');
    assert.doesNotMatch(JSON.stringify(listed.items), /GBP|JPY|NOK|"2028/, 'no currency outside the matrix, no set in another base, nothing of another tenant');

    // The settings and the missing pairs, in every response.
    assert.deepEqual(listed.exchange_rates.settings, {
      reporting_currency: 'EUR',
      default_opex_currency: 'EUR',
      default_capex_currency: 'EUR',
      allowed_currencies: [],
      allowed_currencies_note: 'Every currency is allowed: no list restricts the currencies of the budget lines.',
    });
    assert.deepEqual(listed.exchange_rates.missing_rates, [{ currency: 'CHF', year: 2027 }]);
    assert.deepEqual(listed.exchange_rates.missing_rates, await rates.listMissingPairs(s.tenantId, runner.manager, { report: false }), 'as the screen');
    const notes = listed.exchange_rates.notes.join('\n');
    assert.match(notes, /For example USD 2027 = 0\.9 means 1 USD = 0\.9 EUR, and its inverse_rate 1\.111111 means 1 EUR = 1\.111111 USD/);
    assert.match(notes, /the currencies are those in use/);
    assert.match(notes, /A frozen budget version keeps the set of rates captured when it was frozen/);
    assert.doesNotMatch(notes, /No exchange rate is recorded|Within your access/);
    assert.equal(listed.data_access, undefined, 'not limited');

    // Filters: one year and currency, the manual rates, the source; the same in an aggregate.
    const one: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { year: { op: 'eq', value: 2026 }, currency: ['usd'] } });
    assert.deepEqual(rows(one), [[2026, 'USD', 0.89222, 'exchangerateapi-spot']]);
    assert.deepEqual(rows(await query.execute(ctx, { entity_type: 'exchange_rates', filters: { manual: ['true'] } })), [[2027, 'USD', 0.9, 'manual']]);
    assert.deepEqual(rows(await query.execute(ctx, { entity_type: 'exchange_rates', filters: { source: [null] } })), [[2027, 'CHF', null, null]]);
    assert.deepEqual(
      rows(await query.execute(ctx, { entity_type: 'exchange_rates', sort: { field: 'year', direction: 'desc' }, filters: { currency: ['USD'] } })),
      [[2027, 'USD', 0.9, 'manual'], [2026, 'USD', 0.89222, 'exchangerateapi-spot']],
    );
    const { aggregates } = services();
    const bySource: any = await aggregates.execute(ctx, { entity_type: 'exchange_rates', group_by: 'source' });
    assert.deepEqual(bySource.groups.map((group: any) => [group.key, group.count]), [['exchangerateapi-spot', 2], ['identity', 2], ['manual', 1], [null, 1]]);
    assert.equal(bySource.total, 6);
    assert.deepEqual(bySource.exchange_rates.missing_rates, [{ currency: 'CHF', year: 2027 }]);
    const byYear: any = await aggregates.execute(ctx, { entity_type: 'exchange_rates', group_by: 'year', filters: { currency: ['USD', 'CHF'] } });
    assert.deepEqual(byYear.groups.map((group: any) => [group.key, group.count]), [['2026', 2], ['2027', 2]]);

    // A year given alone, as a number or as a string of one, is the year (Plaid L9, lot G); a value
    // that is not a number is refused with the form the field takes, never as an unknown field.
    for (const year of [2026, '2026']) {
      const bare: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { year, currency: ['USD'] } as any });
      assert.deepEqual(bare.filters_applied, ['year', 'currency'], `year ${JSON.stringify(year)} applied`);
      assert.deepEqual(rows(bare), [[2026, 'USD', 0.89222, 'exchangerateapi-spot']]);
    }
    const bareGroups: any = await aggregates.execute(ctx, { entity_type: 'exchange_rates', group_by: 'currency', filters: { year: '2027' } as any });
    assert.equal(bareGroups.total, 3, 'the aggregate reads the year alone too');
    const wrong: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { year: 'next year' } as any });
    assert.deepEqual(wrong.filters_ignored, ['year']);
    assert.equal(wrong.items.length, 0);
    const reason = wrong.suggested_repairs.find((repair: any) => repair.field === 'year')?.reason;
    assert.match(reason, /^year is a number field of exchange_rates, and the value given is not one it takes\. It takes a number alone \(2026 means \{"op":"eq","value":2026\}\) or a comparison, for example \{"op":"gte","value":10\}\. Nothing was searched/);
    assert.doesNotMatch(JSON.stringify(wrong), /Unsupported AI filter field/);

    // A year out of range, two currencies against: refused in words, the transaction intact.
    for (const value of [3, 10000]) {
      const refused = await rejection(() => query.execute(ctx, { entity_type: 'exchange_rates', filters: { year: { op: 'gt', value } } }));
      assert.match(String(refused?.message), /year is a year from 1900 to 3000/);
    }
    const two = await rejection(() => query.execute(ctx, { entity_type: 'exchange_rates', filters: { against: ['CHF', 'USD'] } }));
    assert.match(String(two?.message), /against takes one currency code/);
    assert.equal((await query.execute(ctx, { entity_type: 'exchange_rates' })).total, 6, 'the transaction is intact');
  });
  console.log('ok - exchange_rates: the screen\'s matrix with its settings and missing rates, inverse rates, filters and groups');
}

async function testCrossRate(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = services();
    const ctx = context(runner, s.tenantId, s.admin);
    const usdInChf: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { currency: ['USD'], against: 'CHF' } });
    const [y2026, y2027] = usdInChf.items;
    assert.equal(y2026.metadata.cross_rate, round6(0.89222 / 1.085591), '1 USD in CHF, from the two rates of 2026');
    assert.equal(y2026.metadata.cross_rate, 0.821875);
    assert.equal(y2026.metadata.cross_rate_note, undefined);
    assert.equal(y2027.metadata.cross_rate, null, 'no CHF rate in 2027: no value');
    assert.equal(y2027.metadata.cross_rate_note, 'No CHF rate is recorded for 2027, a year where CHF is used (missing_rates): no cross rate for this year.');
    assert.deepEqual(usdInChf.exchange_rates.against, {
      currency: 'CHF',
      in_matrix: true,
      years_without_cross_rate: [2027],
      note: 'cross_rate gives the units of CHF for 1 unit of the row\'s currency; a year where either rate is missing has none (cross_rate_note).',
    });
    assert.match(usdInChf.exchange_rates.notes.join('\n'), /cross_rate is the number of CHF for 1 unit of the row's currency/);
    // Against the reporting currency: the rate itself.
    const inEur: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { year: { op: 'eq', value: 2026 }, currency: ['USD'], against: ['eur'] } });
    assert.equal(inEur.items[0].metadata.cross_rate, 0.89222);
    // A currency outside the matrix: said, no value.
    const gbp: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { currency: ['USD'], against: ['GBP'] } });
    assert.ok(gbp.items.every((item: any) => item.metadata.cross_rate === null && item.metadata.cross_rate_note === 'GBP is not in the rate matrix: no cross rate.'));
    assert.equal(gbp.exchange_rates.against.in_matrix, false);
    assert.match(gbp.exchange_rates.against.note, /GBP is not among the currencies of the rate matrix \(no budget line/);

    // The case of the review (Plaid L9, lot F, m2): JPY is in the 2026 set but not in use, and
    // shown for a manual rate of 2029 only. The screen leaves its 2026 cell empty; the answer says
    // that, never that 2026 has no JPY rate.
    await seedSet(runner, s.tenantId, { year: 2029, base: 'EUR', rates: { EUR: 1, JPY: 0.006 }, sources: { EUR: 'identity', JPY: 'manual' }, source: 'manual', capturedAt: '2026-10-04T08:00:00Z' });
    const usdInJpy: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { year: { op: 'eq', value: 2026 }, currency: ['USD', 'JPY'], against: 'JPY' } });
    const jpy2026 = usdInJpy.items.find((item: any) => item.label === 'JPY 2026');
    const usd2026 = usdInJpy.items.find((item: any) => item.label === 'USD 2026');
    const empty = 'The rate matrix of the Currency settings screen has no JPY rate for 2026 (the screen leaves the cell empty)';
    assert.equal(jpy2026.metadata.rate, null);
    assert.equal(jpy2026.summary, `${empty}.`);
    assert.equal(usd2026.metadata.cross_rate, null);
    assert.equal(usd2026.metadata.cross_rate_note, `${empty}: no cross rate for this year.`);
    assert.doesNotMatch(JSON.stringify(usdInJpy.items), /No JPY rate/);
  });
  console.log('ok - exchange_rates: cross rates computed by the server, a year without one said with no value');
}

async function testReadWritesNothing(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates, rates, fx } = services();
    const ctx = context(runner, s.tenantId, s.admin);
    const counts = async () => (await runner.query(
      `SELECT (SELECT count(*)::int FROM currency_rate_sets WHERE tenant_id = $1) AS sets,
              (SELECT max(updated_at)::text FROM currency_rate_sets WHERE tenant_id = $1) AS sets_updated,
              (SELECT count(*)::int FROM currencies) AS currencies,
              (SELECT metadata::text FROM tenants WHERE id = $1) AS metadata,
              (SELECT updated_at::text FROM tenants WHERE id = $1) AS tenant_updated`,
      [s.tenantId],
    ))[0];
    const before = await counts();
    assert.equal(before.sets, 4);

    const reported: unknown[] = [];
    const spy = (...args: unknown[]) => { reported.push(args); };
    const original = fx.reportMissingYears;
    fx.reportMissingYears = spy;
    const statements: string[] = [];
    const query0 = runner.query.bind(runner);
    (runner as any).query = (sql: string, params?: unknown[], ...rest: unknown[]) => {
      statements.push(sql);
      return query0(sql, params as any[], ...(rest as []));
    };
    try {
      const listed: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { against: ['CHF'] } });
      assert.deepEqual(listed.exchange_rates.missing_rates, [{ currency: 'CHF', year: 2027 }], 'a year without a rate is listed');
      await aggregates.execute(ctx, { entity_type: 'exchange_rates', group_by: 'year' });
    } finally {
      (runner as any).query = query0;
      fx.reportMissingYears = original;
    }
    const writes = statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|LOCK)\b/i.test(sql) || /FOR (NO KEY )?UPDATE|pg_advisory/i.test(sql));
    assert.ok(statements.length > 0, 'the statements are captured');
    assert.deepEqual(writes, [], `no write and no lock (${writes.join(' | ')})`);
    assert.deepEqual(reported, [], 'no download of the missing years');
    assert.deepEqual(await counts(), before, 'the rate sets, the currencies and the tenant unchanged');

    // Counter-check: the screen's own route reports the missing year, which the spy sees.
    fx.reportMissingYears = spy;
    try {
      await rates.listMissingPairs(s.tenantId, runner.manager);
    } finally {
      fx.reportMissingYears = original;
    }
    assert.deepEqual(reported, [[s.tenantId, [2027]]], 'the default call reports the year: the spy is wired');
  });
  console.log('ok - exchange_rates: a read writes nothing and starts no download');
}

async function testWorkspaceWithoutRates(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.emptyTenantId]);
    const { query } = services();
    const listed: any = await query.execute(context(runner, s.emptyTenantId, s.emptyAdmin), { entity_type: 'exchange_rates' });
    assert.equal(listed.total, 0);
    assert.deepEqual(listed.exchange_rates.missing_rates, []);
    assert.equal(listed.exchange_rates.missing_rates_note, 'No rate is missing: every currency in use has a rate for every year it is used in.');
    const notes = listed.exchange_rates.notes.join('\n');
    assert.match(notes, /No exchange rate is recorded in this workspace\. Rates come from the configured rate sources or are entered by hand on the Currency settings screen; on an installation without a rate source they stay empty/);
    assert.doesNotMatch(notes, /For example/, 'no figure to give');
    assert.equal(listed.exchange_rates.settings.reporting_currency, 'EUR');

    // An allowed list is given as stored.
    await runner.query(`UPDATE tenants SET metadata = metadata || '{"allowed_currencies":["EUR","USD"]}'::jsonb WHERE id = $1`, [s.emptyTenantId]);
    const allowed: any = await query.execute(context(runner, s.emptyTenantId, s.emptyAdmin), { entity_type: 'exchange_rates' });
    assert.deepEqual(allowed.exchange_rates.settings.allowed_currencies, ['EUR', 'USD']);
    assert.equal(allowed.exchange_rates.settings.allowed_currencies_note, undefined);
  });
  console.log('ok - exchange_rates: a workspace without any rate says so');
}

async function testBudgetRight(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = services();
    const ctx = context(runner, s.tenantId, s.noBudget);
    for (const run of [
      () => query.execute(ctx, { entity_type: 'exchange_rates' }),
      () => aggregates.execute(ctx, { entity_type: 'exchange_rates', group_by: 'source' }),
    ]) {
      const refused = await rejection(run);
      assert.equal(refused?.getStatus?.(), 403);
      assert.equal(
        String(refused?.message),
        'You need the right to read budget lines to read the exchange rates and the currency settings, which your role does not give. An administrator can add it to your role.',
      );
    }
    const reader = await seedPerson(pg(runner), s.tenantId, 'all', s.roles.budgetReader);
    const read: any = await query.execute(context(runner, s.tenantId, reader), { entity_type: 'exchange_rates' });
    assert.equal(read.total, 6, 'budget at reader level reads them');
  });
  console.log('ok - exchange_rates: refused in words without the budget right, read at reader level');
}

async function testLimitedPerson(): Promise<void> {
  await inTransaction(async (runner) => {
    const client = pg(runner);
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('skip - exchange_rates limited person: kanap_data_limited not installed');
      return;
    }
    const s = await seed(runner);
    const person = await seedPerson(client, s.tenantId, 'limited', s.roles.budgetReader);
    await seedNodes(client, s.tenantId, person, [{ type: 'company', id: s.alpha, access: 'read' }]);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [person]))[0].mode, 'limited');
    const { query, aggregates } = services();
    const ctx = context(runner, s.tenantId, person);
    const listed: any = await query.execute(ctx, { entity_type: 'exchange_rates' });
    // The USD line is paid by Alpha; the CHF line, paid by Bravo, is outside the access.
    assert.deepEqual(rows(listed), [
      [2026, 'EUR', 1, 'identity'],
      [2026, 'USD', 0.89222, 'exchangerateapi-spot'],
      [2027, 'EUR', 1, 'identity'],
      [2027, 'USD', 0.9, 'manual'],
    ]);
    assert.deepEqual(listed.exchange_rates.missing_rates, [], 'the CHF of a line outside the access is not listed');
    assert.equal(listed.data_access, 'limited');
    assert.match(listed.data_access_note, /within your access/);
    assert.match(listed.exchange_rates.notes.join('\n'), /Within your access: the currencies in use are read from the budget lines and contracts you see/);
    const grouped: any = await aggregates.execute(ctx, { entity_type: 'exchange_rates', group_by: 'currency' });
    assert.equal(grouped.data_access, 'limited');
    assert.deepEqual(grouped.groups.map((group: any) => group.key).sort(), ['EUR', 'USD']);
    // CHF is used by a line outside the access: the note says so within the access (lot F, m3).
    const against: any = await query.execute(ctx, { entity_type: 'exchange_rates', filters: { against: 'CHF' } });
    assert.equal(against.exchange_rates.against.in_matrix, false);
    assert.equal(against.exchange_rates.against.note, 'CHF is not among the currencies of the rate matrix within your access (no budget line, company, contract or setting within your access uses it, and it has no manual rate): no cross rate can be given.');
    assert.ok(against.items.every((item: any) => item.metadata.cross_rate_note === 'CHF is not in the rate matrix within your access: no cross rate.'));
  });
  console.log('ok - exchange_rates: a limited person reads the currencies of their lines, marked limited');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-exchange-rates-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['matrix as the screen', testMatrixAsTheScreen],
      ['cross rate', testCrossRate],
      ['a read writes nothing', testReadWritesNothing],
      ['workspace without rates', testWorkspaceWithoutRates],
      ['budget right', testBudgetRight],
      ['limited person', testLimitedPerson],
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
  console.log('ai-exchange-rates-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
