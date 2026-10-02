import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { CapexAllocation } from '../capex-allocation.entity';
import { CapexAllocationsService } from '../capex-allocations.service';
import { CapexItemsService } from '../capex-items.service';
import { CapexVersion } from '../capex-version.entity';
import { Company } from '../../companies/company.entity';
import { resolveToUuid } from '../../common/resolve-item-id';

function createCapexItemsService(manager: any) {
  return new CapexItemsService(
    { manager } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

async function testCapexReferenceResolution() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [{ id: 'capex-id-42' }];
    },
  };

  const resolved = await resolveToUuid('CPX-42', 'capex', manager as any);
  assert.equal(resolved, 'capex-id-42');
  assert.match(queries[0].sql, /FROM capex_items/);
  assert.match(queries[0].sql, /WHERE tenant_id = app_current_tenant\(\) AND item_number = \$1/, 'the item number is read in the request\'s tenant');
  assert.deepEqual(queries[0].params, [42]);

  queries.length = 0;
  const plain = await resolveToUuid('42', 'capex', manager as any);
  assert.equal(plain, 'capex-id-42');
  assert.deepEqual(queries[0].params, [42]);

  await assert.rejects(
    () => resolveToUuid('OPX-42', 'capex', manager as any),
    BadRequestException,
  );
}

async function testSummaryIdsReturnsAlignedItemNumbers() {
  const items = [
    { id: 'capex-b', item_number: 2, tenant_id: 'tenant-1', description: 'B', disabled_at: null },
    { id: 'capex-a', item_number: 1, tenant_id: 'tenant-1', description: 'A', disabled_at: null },
  ] as any[];

  // The list engine (`spend/budget-list/`): the tenant, the database check (ICU, unaccent), then one
  // statement for the ordered ids; no row is built and no repository is read.
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/SELECT app_current_tenant\(\) AS tenant_id/.test(sql)) return [{ tenant_id: 'tenant-1' }];
      if (/pg_collation/.test(sql)) return [{ icu: true, unaccent: true }];
      statements.push({ sql, params });
      // The database orders the lines; item numbers come back as the driver gives an int.
      return [...items].sort((a, b) => a.item_number - b.item_number).map((item) => ({ id: item.id, item_number: item.item_number }));
    },
    getRepository: () => {
      throw new Error('no repository read for the ids');
    },
  };

  const service = createCapexItemsService(manager);
  const result = await service.summaryIds({ sort: 'item_number:ASC' }, { manager: manager as any });

  assert.deepEqual(result.ids, ['capex-a', 'capex-b']);
  assert.deepEqual(result.item_numbers, [1, 2]);
  assert.equal(result.total, 2);
  assert.equal(statements.length, 1, 'one statement for the ordered ids');
  // A smoke check of the statement's shape, whatever its formatting: the exact SQL and the
  // order are the differential suite's (budget-list-differential.integration.spec.ts).
  const [{ sql, params }] = statements;
  const text = sql.replace(/\s+/g, ' ');
  assert.match(text, /\bFROM capex_items\b/i, 'the statement reads the CAPEX lines');
  const tenantBind = params.indexOf('tenant-1');
  assert.ok(tenantBind >= 0, 'the tenant is bound');
  assert.match(text, new RegExp(`\\btenant_id\\s*=\\s*\\$${tenantBind + 1}(?!\\d)`), 'the statement filters on the bound tenant');
  assert.match(text, /\bORDER BY\b.*\bitem_number\b/i, 'the order names the item number');
}

async function testManualPctBulkUpsert() {
  const savedRows: any[] = [];
  const allocationRepo = {
    find: async () => [{ id: 'old-row', version_id: 'version-1' }],
    delete: async () => undefined,
    create: (row: any) => row,
    save: async (rows: any[]) => {
      savedRows.push(...rows);
      return rows.map((row, index) => ({ ...row, id: `allocation-${index + 1}` }));
    },
  };
  const versionRepo = {
    findOne: async () => ({
      id: 'version-1',
      tenant_id: 'tenant-1',
      budget_year: 2026,
      allocation_method: 'manual_pct',
      allocation_driver: 'headcount',
    }),
  };
  // The tenant's companies: a manual row naming another company is refused.
  const companyCounts: any[] = [];
  const companyRepo = {
    count: async (options: any) => {
      companyCounts.push(options.where);
      const ids: string[] = options.where.id.value;
      return ids.filter((id) => id.startsWith('company-')).length;
    },
  };
  // The save locks the line, then the version, before it reads or replaces the rows (two saves
  // take turns; lock order of `spend/budget-locks.ts`).
  const locks: unknown[][] = [];
  const manager = {
    query: async (sql: string, params: any[]) => {
      if (/SELECT capex_item_id AS item_id FROM capex_versions WHERE tenant_id = \$1 AND id = \$2$/.test(sql)) return [{ item_id: 'item-1' }];
      if (/FROM capex_items WHERE tenant_id = \$1 AND id = \$2 FOR NO KEY UPDATE/.test(sql)) {
        locks.push(['line', ...params]);
        return [{ locked: 1 }];
      }
      if (/FROM capex_versions WHERE tenant_id = \$1 AND id = ANY\(\$2::uuid\[\]\) ORDER BY id FOR NO KEY UPDATE/.test(sql)) {
        locks.push(['version', params[0], ...params[1]]);
        return [{ id: params[1][0] }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    getRepository: (entity: unknown) => {
      if (entity === CapexAllocation) return allocationRepo;
      if (entity === CapexVersion) return versionRepo;
      if (entity === Company) return companyRepo;
      throw new Error('unexpected repository');
    },
  };
  const auditCalls: any[] = [];
  const service = new CapexAllocationsService(
    {} as any,
    {} as any,
    {} as any,
    { log: async (entry: any) => auditCalls.push(entry) } as any,
  );

  const accepted = await service.bulkUpsert(
    'version-1',
    [
      { company_id: 'company-a', department_id: null, allocation_pct: 60 },
      { company_id: 'company-b', department_id: null, allocation_pct: 40 },
    ],
    'user-1',
    { manager: manager as any, tenantId: 'tenant-1' },
  );

  assert.equal(accepted.updated, 2);
  assert.equal(accepted.total_pct, 100);
  assert.deepEqual(savedRows.map((row) => row.allocation_pct), [60, 40]);
  assert.equal(auditCalls.length, 1);
  assert.equal(companyCounts[0].tenant_id, 'tenant-1', 'companies are resolved in the version\'s tenant');
  assert.deepEqual(locks.slice(0, 2), [['line', 'tenant-1', 'item-1'], ['version', 'tenant-1', 'version-1']], 'the line, then the version are locked in their tenant');

  // A company picked on two lines is one row (unique key per version, company and department), percentages added.
  savedRows.length = 0;
  const merged = await service.bulkUpsert(
    'version-1',
    [
      { company_id: 'company-a', department_id: null, allocation_pct: 30 },
      { company_id: 'company-b', department_id: null, allocation_pct: 40 },
      { company_id: 'company-a', department_id: null, allocation_pct: 30 },
    ],
    'user-1',
    { manager: manager as any, tenantId: 'tenant-1' },
  );
  assert.equal(merged.updated, 2);
  assert.deepEqual(savedRows.map((row) => [row.company_id, row.allocation_pct]), [['company-a', 60], ['company-b', 40]]);

  await assert.rejects(
    () => service.bulkUpsert(
      'version-1',
      [
        { company_id: 'company-a', department_id: null, allocation_pct: 50 },
        { company_id: 'foreign-company', department_id: null, allocation_pct: 50 },
      ],
      'user-1',
      { manager: manager as any, tenantId: 'tenant-1' },
    ),
    (err: unknown) => err instanceof BadRequestException && err.message === 'One or more companies were not found.',
  );

  await assert.rejects(
    () => service.bulkUpsert(
      'version-1',
      [{ company_id: 'company-a', department_id: null, allocation_pct: 80 }],
      'user-1',
      { manager: manager as any, tenantId: 'tenant-1' },
    ),
    /Manual percentages must sum to 100%/,
  );
}

async function testYearlyTotalsFillsMissingYears() {
  const manager = {
    query: async () => [
      { year: 2026, budget: '1200.50', revision: '1000.00', forecast: '950.10', actual: '800.25', landing: '1100.75' },
    ],
  };
  const service = createCapexItemsService(manager);

  const result = await service.yearlyTotals('capex-1', 2025, 2027, { manager: manager as any });

  assert.deepEqual(result.items, [
    { year: 2025, budget: 0, revision: 0, forecast: 0, actual: 0, landing: 0 },
    { year: 2026, budget: 1200.5, revision: 1000, forecast: 950.1, actual: 800.25, landing: 1100.75 },
    { year: 2027, budget: 0, revision: 0, forecast: 0, actual: 0, landing: 0 },
  ]);
}

async function run() {
  await testCapexReferenceResolution();
  await testSummaryIdsReturnsAlignedItemNumbers();
  await testManualPctBulkUpsert();
  await testYearlyTotalsFillsMissingYears();
}

void run();
