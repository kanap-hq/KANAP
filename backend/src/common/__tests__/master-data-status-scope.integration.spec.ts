import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CompaniesService } from '../../companies/companies.service';
import { DepartmentsService } from '../../departments/departments.service';
import { BusinessProcessesService } from '../../business-processes/business-processes.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { AccountsService } from '../../accounts/accounts.service';

// The master-data lists with a status column checklist: with Show = "all"
// (`includeDisabled`), a status ticked in the column filter still applies; the
// Show toggle's own status wins over the column filter; "all" without a status
// lists everything. Companies, departments and business processes share the
// status helper; suppliers and accounts filter inline. (OPEX and CAPEX: see
// `spend/__tests__/budget-summary.integration.spec.ts`, "explicit status wins over all".)

const ALL = { includeDisabled: '1' };
const statusFilter = (value: 'enabled' | 'disabled') => JSON.stringify({ status: { filterType: 'set', values: [value] } });
const PAST = '2020-06-30T12:00:00Z';

type Lister = {
  label: string;
  list?: (query: any, opts: { manager: EntityManager }) => Promise<{ items: Array<{ id: string }> }>;
  listIds: (query: any, opts: { manager: EntityManager }) => Promise<{ ids: string[] }>;
};

async function withTenant(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Status scope test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `status-scope-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** One enabled and one disabled row per list; returns the ids per list. */
async function seed(runner: QueryRunner, tenantId: string) {
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const companies = {
    enabled: await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Active company', 'FR', 'Lyon') RETURNING id`, [tenantId]),
    disabled: await one(
      `INSERT INTO companies (tenant_id, name, country_iso, city, status, disabled_at) VALUES ($1, 'Closed company', 'FR', 'Lyon', 'disabled', $2) RETURNING id`,
      [tenantId, PAST],
    ),
  };
  const departments = {
    enabled: await one(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Active department') RETURNING id`, [tenantId, companies.enabled]),
    disabled: await one(
      `INSERT INTO departments (tenant_id, company_id, name, status, disabled_at) VALUES ($1, $2, 'Closed department', 'disabled', $3) RETURNING id`,
      [tenantId, companies.enabled, PAST],
    ),
  };
  const processes = {
    enabled: await one(`INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Active process') RETURNING id`, [tenantId]),
    disabled: await one(
      `INSERT INTO business_processes (tenant_id, name, status, disabled_at) VALUES ($1, 'Closed process', 'disabled', $2) RETURNING id`,
      [tenantId, PAST],
    ),
  };
  const suppliers = {
    enabled: await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Active supplier') RETURNING id`, [tenantId]),
    disabled: await one(
      `INSERT INTO suppliers (tenant_id, name, status, disabled_at) VALUES ($1, 'Closed supplier', 'disabled', $2) RETURNING id`,
      [tenantId, PAST],
    ),
  };
  const chart = await one(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'SCOPE', 'Status scope chart', 'FR') RETURNING id`,
    [tenantId],
  );
  const accounts = {
    enabled: await one(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6100, 'Active account') RETURNING id`, [tenantId, chart]),
    disabled: await one(
      `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, status, disabled_at) VALUES ($1, $2, 6200, 'Closed account', 'disabled', $3) RETURNING id`,
      [tenantId, chart, PAST],
    ),
  };
  return { companies, departments, processes, suppliers, accounts };
}

async function testAllWithStatusColumnFilter() {
  await withTenant(async (runner, tenantId) => {
    const ids = await seed(runner, tenantId);
    const opts = { manager: runner.manager };
    const audit = { log: async () => undefined } as any;
    const lists: Array<[Lister, { enabled: string; disabled: string }]> = [
      [{ label: 'companies', ...bind(new CompaniesService(undefined as any, audit, undefined as any)) }, ids.companies],
      [{ label: 'departments', ...bind(new DepartmentsService(undefined as any, undefined as any, audit)) }, ids.departments],
      [{ label: 'business processes', ...bind(new BusinessProcessesService(undefined as any, undefined as any, undefined as any, undefined as any, audit)) }, ids.processes],
      [{ label: 'suppliers', ...bind(new SuppliersService(undefined as any, audit)) }, ids.suppliers],
      [{ label: 'accounts', ...bind(new AccountsService(undefined as any, audit)) }, ids.accounts],
    ];
    const sorted = (values: string[]) => [...values].sort();
    for (const [svc, row] of lists) {
      const cases: Array<[string, any, string[]]> = [
        ['all + disabled ticked', { ...ALL, filters: statusFilter('disabled') }, [row.disabled]],
        ['all + enabled ticked', { ...ALL, filters: statusFilter('enabled') }, [row.enabled]],
        ['all, nothing ticked', { ...ALL }, [row.enabled, row.disabled]],
        ['enabled toggle wins over the column', { status: 'enabled', filters: statusFilter('disabled') }, [row.enabled]],
        ['disabled toggle wins over the column', { status: 'disabled', filters: statusFilter('enabled') }, [row.disabled]],
        ['default scope', {}, [row.enabled]],
      ];
      for (const [label, query, expected] of cases) {
        const { ids: listed } = await svc.listIds(query, opts);
        assert.deepEqual(sorted(listed), sorted(expected), `${svc.label} ids: ${label}`);
        if (svc.list) {
          const page = await svc.list(query, opts);
          assert.deepEqual(sorted(page.items.map((i) => i.id)), sorted(expected), `${svc.label} list: ${label}`);
        }
      }
    }
    // The companies and departments grids send the metrics year: the period does not lift the status.
    const [companies] = lists[0];
    const yearQuery = { ...ALL, year: String(new Date().getFullYear()), filters: statusFilter('disabled') };
    assert.deepEqual((await companies.list!(yearQuery, opts)).items.map((i) => i.id), [ids.companies.disabled], 'companies list with a year: disabled ticked');
  });
}

function bind(svc: any): Omit<Lister, 'label'> {
  return { list: svc.list.bind(svc), listIds: svc.listIds.bind(svc) };
}

async function main() {
  await dataSource.initialize();
  try {
    await testAllWithStatusColumnFilter();
  } finally {
    await dataSource.destroy();
  }
  console.log('master-data-status-scope.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
