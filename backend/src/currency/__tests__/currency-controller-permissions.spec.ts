import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  REQUIRE_ANY_LEVEL_KEY,
  REQUIRE_LEVEL_KEY,
  RequireAnyLevelMeta,
  RequireLevelMeta,
} from '../../auth/require-level.decorator';
import { CurrencyController } from '../currency.controller';

// Currencies are a budget setting: budget, OPEX and CAPEX readers read them,
// budget administrators change them. The IT landscape `settings` resource grants nothing here.

const proto = CurrencyController.prototype;
const levelOf = (handler: unknown) => Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler as object) as RequireLevelMeta | undefined;
const anyOf = (handler: unknown) => Reflect.getMetadata(REQUIRE_ANY_LEVEL_KEY, handler as object) as RequireAnyLevelMeta | undefined;

function run() {
  const readers: RequireAnyLevelMeta = [
    { resource: 'budget_ops', level: 'reader' },
    { resource: 'opex', level: 'reader' },
    { resource: 'capex', level: 'reader' },
  ];

  assert.equal(levelOf(CurrencyController), undefined, 'no class-level requirement');
  assert.equal(anyOf(CurrencyController), undefined, 'no class-level requirement');

  for (const [name, handler] of [['getSettings', proto.getSettings], ['listRates', proto.listRates]] as const) {
    assert.deepEqual(anyOf(handler), readers, `${name}: budget_ops, opex or capex reader`);
    assert.equal(levelOf(handler), undefined, `${name}: no single-resource requirement on top`);
  }
  console.log('ok - settings and rates are read by budget, OPEX and CAPEX readers');

  for (const [name, handler] of [['updateSettings', proto.updateSettings], ['refreshRates', proto.refreshRates]] as const) {
    assert.deepEqual(levelOf(handler), { resource: 'budget_ops', level: 'admin' }, `${name}: budget_ops admin`);
    assert.equal(anyOf(handler), undefined, `${name}: no alternative resource`);
  }
  console.log('ok - settings and rates are changed by budget administrators');

  const handlers = [proto.getSettings, proto.listRates, proto.updateSettings, proto.refreshRates];
  const resources = handlers.flatMap((handler) => [levelOf(handler), ...(anyOf(handler) ?? [])])
    .filter((meta): meta is RequireLevelMeta => !!meta)
    .map((meta) => meta.resource);
  assert.ok(!resources.includes('settings'), 'the IT landscape settings resource grants nothing on currencies');
  console.log('ok - the IT landscape settings resource grants nothing on currencies');

  console.log('currency-controller-permissions.spec: ok');
}

run();
