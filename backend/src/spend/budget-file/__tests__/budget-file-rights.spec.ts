import * as assert from 'node:assert/strict';
import { budgetFileNatures } from '../budget-file.service';
import { SpendItemsController } from '../../spend-items.controller';
import { CapexItemsController } from '../../capex-items.controller';

// Who may load which lines of a budget file (lot C1b: one file for both natures). The route asks
// for the Admin level on its own nature; a line of the other nature needs the Admin level on that
// one too (`budgetFileNatures`), and the controllers hand the service the caller's natures and the
// item service of each nature. No database: the budget file service is a double here; the
// preflight's refusal of such a line is covered by budget-file.spec and the integration spec.

type Rights = { isAdmin?: boolean; permissions?: Record<string, string> };

function testNatures() {
  const cases: Array<[string, 'opex' | 'capex', Rights, string[]]> = [
    ['an administrator', 'opex', { isAdmin: true, permissions: {} }, ['opex', 'capex']],
    ['OPEX admin, CAPEX member', 'opex', { permissions: { opex: 'admin', capex: 'member' } }, ['opex']],
    ['both admin', 'opex', { permissions: { opex: 'admin', capex: 'admin' } }, ['opex', 'capex']],
    ['CAPEX admin, OPEX reader', 'capex', { permissions: { capex: 'admin', opex: 'reader' } }, ['capex']],
    ['both admin, on the CAPEX list', 'capex', { permissions: { capex: 'admin', opex: 'admin' } }, ['opex', 'capex']],
    ['no permission read (the guard asked for the route\'s)', 'capex', {}, ['capex']],
  ];
  for (const [label, scope, rights, expected] of cases) {
    assert.deepEqual(budgetFileNatures(scope, rights), expected, label);
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
    const calls: Array<{ method: string; scope: string; natures: unknown; items?: unknown }> = [];
    const budgetFile = {
      preflight: async (route: string, _file: Buffer, caller: { natures?: unknown }) => {
        calls.push({ method: 'preflight', scope: route, natures: caller.natures });
        return { ok: true };
      },
      importFile: async (route: string, _file: Buffer, _snapshot: unknown, caller: { natures?: unknown }, _options: unknown, deps: { items: unknown }) => {
        calls.push({ method: 'import', scope: route, natures: caller.natures, items: deps.items });
        return { ok: true, dryRun: false, inserted: 0, updated: 0, createdSuppliers: false, createdDimensionValues: false };
      },
    };
    const controller = build(budgetFile);
    const file = { buffer: Buffer.from('nature,item_number\n') };
    const other = scope === 'opex' ? 'capex' : 'opex';
    const oneRight = { manager: {}, tenantId: 'tenant', userId: 'user', isAdmin: false, permissions: { [scope]: 'admin', [other]: 'member' } };
    const bothRights = { ...oneRight, permissions: { [scope]: 'admin', [other]: 'admin' } };
    await controller.preflightBudgetFile(file, 'en', '', '', 'false', oneRight);
    await controller.preflightBudgetFile(file, 'en', '', '', 'false', bothRights);
    await controller.importBudgetFile(file, '{"lines":[]}', 'en', '', '', 'false', oneRight, {});
    await controller.importBudgetFile(file, '{"lines":[]}', 'en', '', '', 'false', bothRights, {});
    assert.deepEqual(
      calls.map((call) => [call.method, call.scope, call.natures]),
      [
        ['preflight', scope, [scope]],
        ['preflight', scope, ['opex', 'capex']],
        ['import', scope, [scope]],
        ['import', scope, ['opex', 'capex']],
      ],
      `${scope} list: the caller's natures`,
    );
    for (const call of calls.filter((entry) => entry.method === 'import')) {
      assert.deepEqual(call.items, { opex: opexSvc, capex: capexSvc }, `${scope} list: the item service of each nature`);
    }
  }
}

async function main() {
  testNatures();
  await testControllers();
  console.log('budget-file-rights.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
