import 'dotenv/config';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { BusinessProcess } from '../business-process.entity';
import { BusinessProcessesService } from '../business-processes.service';
import { BusinessProcessesDeleteService } from '../business-processes-delete.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The process tree, against a real database, each test in a transaction that is rolled back: a
// process takes a parent and a type; a process under itself, under an unknown parent or under
// one of its own sub-processes is refused with its code; the tree and the list come out in path
// order; `under` keeps the whole subtree; a process with sub-processes cannot be deleted.

const noAudit = { log: async () => undefined } as unknown as AuditService;

function service() {
  return new BusinessProcessesService(undefined as any, undefined as any, noAudit);
}

async function refusedWith(work: () => Promise<unknown>, code: string): Promise<any> {
  try {
    await work();
  } catch (error: any) {
    const body = error?.getResponse?.() ?? {};
    assert.equal(body.code, code, JSON.stringify(body));
    return body;
  }
  assert.fail(`expected ${code}`);
}

async function testParentRules() {
  await inRolledBackTransaction(async (runner) => {
    await seedTenant(runner, 'bp-tree');
    const svc = service();
    const opts = { manager: runner.manager };
    const production: any = await svc.create({ name: 'Production', process_type: 'core' } as any, null, opts);
    const aging: any = await svc.create({ name: 'Aging', parent_id: production.id } as any, null, opts);
    const caves: any = await svc.create({ name: 'Caves', parent_id: aging.id, process_type: 'support' } as any, null, opts);

    const detail: any = await svc.get(aging.id, opts);
    assert.deepEqual(detail.parent, { id: production.id, name: 'Production' });
    assert.equal(detail.path, 'Production › Aging');
    assert.equal(detail.depth, 1);
    assert.deepEqual(detail.children.map((child: any) => child.name), ['Caves']);
    assert.equal(detail.process_type, null, 'the type is not inherited');

    await refusedWith(() => svc.update(aging.id, { parent_id: aging.id } as any, null, opts), 'BUSINESS_PROCESS_OWN_PARENT');
    await refusedWith(() => svc.update(aging.id, { parent_id: '00000000-0000-4000-8000-000000000000' } as any, null, opts), 'BUSINESS_PROCESS_PARENT_NOT_FOUND');
    await refusedWith(() => svc.create({ name: 'Orphan', parent_id: 'not-an-id' } as any, null, opts), 'BUSINESS_PROCESS_PARENT_NOT_FOUND');
    const cycle = await refusedWith(() => svc.update(production.id, { parent_id: caves.id } as any, null, opts), 'BUSINESS_PROCESS_PARENT_CYCLE');
    assert.deepEqual(cycle.params, { name: 'Production', parent: 'Caves' });
    await refusedWith(() => svc.update(production.id, { process_type: 'operations' } as any, null, opts), 'BUSINESS_PROCESS_TYPE_INVALID');

    // Every update takes the tree lock, a description alone too: its save writes the parent it read.
    await svc.update(caves.id, { description: 'Humidity' } as any, null, opts);
    const [lock] = await runner.query(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted`,
    );
    assert.ok(lock.n > 0, 'the tree lock is held');

    // Moving a branch moves its sub-processes with it; an empty parent puts it at the top.
    const sales: any = await svc.create({ name: 'Sales' } as any, null, opts);
    await svc.update(aging.id, { parent_id: sales.id } as any, null, opts);
    assert.equal((await svc.get(caves.id, opts) as any).path, 'Sales › Aging › Caves');
    await svc.update(aging.id, { parent_id: null } as any, null, opts);
    assert.equal((await svc.get(caves.id, opts) as any).path, 'Aging › Caves');
  });
}

async function testTreeListAndDelete() {
  await inRolledBackTransaction(async (runner) => {
    await seedTenant(runner, 'bp-tree-list');
    const svc = service();
    const opts = { manager: runner.manager };
    const production: any = await svc.create({ name: 'Production' } as any, null, opts);
    const quality: any = await svc.create({ name: 'Quality', parent_id: production.id } as any, null, opts);
    await svc.create({ name: 'Audits', parent_id: quality.id } as any, null, opts);
    await svc.create({ name: 'Aging', parent_id: production.id } as any, null, opts);
    await svc.create({ name: 'Billing' } as any, null, opts);

    const tree = await svc.tree(opts);
    assert.deepEqual(
      tree.items.map((node) => `${node.depth}:${node.path}`),
      ['0:Billing', '0:Production', '1:Production › Aging', '1:Production › Quality', '2:Production › Quality › Audits'],
    );

    const byPath: any = await svc.list({ sort: 'path:ASC', limit: 50 }, opts);
    assert.deepEqual(byPath.items.map((item: any) => item.name), ['Billing', 'Production', 'Aging', 'Quality', 'Audits']);
    assert.deepEqual(byPath.items.map((item: any) => item.parent_name), [null, null, 'Production', 'Production', 'Quality']);

    const under: any = await svc.list({ filters: JSON.stringify({ under: { filterType: 'text', type: 'contains', filter: 'production' } }), limit: 50, sort: 'name:ASC' }, opts);
    assert.deepEqual(under.items.map((item: any) => item.name), ['Aging', 'Audits', 'Quality'], 'every process below, at any depth');

    // The tree order holds whatever the names hold: "Production - EMEA" sorts after the whole
    // Production branch, not between Production and its sub-processes.
    await svc.create({ name: 'Production - EMEA' } as any, null, opts);
    const withPunctuation: any = await svc.list({ sort: 'path:ASC', limit: 50 }, opts);
    assert.deepEqual(
      withPunctuation.items.map((item: any) => `${item.depth}:${item.name}`),
      ['0:Billing', '0:Production', '1:Aging', '1:Quality', '2:Audits', '0:Production - EMEA'],
    );

    const deleteSvc = new BusinessProcessesDeleteService(runner.manager.getRepository(BusinessProcess), noAudit);
    const check = await deleteSvc.deleteCheck([production.id, quality.id], opts);
    assert.deepEqual(check.refused.map((refusal: any) => refusal.code).sort(), ['BUSINESS_PROCESS_HAS_SUB_PROCESSES', 'BUSINESS_PROCESS_HAS_SUB_PROCESSES']);
    await refusedWith(() => deleteSvc.delete(quality.id, opts), 'BUSINESS_PROCESS_HAS_SUB_PROCESSES');
  });
}

void runSpecs('business-process-tree.integration.spec', [
  ['testParentRules', testParentRules],
  ['testTreeListAndDelete', testTreeListAndDelete],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
