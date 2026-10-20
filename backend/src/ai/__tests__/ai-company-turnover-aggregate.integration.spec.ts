import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { Company } from '../../companies/company.entity';
import { CompaniesService } from '../../companies/companies.service';
import { CurrencyRateSet } from '../../currency/currency-rate-set.entity';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { Tenant } from '../../tenants/tenant.entity';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiAggregateExecutor } from '../query/ai-aggregate.executor';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Company turnover in aggregate_entities is converted into the reporting currency
// before it is summed. A company without a rate is left out and named. Rows keep
// the company's own value.
// @database-spec: opens the data-source. Run it on a dedicated database, never appdb.

const EUR_TURNOVER = 10;
const USD_TURNOVER = 8;
const USD_RATE = 1.5;
const USD_CONVERTED = USD_TURNOVER * USD_RATE;
const BLANK_TURNOVER = 4;
const XTS_IN_MIXED = 100;

type Ids = {
  euro: string;
  dollar: string;
  alpine: string;
  blank: string;
  kyoto: string;
  osaka: string;
};

function context(runner: QueryRunner, tenantId: string): AiExecutionContextWithManager {
  return {
    tenantId,
    userId: null as any,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    manager: runner.manager,
  };
}

function executors(runner: QueryRunner) {
  const companies = new CompaniesService(runner.manager.getRepository(Company), {} as any, {} as any);
  const fxRates = new FxRateService(
    runner.manager.getRepository(CurrencyRateSet),
    new CurrencySettingsService(runner.manager.getRepository(Tenant), {} as any),
  );
  const aggregateArgs: any[] = Array.from({ length: 23 }, () => ({}));
  aggregateArgs[7] = companies;
  aggregateArgs[22] = undefined; // AiPolicyService, optional
  aggregateArgs[23] = fxRates;
  const queryArgs: any[] = Array.from({ length: 24 }, () => ({}));
  queryArgs[7] = companies;
  return {
    aggregates: new (AiAggregateExecutor as any)(...aggregateArgs) as AiAggregateExecutor,
    query: new (AiQueryExecutor as any)(...queryArgs) as AiQueryExecutor,
  };
}

async function insertCompany(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  country: string,
  currency: string | null,
  turnover: number,
  headcount: number,
  year: number,
): Promise<string> {
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency)
     VALUES ($1, $2, $3, 'Lyon', $4) RETURNING id`,
    [tenantId, name, country, currency],
  );
  await runner.query(
    `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, turnover)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, company.id, year, headcount, turnover],
  );
  return company.id as string;
}

function pairs(groups: ReadonlyArray<{ key: string | null; value?: unknown; count?: unknown }>, field: 'value' | 'count') {
  return groups.map((group) => [group.key == null ? null : String(group.key).trim(), group[field]]);
}

function noteOf(result: { amounts_currency_note?: string }): string {
  assert.equal(typeof result.amounts_currency_note, 'string');
  return result.amounts_currency_note as string;
}

const tests: Array<[string, () => Promise<void>]> = [
  ['turnover aggregates convert, leave out a company without a rate, and name the currency', () => inRolledBackTransaction(async (runner) => {
    const [{ current }] = await runner.query(`SELECT current_database() AS current`);
    assert.notEqual(current, 'appdb', 'this spec must not write the dev database');
    const [{ year }] = await runner.query(`SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS year`);
    const tenantId = await seedTenant(runner, 'ai-turnover');
    await runner.query(
      `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"reporting_currency":"EUR"}'::jsonb WHERE id = $1`,
      [tenantId],
    );
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates)
       VALUES ($1, $2, 'EUR', $3::jsonb)`,
      [tenantId, year, JSON.stringify({ USD: USD_RATE })],
    );

    const ids: Ids = {
      euro: await insertCompany(runner, tenantId, 'EuroZX', 'FR', 'EUR', EUR_TURNOVER, 1, year),
      dollar: await insertCompany(runner, tenantId, 'DollarZX', 'FR', 'USD', USD_TURNOVER, 2, year),
      alpine: await insertCompany(runner, tenantId, 'AlpineZX', 'FR', 'XTS', XTS_IN_MIXED, 4, year),
      blank: await insertCompany(runner, tenantId, 'BlankZX', 'DE', null, BLANK_TURNOVER, 8, year),
      kyoto: await insertCompany(runner, tenantId, 'KyotoZX', 'JP', 'XTS', 40, 16, year),
      osaka: await insertCompany(runner, tenantId, 'OsakaZX', 'JP', 'XTS', 50, 32, year),
    };
    const { aggregates, query } = executors(runner);
    const ctx = context(runner, tenantId);
    const aggregate = (input: Record<string, unknown>) => aggregates.execute(ctx, input as any);

    const sum = await aggregate({ entity_type: 'companies', group_by: 'country', metric: 'turnover_year', function: 'sum' });
    assert.equal(sum.amounts_currency, 'EUR', 'the figure is in the reporting currency');
    const sumNote = noteOf(sum);
    assert.match(sumNote, /millions of EUR/, 'the note says millions of the reporting currency');
    assert.match(sumNote, /converted from its base currency at the year's rate/);
    assert.match(sumNote, new RegExp(`AlpineZX \\(XTS, ${year}\\)`), 'the note names a company left out');
    assert.match(sumNote, new RegExp(`KyotoZX \\(XTS, ${year}\\)`));
    assert.match(sumNote, new RegExp(`OsakaZX \\(XTS, ${year}\\)`));
    assert.match(sumNote, /Tell the user that those companies are not included in the figures until a rate is entered/);
    assert.deepEqual(sum.turnover_fx_missing, [
      { companyId: ids.alpine, companyName: 'AlpineZX', currency: 'XTS', year },
      { companyId: ids.kyoto, companyName: 'KyotoZX', currency: 'XTS', year },
      { companyId: ids.osaka, companyName: 'OsakaZX', currency: 'XTS', year },
    ]);
    // FR: the euro turnover plus the dollar turnover times the rate. Alpine is left out.
    // DE: no base currency, so the turnover is not converted. JP: every company lacks a rate.
    assert.deepEqual(pairs(sum.groups, 'value'), [
      ['FR', EUR_TURNOVER + USD_CONVERTED],
      ['DE', BLANK_TURNOVER],
      ['JP', null],
    ]);

    const avg = await aggregate({ entity_type: 'companies', group_by: 'country', metric: 'turnover_year', function: 'avg' });
    assert.deepEqual(pairs(avg.groups, 'value'), [
      ['FR', (EUR_TURNOVER + USD_CONVERTED) / 2],
      ['DE', BLANK_TURNOVER],
      ['JP', null],
    ]);
    const min = await aggregate({ entity_type: 'companies', group_by: 'country', metric: 'turnover_year', function: 'min' });
    assert.deepEqual(pairs(min.groups, 'value'), [
      ['DE', BLANK_TURNOVER],
      ['FR', EUR_TURNOVER],
      ['JP', null],
    ]);
    const max = await aggregate({ entity_type: 'companies', group_by: 'country', metric: 'turnover_year', function: 'max' });
    assert.deepEqual(pairs(max.groups, 'value'), [
      ['FR', USD_CONVERTED],
      ['DE', BLANK_TURNOVER],
      ['JP', null],
    ]);

    const count = await aggregate({ entity_type: 'companies', group_by: 'country', metric: 'turnover_year', function: 'count' });
    assert.equal(count.amounts_currency, undefined, 'a count has no currency');
    assert.equal(count.turnover_fx_missing, undefined, 'a count leaves nothing out');
    assert.equal(count.metric, null);
    assert.deepEqual(pairs(count.groups, 'count'), [
      ['FR', 3],
      ['JP', 2],
      ['DE', 1],
    ]);

    const headcount = await aggregate({ entity_type: 'companies', group_by: 'country', metric: 'headcount_year', function: 'sum' });
    assert.equal(headcount.amounts_currency, undefined, 'headcount is not an amount');
    assert.equal(headcount.turnover_fx_missing, undefined);
    assert.equal(pairs(headcount.groups, 'value').find(([key]) => key === 'FR')?.[1], 1 + 2 + 4, 'headcount still adds every company');

    const filtered = await aggregate({
      entity_type: 'companies',
      group_by: 'country',
      metric: 'turnover_year',
      function: 'sum',
      filters: { country: ['FR'] },
    });
    assert.deepEqual(filtered.filters_ignored, []);
    assert.deepEqual(pairs(filtered.groups, 'value'), [['FR', EUR_TURNOVER + USD_CONVERTED]]);
    assert.deepEqual(filtered.turnover_fx_missing, [
      { companyId: ids.alpine, companyName: 'AlpineZX', currency: 'XTS', year },
    ]);

    const searched = await aggregate({
      entity_type: 'companies',
      group_by: 'country',
      metric: 'turnover_year',
      function: 'sum',
      q: 'DollarZX',
    });
    assert.deepEqual(pairs(searched.groups, 'value'), [['FR', USD_CONVERTED]]);
    assert.equal(searched.turnover_fx_missing, undefined, 'the dollar company has a rate');
    assert.doesNotMatch(noteOf(searched), /not included/);

    const listed = await query.execute(ctx, {
      entity_type: 'companies',
      year,
      sort: { field: 'turnover_year', direction: 'desc' },
      limit: 20,
    });
    assert.equal('amounts_currency' in listed, false, 'a row keeps the company value, so the list names no reporting currency');
    assert.deepEqual(listed.sort, { field: 'turnover_year', direction: 'desc' });
    const order = listed.items.map((item) => item.id);
    assert.ok(order.indexOf(ids.euro) < order.indexOf(ids.dollar), 'sorting uses the company turnover, not the converted one');
    const dollar = listed.items.find((item) => item.id === ids.dollar);
    assert.equal(dollar?.metadata?.turnover, USD_TURNOVER);
    assert.equal(dollar?.metadata?.turnover_currency, dollar?.metadata?.base_currency);
    assert.equal(String(dollar?.metadata?.turnover_currency).trim(), 'USD');
    const blank = listed.items.find((item) => item.id === ids.blank);
    assert.equal(blank?.metadata?.turnover, BLANK_TURNOVER);
    assert.equal(blank?.metadata?.turnover_currency, null);

    const detail = await query.executeDetail(ctx, { entity_type: 'companies', entity_id: ids.dollar, year });
    assert.equal(detail.entity.metadata?.turnover, USD_TURNOVER);
    assert.equal(String(detail.entity.metadata?.turnover_currency).trim(), 'USD');
    assert.equal('amounts_currency' in detail, false);
  })],
];

runSpecs('ai-company-turnover-aggregate', tests);
