import * as assert from 'node:assert/strict';
import { REQUIRE_LEVEL_KEY } from '../../../auth/require-level.decorator';
import { SpendItemsController } from '../../spend-items.controller';
import { CapexItemsController } from '../../capex-items.controller';

// Who may load a budget file (lot C1b: one file for both natures; lot R: one right for every
// budget line). Each route asks for `budget:admin`; that one right loads the lines of both
// natures from either list, so the controllers hand the service no rights of their own, only
// the caller and the item service of each nature. No database: the budget file service is a
// double here; the load of a mixed file is covered by budget-file.spec and the integration spec.

function testGuards() {
  for (const controller of [SpendItemsController, CapexItemsController]) {
    for (const handler of ['exportBudgetFile', 'preflightBudgetFile', 'importBudgetFile']) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRE_LEVEL_KEY, (controller.prototype as any)[handler]),
        { resource: 'budget', level: 'admin' },
        `${controller.name}.${handler}: budget:admin`,
      );
    }
  }
}

async function testControllers() {
  const opexSvc = { nature: 'opex' };
  const capexSvc = { nature: 'capex' };
  const audit = { log: async () => undefined };
  const freeze = { assertNotFrozen: async () => undefined };
  const routes: Array<['opex' | 'capex', (budgetFile: unknown) => any]> = [
    ['opex', (budgetFile) => new SpendItemsController(opexSvc as any, undefined as any, undefined as any, undefined as any, budgetFile as any, audit as any, freeze as any, capexSvc as any)],
    ['capex', (budgetFile) => new CapexItemsController(capexSvc as any, undefined as any, undefined as any, undefined as any, budgetFile as any, audit as any, freeze as any, opexSvc as any)],
  ];
  for (const [scope, build] of routes) {
    const calls: Array<{ method: string; scope: string; caller: Record<string, unknown>; items?: unknown }> = [];
    const budgetFile = {
      preflight: async (route: string, _file: Buffer, caller: Record<string, unknown>) => {
        calls.push({ method: 'preflight', scope: route, caller });
        return { ok: true };
      },
      importFile: async (route: string, _file: Buffer, _snapshot: unknown, caller: Record<string, unknown>, _options: unknown, deps: { items: unknown }) => {
        calls.push({ method: 'import', scope: route, caller, items: deps.items });
        return { ok: true, dryRun: false, inserted: 0, updated: 0, createdSuppliers: false, createdDimensionValues: false };
      },
    };
    const controller = build(budgetFile);
    const file = { buffer: Buffer.from('nature,item_number\n') };
    const ctx = { manager: {}, tenantId: 'tenant', userId: 'user', isAdmin: false, permissions: { budget: 'admin' } };
    await controller.preflightBudgetFile(file, 'en', '', '', 'false', ctx);
    await controller.importBudgetFile(file, '{"lines":[]}', 'en', '', '', 'false', ctx, {});
    assert.deepEqual(
      calls.map((call) => [call.method, call.scope, call.caller]),
      [
        ['preflight', scope, { manager: {}, tenantId: 'tenant', userId: 'user' }],
        ['import', scope, { manager: {}, tenantId: 'tenant', userId: 'user' }],
      ],
      `${scope} list: the caller, with no rights by nature`,
    );
    for (const call of calls.filter((entry) => entry.method === 'import')) {
      assert.deepEqual(call.items, { opex: opexSvc, capex: capexSvc }, `${scope} list: the item service of each nature`);
    }
  }
}

async function main() {
  testGuards();
  await testControllers();
  console.log('budget-file-rights.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
