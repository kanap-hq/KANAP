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
import { ContractsService } from '../../contracts/contracts.service';
import * as budgetSummary from '../../spend/budget-summary';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';

// The master-data lists with a status column checklist: with Show = "all"
// (`includeDisabled`), a status ticked in the column filter still applies; the
// Show toggle's own status wins over the column filter; "all" without a status
// lists everything. Companies, departments and business processes share the
// status helper; suppliers and accounts filter inline. (OPEX and CAPEX: see
// `spend/__tests__/budget-summary.integration.spec.ts`, "explicit status wins over all".)
// The checklist's Clear (no status ticked) lists nothing, on every list, the
// OPEX and CAPEX summaries included (ids, totals and filter values too).
// Contracts read the status from the end of validity, never the stored one.

const ALL = { includeDisabled: '1' };
const statusFilter = (value: 'enabled' | 'disabled') => JSON.stringify({ status: { filterType: 'set', values: [value] } });
const PAST = '2020-06-30T12:00:00Z';
/** What the checklist's Clear sends: a set filter with no value. */
const CLEARED = JSON.stringify({ status: { filterType: 'set', values: [] } });

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
        ['nothing ticked (Clear)', { filters: CLEARED }, []],
        ['all + nothing ticked (Clear)', { ...ALL, filters: CLEARED }, []],
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

/** A contract whose end of validity passed keeps `status = 'enabled'` stored: the list reads the date. */
async function testContractsReadTheEndOfValidity() {
  await withTenant(async (runner, tenantId) => {
    const opts = { manager: runner.manager };
    const [company] = await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Contract company', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Contract supplier') RETURNING id`, [tenantId]);
    const contract = async (name: string, status: string, disabledAt: string | null) => (await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, status, disabled_at)
       VALUES ($1, $2, $3, $4, '2020-01-01', $5, $6) RETURNING id`,
      [tenantId, name, company.id, supplier.id, status, disabledAt],
    ))[0].id as string;
    const active = await contract('Active contract', 'enabled', null);
    const expired = await contract('Expired contract', 'enabled', PAST);
    const closed = await contract('Closed contract', 'disabled', PAST);
    const svc = new ContractsService(undefined as any, undefined as any, undefined as any, undefined as any, { log: async () => undefined } as any, undefined as any, undefined as any, undefined as any, undefined as any);
    const sorted = (values: string[]) => [...values].sort();
    const cases: Array<[string, any, string[]]> = [
      ['all + disabled ticked', { ...ALL, filters: statusFilter('disabled') }, [expired, closed]],
      ['all + enabled ticked', { ...ALL, filters: statusFilter('enabled') }, [active]],
      ['all, nothing ticked', { ...ALL }, [active, expired, closed]],
      ['default scope', {}, [active]],
      ['disabled toggle', { status: 'disabled' }, [expired, closed]],
      ['nothing ticked (Clear)', { filters: CLEARED }, []],
      ['all + nothing ticked (Clear)', { ...ALL, filters: CLEARED }, []],
    ];
    for (const [label, query, expected] of cases) {
      const page = await svc.list(query, opts);
      assert.deepEqual(sorted(page.items.map((i: any) => i.id)), sorted(expected), `contracts list: ${label}`);
      assert.equal(page.total, expected.length, `contracts total: ${label}`);
      const { ids } = await svc.listIds(query, opts);
      assert.deepEqual(sorted(ids), sorted(expected), `contracts ids: ${label}`);
    }
    const rows = (await svc.list(ALL, opts)).items as Array<{ id: string; status: string }>;
    const statusOf = (id: string) => rows.find((row) => row.id === id)?.status;
    assert.deepEqual([statusOf(active), statusOf(expired), statusOf(closed)], ['enabled', 'disabled', 'disabled'], 'contracts: the row status follows the end of validity');

    // CSV round trip: the file has no end of validity. The export writes the status read from
    // the date, and an import that does not change it keeps the stored date (a future one too).
    const future = await contract('Future contract', 'enabled', '2031-06-30T12:00:00Z');
    const dates = async () => {
      const found = await runner.query(`SELECT id, disabled_at FROM contracts WHERE tenant_id = $1 ORDER BY name`, [tenantId]);
      return found.map((row: any) => [row.id, row.disabled_at ? new Date(row.disabled_at).toISOString() : null]);
    };
    const before = await dates();
    const exported = await svc.exportCsv('data', opts);
    const lines = exported.content.replace(/^\uFEFF/, '').trim().split('\n');
    const statusIndex = lines[0].split(';').indexOf('status');
    const exportedStatus = (name: string) => lines.find((line) => line.startsWith(`${name};`))!.split(';')[statusIndex];
    assert.deepEqual(
      ['Active contract', 'Expired contract', 'Closed contract', 'Future contract'].map(exportedStatus),
      ['enabled', 'disabled', 'disabled', 'enabled'],
      'contracts export: the status is read from the end of validity',
    );
    const reimported = await svc.importCsv({ file: { buffer: Buffer.from(exported.content, 'utf8') } as any, dryRun: false, userId: null }, opts);
    assert.equal(reimported.ok, true, `contracts round trip: accepted (${JSON.stringify(reimported.errors)})`);
    assert.deepEqual(await dates(), before, 'contracts round trip: no end of validity changes');
    // A real edit still applies: enabling the closed contract clears its date.
    const edited = exported.content.replace(/^(\uFEFF?Closed contract;.*?;)disabled;/m, '$1enabled;');
    assert.notEqual(edited, exported.content, 'the closed contract row is edited');
    const applied = await svc.importCsv({ file: { buffer: Buffer.from(edited, 'utf8') } as any, dryRun: false, userId: null }, opts);
    assert.equal(applied.ok, true, `contracts edit: accepted (${JSON.stringify(applied.errors)})`);
    const [closedRow] = await runner.query(`SELECT disabled_at, status::text AS status FROM contracts WHERE id = $1`, [closed]);
    assert.deepEqual(closedRow, { disabled_at: null, status: 'enabled' }, 'contracts edit: the status change applies');
    const [futureRow] = await runner.query(`SELECT disabled_at FROM contracts WHERE id = $1`, [future]);
    assert.equal(new Date(futureRow.disabled_at).toISOString(), '2031-06-30T12:00:00.000Z', 'contracts: a future end of validity survives');
  });
}

/** The OPEX and CAPEX summaries (list, ids, totals, filter values): Clear lists nothing. */
async function testSummaryClearMatchesNothing() {
  await withTenant(async (runner, tenantId) => {
    const opts = runner.manager;
    await runner.query(`INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, 'Scope line', 'EUR', '2020-01-01', 1)`, [tenantId]);
    await runner.query(
      `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
       VALUES ($1, 'Scope line', 'hardware', 'replacement', 'medium', 'EUR', '2020-01-01', 1)`,
      [tenantId],
    );
    const deps: any = {
      allocationCalculator: { computeForVersions: async () => new Map() },
      fxRates: { resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }), convertValue: (value: number) => value },
    };
    for (const kind of ['opex', 'capex'] as const) {
      const config = SUMMARY_SCOPES[kind];
      for (const [label, base] of [['default', {}], ['all', ALL]] as const) {
        const open = await budgetSummary.summaryIds(config, deps, { ...base }, opts);
        assert.equal(open.total, 1, `${kind} ${label}: the line is listed without the filter`);
        const query = { ...base, filters: CLEARED, fields: 'currency' };
        const page = await budgetSummary.summary(config, deps, query, opts);
        assert.deepEqual([page.items.length, page.total], [0, 0], `${kind} ${label}: Clear lists nothing`);
        assert.deepEqual((await budgetSummary.summaryIds(config, deps, query, opts)).ids, [], `${kind} ${label}: no id`);
        const totals = await budgetSummary.summaryTotals(config, deps, query, opts);
        assert.equal(totals.yBudget, 0, `${kind} ${label}: zero totals`);
        assert.deepEqual(await budgetSummary.summaryFilterValues(config, deps, query, opts), { currency: [] }, `${kind} ${label}: no filter value`);
      }
    }
  });
}

function bind(svc: any): Omit<Lister, 'label'> {
  return { list: svc.list.bind(svc), listIds: svc.listIds.bind(svc) };
}

async function main() {
  await dataSource.initialize();
  try {
    await testAllWithStatusColumnFilter();
    await testContractsReadTheEndOfValidity();
    await testSummaryClearMatchesNothing();
  } finally {
    await dataSource.destroy();
  }
  console.log('master-data-status-scope.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
