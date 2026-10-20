import * as assert from 'node:assert/strict';
import { AiQueryExecutor } from '../query/ai-query.executor';

/**
 * A budget line's detail gives the AI each version's allocation as the Allocations tab shows it
 * (`AllocationCalculatorService.computeForVersions`), not the stored percentages: a split by
 * turnover stored before the turnovers were converted into the reporting currency is stale.
 */

const TENANT = 'tenant-ai';

function executor(calculator: unknown) {
  const none = {} as any;
  return new AiQueryExecutor(
    none, none, none, none, none, none, none, none, none, none, none, none,
    none, none, none, none, none, none, none, none, none, none, none,
    calculator as any,
  );
}

async function testVersionsCarryTheComputedAllocation() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (/FROM spend_versions/.test(sql)) {
        return [{ id: 'v1', tenant_id: TENANT, spend_item_id: 'item-1', budget_year: 2026, allocation_method: 'turnover', fx_rate_set_id: null }];
      }
      if (/FROM spend_amounts/.test(sql)) return [];
      if (/FROM companies/.test(sql)) return [{ id: 'paris', name: 'Paris' }, { id: 'ny', name: 'New York' }];
      if (/FROM departments/.test(sql)) return [];
      throw new Error(`unexpected query ${sql}`);
    },
  };
  const calls: any[] = [];
  const calculator = {
    computeForVersions: async (versions: any[], opts: any) => {
      calls.push({ versions, opts });
      return new Map([['v1', {
        versionId: 'v1',
        resolvedMethod: 'turnover',
        shares: [
          { company_id: 'paris', department_id: null, allocation_pct: 68.9655, source: 'auto' },
          { company_id: 'ny', department_id: null, allocation_pct: 31.0345, source: 'auto' },
        ],
        error: null,
        warning: {
          code: 'turnover_fx_missing',
          items: [{ companyId: 'ny', companyName: 'New York', currency: 'USD', year: 2026 }],
          reportingCurrency: 'EUR',
        },
      }]]);
    },
  };

  const versions = await (executor(calculator) as any).loadFinancialVersions(
    { tenantId: TENANT, manager },
    { versionTable: 'spend_versions', amountTable: 'spend_amounts', itemColumn: 'spend_item_id', itemId: 'item-1' },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.tenantId, TENANT);
  assert.equal(calls[0].opts.manager, manager);
  // By company name, as the stored rows were listed.
  assert.deepEqual(versions[0].allocations.map((a: any) => [a.company_name, a.allocation_pct]), [['New York', 31.0345], ['Paris', 68.9655]]);
  assert.equal(versions[0].resolved_allocation_method, 'turnover');
  assert.match(versions[0].allocation_warning, /No EUR exchange rate for USD in 2026/);
  // The stored percentages are not read: the calculator reads what it needs.
  assert.ok(!queries.some((q) => /FROM spend_allocations/.test(q.sql)));
  // Every query names the tenant.
  assert.ok(queries.every((q) => q.params[0] === TENANT));
}

testVersionsCarryTheComputedAllocation()
  .then(() => console.log('ai-financial-versions-allocations: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
