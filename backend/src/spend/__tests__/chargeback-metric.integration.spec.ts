import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { ChargebackReportService } from '../chargeback-report.service';
import {
  assert,
  inRolledBackTransaction,
  repeat,
  runSpecs,
  seedLine,
  seedTenant,
  setBudgetColumns,
} from './round-inputs.fixtures';

// The chargeback runs on any of the five columns: Forecast included, the
// tenant's default column when none is named, a readable 400 otherwise.

const YEAR = 2031;

function service(companyId: string) {
  // One company takes every version: the allocation rules have their own specs.
  const calculator = {
    computeForVersions: async (versions: Array<{ id: string }>) => new Map(versions.map((v) => [
      v.id,
      { resolvedMethod: 'manual_company', shares: [{ company_id: companyId, department_id: null, allocation_pct: 100 }] },
    ])),
  };
  const fxRates = {
    resolveRates: async () => ({ settings: { reportingCurrency: 'EUR' }, map: new Map() }),
    convertValue: (value: number, rate: number) => value * rate,
  };
  return new ChargebackReportService(undefined as any, calculator as any, fxRates as any);
}

async function testChargebackColumns() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'chargeback');
    await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('10', 12), forecast: repeat('7', 12) });
    const svc = service(randomUUID());
    const opts = { manager: runner.manager };

    assert.equal((await svc.generateGlobal(YEAR, 'forecast', tenantId, opts)).total, 84, 'forecast sums the Forecast column');
    assert.equal((await svc.generateGlobal(YEAR, 'budget', tenantId, opts)).total, 120);

    assert.equal(await svc.resolveMetric(undefined, tenantId, opts), 'budget', 'no metric: the product default column');
    await setBudgetColumns(runner, tenantId, { enabled: { forecast: true }, default_column: 'forecast' });
    assert.equal(await svc.resolveMetric('', tenantId, opts), 'forecast', 'no metric: the tenant default column');
    assert.equal(await svc.resolveMetric('revision', tenantId, opts), 'revision');
    for (const bad of ['planned', 'constructor', 'bogus']) {
      await assert.rejects(
        () => svc.resolveMetric(bad, tenantId, opts),
        (err: any) => err instanceof BadRequestException
          && err.message === `Unknown column '${bad}'. Use budget, revision, forecast, follow_up, landing.`,
      );
    }
    await assert.rejects(() => svc.generateGlobal(YEAR, 'constructor' as any, tenantId, opts), BadRequestException);
  });
}

void runSpecs('chargeback-metric.integration.spec', [
  ['testChargebackColumns', testChargebackColumns],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
