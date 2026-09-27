import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FreezeService } from '../freeze.service';

// Forecast is a freezable budget column like the others.

const TENANT = 'tenant-1';

function createService() {
  const rows: any[] = [];
  const repo = {
    findOne: async ({ where }: any) =>
      rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
    find: async () => rows,
    create: (partial: any) => ({ ...partial }),
    save: async (row: any) => {
      if (!rows.includes(row)) rows.push(row);
      return row;
    },
  };
  // One tenant in the mocked session, no stored settings (Budget is the default column),
  // and no FX rate set: a Budget freeze refreshes FX but pins nothing.
  const manager = {
    getRepository: () => repo,
    query: async (sql: string) => (sql.includes('current_setting') ? [{ tenant_id: TENANT }] : []),
  };
  const service = new FreezeService(
    repo as any,
    { refreshTenant: async () => undefined } as any,
    { getLatestRateSet: async () => null } as any,
    { getSettings: async () => ({ reportingCurrency: 'EUR' }) } as any,
  );
  return { service, rows, opts: { manager: manager as any } };
}

function testSummarizeHasForecast() {
  const { service } = createService();
  const at = new Date('2026-03-01T00:00:00Z');
  const summary = service.summarize(2026, [
    { scope: 'opex', columnKey: 'forecast', is_frozen: true, frozen_at: at, frozen_by: 'user-1' } as any,
    { scope: 'capex', columnKey: 'forecast', is_frozen: false } as any,
  ]);
  assert.deepEqual(summary.scopes.opex.forecast, { frozen: true, frozenAt: at, frozenBy: 'user-1' });
  assert.deepEqual(summary.scopes.capex.forecast, { frozen: false, frozenAt: null, frozenBy: null });
  assert.deepEqual(Object.keys(summary.scopes.opex), ['budget', 'revision', 'forecast', 'actual', 'landing']);
  assert.deepEqual(Object.keys(summary.scopes.capex), ['budget', 'revision', 'forecast', 'actual', 'landing']);
}

function testNormalizeColumnAcceptsForecast() {
  const { service } = createService();
  const normalize = (service as any).normalizeColumn.bind(service);
  assert.equal(normalize('opex', 'forecast'), 'forecast');
  assert.equal(normalize('capex', 'FORECAST'), 'forecast');
  assert.throws(() => normalize('opex', 'constructor'), BadRequestException);
  assert.throws(() => normalize('opex', 'bogus'), BadRequestException);
}

async function testFreezeAllColumnsIncludesForecast() {
  const { service, rows, opts } = createService();
  await service.freeze(2026, [{ scope: 'capex' }], 'user-1', opts);
  assert.deepEqual(rows.map((r) => r.columnKey).sort(), ['actual', 'budget', 'forecast', 'landing', 'revision']);
  assert.ok(rows.every((r) => r.is_frozen && r.scope === 'capex' && r.budget_year === 2026 && r.tenant_id === TENANT));
}

async function testFreezeStatesAreReadForTheSessionTenant() {
  const { service, rows, opts } = createService();
  rows.push({ tenant_id: 'other-tenant', budget_year: 2026, scope: 'opex', columnKey: 'budget', is_frozen: true });
  assert.equal(await service.isFrozen({ scope: 'opex', column: 'budget', year: 2026 }, opts), false, 'another tenant\'s freeze is not read');
  const noTenant = { manager: { getRepository: () => ({}), query: async () => [] } as any };
  await assert.rejects(() => service.isFrozen({ scope: 'opex', column: 'budget', year: 2026 }, noTenant), /tenant context/);
}

async function testFrozenForecastIsRefusedWithAReadableMessage() {
  const { service, opts } = createService();
  await service.freeze(2026, [{ scope: 'opex', columns: ['forecast'] }], 'user-1', opts);
  assert.equal(await service.isFrozen({ scope: 'opex', column: 'forecast', year: 2026 }, opts), true);
  assert.equal(await service.isFrozen({ scope: 'opex', column: 'budget', year: 2026 }, opts), false);
  await assert.rejects(
    () => service.assertNotFrozen({ scope: 'opex', column: 'forecast', year: 2026 }, opts),
    (err: any) => err instanceof ForbiddenException && err.message === 'OPEX Forecast for 2026 is frozen',
  );
  await assert.rejects(
    () => service.assertNotFrozen({ scope: 'opex', column: 'forecast', year: 2026, action: 'Copy' }, opts),
    (err: any) => err.message === 'Copy not allowed: OPEX Forecast for 2026 is frozen',
  );
  await service.assertNotFrozen({ scope: 'opex', column: 'forecast', year: 2027 }, opts);
}

async function main() {
  testSummarizeHasForecast();
  testNormalizeColumnAcceptsForecast();
  await testFreezeAllColumnsIncludesForecast();
  await testFrozenForecastIsRefusedWithAReadableMessage();
  await testFreezeStatesAreReadForTheSessionTenant();
  console.log('freeze.service.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
