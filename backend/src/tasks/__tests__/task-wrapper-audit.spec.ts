import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ContractsService } from '../../contracts/contracts.service';
import { SpendTasksService } from '../../spend/spend-tasks.service';

// A contract task and a budget line task are audited once, under `tasks`, by the unified
// service. These wrappers used to write a second row under `contract_tasks` and `spend_tasks`.
// This spec does not open a database: it runs in the parallel lane.

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER = { name: 'request-manager' };

type AuditEntry = { table?: string; action?: string; recordId?: string };

function fakes(saved: { id: string; title: string }) {
  const logged: AuditEntry[] = [];
  const audit = {
    log: async (entry: AuditEntry) => {
      logged.push({ table: entry.table, action: entry.action, recordId: entry.recordId });
    },
  };
  const calls: Array<{ method: string; target: unknown; userId?: string; opts?: unknown }> = [];
  const unified = {
    createForTarget: async (target: unknown, userId?: string, opts?: unknown) => {
      calls.push({ method: 'createForTarget', target, userId, opts });
      return saved;
    },
    updateForTarget: async (target: unknown, userId?: string, opts?: unknown) => {
      calls.push({ method: 'updateForTarget', target, userId, opts });
      return { ...saved, title: 'Updated' };
    },
  };
  return { audit, logged, unified, calls };
}

async function testSpendTasksDoNotAudit() {
  const saved = { id: '44444444-4444-4444-8444-444444444444', title: 'Chase the invoice' };
  const { audit, logged, unified, calls } = fakes(saved);
  // The audit service is no longer injected. Hang the fake on the instance so a restored
  // `this.audit.log` in the wrapper is still visible here.
  const service = new SpendTasksService(unified as any) as SpendTasksService & { audit?: typeof audit };
  assert.equal(SpendTasksService.length, 1, 'SpendTasksService takes the unified service only');
  service.audit = audit;

  const body = { title: 'Chase the invoice' };
  const opts = { manager: MANAGER as any, tenantId: 'tenant-1' };
  const created = await service.createForItem(ITEM_ID, body, USER_ID, opts);
  assert.equal(created, saved, 'createForItem returns the task from the unified service');
  assert.deepEqual(calls[0], {
    method: 'createForTarget',
    target: { type: 'spend_item', id: ITEM_ID, payload: body },
    userId: USER_ID,
    opts,
  });

  const patch = { id: saved.id, title: 'Updated' };
  const updated = await service.updateForItem(ITEM_ID, patch, USER_ID, opts);
  assert.equal(updated.title, 'Updated', 'updateForItem returns the task from the unified service');
  assert.deepEqual(calls[1], {
    method: 'updateForTarget',
    target: { type: 'spend_item', id: ITEM_ID, payload: patch },
    userId: USER_ID,
    opts,
  });
  assert.deepEqual(logged, [], 'createForItem and updateForItem do not call audit.log');
}

async function testContractTasksDoNotAudit() {
  const saved = { id: '55555555-5555-4555-8555-555555555555', title: 'Renew the contract' };
  const { audit, logged, unified, calls } = fakes(saved);
  const none = undefined as any;
  const service = new ContractsService(none, none, none, none, audit as any, unified as any, none, none, none, none);

  const body = { title: 'Renew the contract' };
  const opts = { manager: MANAGER as any, tenantId: 'tenant-1' };
  const created = await service.createTask(CONTRACT_ID, body, USER_ID, opts);
  assert.equal(created, saved, 'createTask returns the task from the unified service');
  assert.deepEqual(calls[0], {
    method: 'createForTarget',
    target: { type: 'contract', id: CONTRACT_ID, payload: body },
    userId: USER_ID,
    opts,
  });

  const patch = { id: saved.id, title: 'Updated' };
  const updated = await service.updateTask(CONTRACT_ID, patch, USER_ID, opts);
  assert.equal(updated.title, 'Updated', 'updateTask returns the task from the unified service');
  assert.deepEqual(calls[1], {
    method: 'updateForTarget',
    target: { type: 'contract', id: CONTRACT_ID, payload: patch },
    userId: USER_ID,
    opts,
  });
  assert.deepEqual(logged, [], 'createTask and updateTask do not call audit.log');
}

async function run() {
  await testSpendTasksDoNotAudit();
  await testContractTasksDoNotAudit();
  console.log('task-wrapper-audit.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
