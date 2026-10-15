import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { REQUIRE_LEVEL_KEY, RequireLevelMeta } from '../../auth/require-level.decorator';
import { ContractsController } from '../contracts.controller';
import { canReadContractBudget } from '../contract-budget';

function run() {
  const listMeta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, ContractsController.prototype.listAttachments) as RequireLevelMeta;
  const uploadMeta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, ContractsController.prototype.uploadAttachment) as RequireLevelMeta;

  assert.deepEqual(listMeta, { resource: 'contracts', level: 'reader' });
  assert.deepEqual(uploadMeta, { resource: 'contracts', level: 'member' });

  // The contract's relations: read with the contracts, written by their members.
  const proto = ContractsController.prototype as any;
  for (const route of ['relationCounts', 'listBudgetLines', 'budgetCoverage', 'listApplications', 'listAssets', 'share']) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'contracts', level: 'reader' }, route);
  }
  for (const route of ['bulkReplaceBudgetLines', 'bulkReplaceApplications', 'bulkReplaceAssets']) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'contracts', level: 'member' }, route);
  }

  // The compliance register: read with the contract, recorded by its members, exported by
  // administrators like the other contract exports.
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.compliance), { resource: 'contracts', level: 'reader' }, 'compliance');
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.updateCompliance), { resource: 'contracts', level: 'member' }, 'updateCompliance');
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.exportComplianceRegister), { resource: 'contracts', level: 'admin' }, 'exportComplianceRegister');
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.export), { resource: 'contracts', level: 'admin' }, 'export');

  // Deleting contracts, and the counts its confirmation shows: administrators, as for suppliers.
  for (const route of ['delete', 'bulkDelete', 'deleteImpact']) {
    assert.equal(typeof proto[route], 'function', route);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'contracts', level: 'admin' }, route);
  }
  // Nest matches routes in declaration order: `DELETE bulk` comes before `DELETE :id`.
  const methods = Object.getOwnPropertyNames(ContractsController.prototype);
  assert.ok(methods.indexOf('bulkDelete') < methods.indexOf('delete'), 'bulk before :id');
  assert.ok(methods.indexOf('deleteImpact') < methods.indexOf('get'), 'delete-impact before :id');

  // The budget figures of a contract (its Budget tab, the list's budget columns) also need the budget.
  assert.equal(canReadContractBudget({ isAdmin: true, permissions: {} }), true, 'administrator');
  assert.equal(canReadContractBudget({ permissions: { contracts: 'reader', budget: 'reader' } }), true, 'budget reader');
  assert.equal(canReadContractBudget({ permissions: { contracts: 'admin', budget: 'member' } }), true, 'budget member');
  assert.equal(canReadContractBudget({ permissions: { contracts: 'admin' } }), false, 'contracts only');
  assert.equal(canReadContractBudget(undefined), false, 'no request');
}

run();
