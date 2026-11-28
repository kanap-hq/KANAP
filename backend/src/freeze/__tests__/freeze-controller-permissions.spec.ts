import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  REQUIRE_ANY_LEVEL_KEY,
  REQUIRE_LEVEL_KEY,
  RequireAnyLevelMeta,
  RequireLevelMeta,
} from '../../auth/require-level.decorator';
import { FreezeController } from '../freeze.controller';

// The freeze state of a year is read by every reader of the budget lines (the padlocks of the
// budget tab and of the list), of budget administration, of companies or of departments. Changing
// it stays with the administrators of budget administration, companies or departments.

const proto = FreezeController.prototype;
const levelOf = (handler: unknown) => Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler as object) as RequireLevelMeta | undefined;
const anyOf = (handler: unknown) => Reflect.getMetadata(REQUIRE_ANY_LEVEL_KEY, handler as object) as RequireAnyLevelMeta | undefined;

function run() {
  assert.equal(levelOf(FreezeController), undefined, 'no class-level requirement');
  assert.equal(anyOf(FreezeController), undefined, 'no class-level requirement');

  assert.deepEqual(anyOf(proto.list), [
    { resource: 'budget_ops', level: 'reader' },
    { resource: 'budget', level: 'reader' },
    { resource: 'companies', level: 'reader' },
    { resource: 'departments', level: 'reader' },
  ], 'list: read by budget lines, budget administration, companies or departments readers');
  assert.equal(levelOf(proto.list), undefined, 'list: no single-resource requirement on top');
  console.log('ok - the freeze state is read by every budget lines reader');

  for (const [name, handler] of [['freezeAction', proto.freezeAction], ['unfreezeAction', proto.unfreezeAction]] as const) {
    assert.deepEqual(anyOf(handler), [
      { resource: 'budget_ops', level: 'admin' },
      { resource: 'companies', level: 'admin' },
      { resource: 'departments', level: 'admin' },
    ], `${name}: administrators only`);
    assert.ok(!(anyOf(handler) ?? []).some((meta) => meta.resource === 'budget'), `${name}: the budget lines right does not change a freeze`);
  }
  console.log('ok - freezing and unfreezing stay with the administrators');
}

run();
