import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot K2d, browser pass of 24/11. Kad and the MCP server read names everywhere, so:
// - a set filter on a named field takes the name, in the person's language or another of the
//   four, as well as the stored value: a budget line's allocation method « Effectif » finds the
//   lines the list shows as "Headcount", in query_entities and aggregate_entities; a name that
//   stands for nothing finds nothing and is listed with the accepted values and their names;
// - a person limited to one company finds their lines only, by name as by code;
// - get_filter_values names each value;
// - a line's detail says the method each year applies, the workspace's default for a year
//   without a version, as the Allocations tab shows it.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-filter-names-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-filter-names.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const tools = app.get(AiToolRegistry);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const tag = tenantId.slice(0, 8);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR"}'::jsonb,
               '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `ai-filter-names-${tag}`, `AI filter names ${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const roleId = await insertId(runner,
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Budget reader', 'filter names spec', false, false)`,
      [tenantId]);
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'reader')`, [tenantId, roleId]);
    const user = async (mode: 'all' | 'limited', locale: string | null) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, data_access_mode, locale)
         VALUES ($1, $2, 'Filter', 'Names', $3, $4, false, 'enabled', $5, $6)`,
        [id, tenantId, `filter-names-${id.slice(0, 8)}@example.test`, roleId, mode, locale],
      );
      return id;
    };
    const company = (name: string) => insertId(runner,
      `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Quimper', 'enabled')`, [tenantId, `${name} ${tag}`]);
    const companyA = await company('Company A');
    const companyB = await company('Company B');
    const everyone = await user('all', null);
    const limited = await user('limited', 'fr');
    await runner.query(
      `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'read')`,
      [tenantId, limited, companyA],
    );
    // BL-1 on the default (headcount), BL-2 split by company, both of company A; BL-3 of company B.
    const lines: Array<[number, string, string]> = [[1, companyA, 'default'], [2, companyA, 'manual_company'], [3, companyB, 'default']];
    for (const [number, companyId, method] of lines) {
      const itemId = await insertId(runner,
        `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id)
         VALUES ($1, 'opex', $2, $3, 'EUR', '2020-01-01', 'enabled', $4)`,
        [tenantId, number, `Line ${number}`, companyId]);
      const versionId = await insertId(runner,
        `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
         VALUES ($1, $2, 'Y' || $4::int, $3::date, $4::int, $5)`,
        [tenantId, itemId, `${Y}-01-01`, Y, method]);
      await runner.query(
        `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, make_date($3, 1, 1), 100)`,
        [tenantId, versionId, Y],
      );
      if (method === 'manual_company') {
        await runner.query(
          `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct) VALUES ($1, $2, $3, 100)`,
          [tenantId, versionId, companyId],
        );
      }
    }

    const context = (userId: string) => ({ tenantId, userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager });
    const refs = async (userId: string, filters: Record<string, unknown>) => {
      const out = await tools.execute(context(userId), 'query_entities', { entity_type: 'budget_lines', filters, limit: 50 });
      return { refs: (out.items as Array<{ ref: string }>).map((item) => item.ref).sort(), out };
    };

    // The person with access to all data, no language: names in any language, the code, the stored form.
    for (const value of ['Effectif', 'Mitarbeiterzahl', 'headcount', 'Headcount']) {
      assert.deepEqual((await refs(everyone, { allocation_method: [value] })).refs, ['BL-1', 'BL-3'], value);
    }
    assert.deepEqual((await refs(everyone, { allocation_method: ['Manuel par société'] })).refs, ['BL-2']);
    const unknown = await refs(everyone, { allocation_method: ['Inexistant'] });
    assert.deepEqual(unknown.refs, []);
    assert.equal(unknown.out.filter_values_unknown?.[0]?.field, 'allocation_method');
    assert.ok(unknown.out.filter_values_unknown[0].accepted.some((value: any) => value.value === 'Headcount' && value.name === 'Headcount'),
      JSON.stringify(unknown.out.filter_values_unknown));
    console.log('  a filter by name in two languages, by code and by stored form; an unknown name listed: OK');

    // A person limited to company A, French profile: their lines only, by name, in a list and an aggregate.
    if ((await runner.query(`SELECT to_regrole('kanap_data_limited') IS NOT NULL AS present`))[0].present) {
      await runner.query('SAVEPOINT limited');
      assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [limited]))[0].mode, 'limited');
      assert.deepEqual((await refs(limited, { allocation_method: ['Effectif'] })).refs, ['BL-1']);
      assert.deepEqual((await refs(limited, { allocation_method: ['Manual by company'] })).refs, ['BL-2']);
      const groups = await tools.execute(context(limited), 'aggregate_entities', {
        entity_type: 'budget_lines', group_by: 'nature', filters: { allocation_method: ['Effectif'] },
      });
      assert.deepEqual(groups.groups.map((group: any) => [group.key, group.count]), [['opex', 1]]);
      const values = await tools.execute(context(limited), 'get_filter_values', { entity_type: 'budget_lines', fields: ['allocation_method'] });
      assert.equal(values.names?.allocation_method?.Headcount, 'Effectif', JSON.stringify(values));
      assert.equal(values.names?.allocation_method?.Company, 'Manuel par société', JSON.stringify(values));
      await runner.query('ROLLBACK TO SAVEPOINT limited');
      console.log('  a limited person filters and counts their lines by name; the filter values are named: OK');
    } else {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('  skip - kanap_data_limited not installed');
    }

    // The method each year applies: the version's own, else the workspace's default, also without a version.
    const detail = await tools.execute({ ...context(limited), screenLanguage: 'fr' }, 'get_entity_detail', { entity_type: 'budget_lines', entity_id: 'BL-2' });
    const byYear = new Map((detail.data.allocation_by_year as any[]).map((year) => [year.budget_year, year]));
    assert.deepEqual(byYear.get(Y), { budget_year: Y, allocation_method: 'manual_company', default: false, version: true, allocation_method_name: 'Manuel par société' });
    assert.deepEqual(byYear.get(Y + 1), { budget_year: Y + 1, allocation_method: 'headcount', default: true, version: false, allocation_method_name: 'Effectif' });
    const onDefault = await tools.execute(context(everyone), 'get_entity_detail', { entity_type: 'budget_lines', entity_id: 'BL-1' });
    const thisYear = (onDefault.data.allocation_by_year as any[]).find((year) => year.budget_year === Y);
    assert.deepEqual([thisYear.allocation_method, thisYear.default, thisYear.version, thisYear.allocation_method_name], ['headcount', true, true, 'Headcount']);
    // A workspace default for next year: the line without a version follows it.
    await runner.query(
      `INSERT INTO allocation_rules (tenant_id, fiscal_year, method, mode) VALUES ($1, $2, 'turnover', 'auto')`,
      [tenantId, Y + 1],
    );
    const ruled = await tools.execute(context(everyone), 'get_entity_detail', { entity_type: 'budget_lines', entity_id: 'BL-1' });
    const nextYear = (ruled.data.allocation_by_year as any[]).find((year) => year.budget_year === Y + 1);
    assert.deepEqual([nextYear.allocation_method, nextYear.default, nextYear.version, nextYear.allocation_method_name], ['turnover', true, false, 'Turnover']);
    console.log('  the method of each year, the workspace default for a year without a version: OK');
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
    await app.close();
  }
  console.log('ai-filter-names.integration.spec: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
