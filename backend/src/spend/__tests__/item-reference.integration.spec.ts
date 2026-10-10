import 'dotenv/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItem } from '../spend-item.entity';
import { SpendItemsController } from '../spend-items.controller';
import { SpendItemsDeleteService } from '../spend-items-delete.service';
import { CapexItemsController } from '../capex-items.controller';
import { CapexItemsDeleteService } from '../spend-items-delete.service';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { SpendVersionsController } from '../spend-versions.controller';
import { SpendVersionsService } from '../spend-versions.service';
import { SpendTasksController } from '../spend-tasks.controller';
import { SpendTasksService } from '../spend-tasks.service';
import { CapexVersionsController } from '../capex-versions.controller';
import { CapexVersionsService } from '../spend-versions.service';
import { CapexTasksController } from '../capex-tasks.controller';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { ContractsService } from '../../contracts/contracts.service';
import { SpendItemContractsController } from '../../contracts/spend-item-contracts.controller';
import { CapexItemContractsController } from '../../contracts/capex-item-contracts.controller';
import { itemService } from './cost-center.fixtures';
import { assert, captureAudit, inRolledBackTransaction, Kind, runSpecs, seedItem, seedTenant, seedVersion } from './round-inputs.fixtures';

// Every route under /spend-items/:id and /capex-items/:id takes a UUID or the
// item's business reference (OPX-N on OPEX, CPX-N on CAPEX), whatever
// controller hosts it, as does the item service itself (AI and internal
// callers): update, delete, the item's own nested routes, versions, tasks and
// contracts work by reference; a malformed id, or the other type's reference,
// is a 400 before any SQL runs; an unknown reference is a 404.

const USER = '00000000-0000-4000-8000-00000000abcd';
const KINDS: Kind[] = ['opex', 'capex'];
const REF: Record<Kind, string> = { opex: 'OPX', capex: 'CPX' };
const OTHER_REF: Record<Kind, string> = { opex: 'CPX', capex: 'OPX' };
// `apiFk`: the key the routes of the nature name the line by (the CAPEX contract keeps `capex_item_id`);
// both natures share the tables since lot Z1.
const T = {
  opex: {
    items: 'spend_items', links: 'spend_links', linkFk: 'spend_item_id', apiFk: 'spend_item_id', entity: 'spend',
    versions: 'spend_versions', contracts: 'contract_spend_items', taskType: 'spend_item',
  },
  capex: {
    items: 'spend_items', links: 'spend_links', linkFk: 'spend_item_id', apiFk: 'capex_item_id', entity: 'capex',
    versions: 'spend_versions', contracts: 'contract_spend_items', taskType: 'capex_item',
  },
} as const;

/** The item controller of a type on the real classes, with the services its item routes use. */
function controller(kind: Kind, runner: QueryRunner) {
  const svc = itemService(kind);
  const synced: string[] = [];
  svc.itemContacts = { syncFromSupplier: async (itemId: string) => { synced.push(itemId); } };
  const storage = { deleteObject: async () => undefined };
  const aggregates = new UserTimeAggregateService();
  const ctl: any = kind === 'opex'
    ? new SpendItemsController(
      svc,
      new SpendItemsDeleteService(
        runner.manager.getRepository(SpendItem), undefined as any, undefined as any, undefined as any, captureAudit() as any, storage as any, aggregates,
      ),
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
    )
    : new CapexItemsController(
      svc,
      new CapexItemsDeleteService(
        runner.manager.getRepository(SpendItem), undefined as any, undefined as any, undefined as any, captureAudit() as any, storage as any, aggregates,
      ),
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
    );
  return { ctl, svc, synced };
}

async function seedCompany(runner: QueryRunner, tenantId: string): Promise<string> {
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Reference test company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  return company.id;
}

async function row(runner: QueryRunner, kind: Kind, itemId: string) {
  const [found] = await runner.query(`SELECT id, notes, supplier_id FROM ${T[kind].items} WHERE id = $1`, [itemId]);
  return found ?? null;
}

async function testUpdateAndDeleteByReference(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `ref-${kind}`);
    const companyId = await seedCompany(runner, tenantId);
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Reference supplier') RETURNING id`, [tenantId]);
    const itemId = await seedItem(runner, kind, tenantId, 35, 'Line by reference');
    const deletedId = await seedItem(runner, kind, tenantId, 36, 'Line deleted by reference');
    const { ctl, svc, synced } = controller(kind, runner);
    const ctx = { manager: runner.manager, tenantId, userId: USER, userRoles: [] } as any;

    // PATCH /:id by reference (lower case too); the supplier sync gets the resolved id.
    const updated = await ctl.update(`${REF[kind]}-35`, { paying_company_id: companyId, notes: 'Edited by reference', supplier_id: supplier.id }, ctx);
    assert.equal(updated.id, itemId, `${kind}: PATCH by reference answers the line`);
    assert.equal((await row(runner, kind, itemId)).notes, 'Edited by reference', `${kind}: PATCH by reference saved`);
    assert.deepEqual(synced, [itemId], `${kind}: the supplier sync runs on the line's id`);
    await ctl.update(`${REF[kind].toLowerCase()}-35`, { paying_company_id: companyId, notes: 'Lower case' }, ctx);
    assert.equal((await row(runner, kind, itemId)).notes, 'Lower case', `${kind}: a lower-case reference works`);

    // The service resolves too (AI and internal callers), and so do nested routes.
    await svc.update(`${REF[kind]}-35`, { paying_company_id: companyId, notes: 'From the service' }, USER, { manager: runner.manager });
    assert.equal((await row(runner, kind, itemId)).notes, 'From the service', `${kind}: the service updates by reference`);
    assert.equal((await ctl.get(`${REF[kind]}-35`, ctx)).id, itemId, `${kind}: GET by reference`);
    assert.deepEqual(await svc.listProjects(`${REF[kind]}-35`, { manager: runner.manager }), { items: [] }, `${kind}: projects by reference`);
    assert.deepEqual(await ctl.bulkReplaceProjects(`${REF[kind]}-35`, { project_ids: [] }, ctx), { items: [] }, `${kind}: project replace by reference`);
    const link = await ctl.createLink(`${REF[kind]}-35`, { url: 'https://example.com/ref' }, ctx);
    assert.equal(link[T[kind].apiFk], itemId, `${kind}: a link created by reference belongs to the line`);
    assert.deepEqual((await ctl.listLinks(`${REF[kind]}-35`, ctx)).map((l: any) => l.id), [link.id], `${kind}: links by reference`);
    await ctl.deleteLink(`${REF[kind]}-35`, link.id, ctx);
    const [{ n: links }] = await runner.query(`SELECT count(*)::int AS n FROM ${T[kind].links} WHERE ${T[kind].linkFk} = $1`, [itemId]);
    assert.equal(links, 0, `${kind}: link deleted by reference`);

    // DELETE /:id by reference removes that line only.
    await ctl.delete(`${REF[kind]}-36`, ctx);
    assert.equal(await row(runner, kind, deletedId), null, `${kind}: DELETE by reference`);
    assert.ok(await row(runner, kind, itemId), `${kind}: the other line is kept`);
  });
}

async function testMalformedIdIsA400(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `ref-bad-${kind}`);
    const companyId = await seedCompany(runner, tenantId);
    const itemId = await seedItem(runner, kind, tenantId, 35, 'Untouched line');
    const { ctl, svc } = controller(kind, runner);
    const ctx = { manager: runner.manager, tenantId, userId: USER, userRoles: [] } as any;
    const body = { paying_company_id: companyId, notes: 'Must not be saved' };

    const calls: Array<[string, () => Promise<unknown>]> = [
      ['PATCH', () => ctl.update('not-an-id', body, ctx)],
      ['DELETE', () => ctl.delete('not-an-id', ctx)],
      ['GET', () => ctl.get('not-an-id', ctx)],
      ['GET links', () => ctl.listLinks('not-an-id', ctx)],
      ['GET projects', () => ctl.listProjects('not-an-id', ctx)],
      ['service update', () => svc.update('not-an-id', body, USER, { manager: runner.manager })],
    ];
    for (const [label, call] of calls) {
      await assert.rejects(
        call,
        (err: unknown) => err instanceof BadRequestException && (err as Error).message === 'Invalid item reference: not-an-id',
        `${kind}: ${label} with a malformed id is a 400`,
      );
    }
    for (const [label, call] of [
      ['PATCH', () => ctl.update(`${OTHER_REF[kind]}-35`, body, ctx)],
      ['DELETE', () => ctl.delete(`${OTHER_REF[kind]}-35`, ctx)],
    ] as Array<[string, () => Promise<unknown>]>) {
      await assert.rejects(
        call,
        (err: unknown) => err instanceof BadRequestException
          && (err as Error).message === `Invalid reference for ${T[kind].entity}: expected ${REF[kind]}-N, got ${OTHER_REF[kind]}-35`,
        `${kind}: ${label} with the other type's reference is a 400`,
      );
    }
    await assert.rejects(
      () => ctl.update(`${REF[kind]}-999`, body, ctx),
      (err: unknown) => err instanceof NotFoundException,
      `${kind}: an unknown reference is a 404`,
    );

    // No SQL error ran (it would have aborted the transaction) and nothing changed.
    const kept = await row(runner, kind, itemId);
    assert.ok(kept, `${kind}: the line is kept`);
    assert.equal(kept.notes, null, `${kind}: the line is unchanged`);
  });
}

/** The controllers mounted under the item's route by other modules, on the real classes. */
function nestedControllers(kind: Kind) {
  const none = undefined as any;
  const unified = new TasksUnifiedService(none, none, none, none, none, none, none, none, none);
  const contracts = new ContractsService(none, none, none, none, none, none, none, none, none);
  return kind === 'opex'
    ? {
      versions: new SpendVersionsController(new SpendVersionsService(none, none, none, none), none, none) as any,
      tasks: new SpendTasksController(new SpendTasksService(unified, none)) as any,
      contracts: new SpendItemContractsController(contracts) as any,
    }
    : {
      versions: new CapexVersionsController(new CapexVersionsService(none, none, none, none), none, none) as any,
      tasks: new CapexTasksController(unified) as any,
      contracts: new CapexItemContractsController(contracts) as any,
    };
}

async function seedTask(runner: QueryRunner, kind: Kind, tenantId: string, itemNumber: number, itemId: string): Promise<string> {
  const [task] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, itemNumber, `Reference task ${itemNumber}`, T[kind].taskType, itemId],
  );
  return task.id;
}

async function seedContract(runner: QueryRunner, tenantId: string, companyId: string): Promise<string> {
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Contract supplier') RETURNING id`, [tenantId]);
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months)
     VALUES ($1, 'Reference contract', $2, $3, '2026-01-01', 12, 1) RETURNING id`,
    [tenantId, companyId, supplier.id],
  );
  return contract.id;
}

async function count(runner: QueryRunner, table: string, column: string, id: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id]);
  return n;
}

async function testVersionsTasksContractsByReference(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `ref-nested-${kind}`);
    const companyId = await seedCompany(runner, tenantId);
    const itemId = await seedItem(runner, kind, tenantId, 35, 'Line with nested rows');
    const otherItemId = await seedItem(runner, kind, tenantId, 36, 'Other line');
    const versionId = await seedVersion(runner, kind, tenantId, itemId, 2031);
    await seedVersion(runner, kind, tenantId, otherItemId, 2031);
    const taskId = await seedTask(runner, kind, tenantId, 1, itemId);
    await seedTask(runner, kind, tenantId, 2, otherItemId);
    const contractId = await seedContract(runner, tenantId, companyId);
    for (const id of [itemId, otherItemId]) {
      await runner.query(`INSERT INTO ${T[kind].contracts} (tenant_id, contract_id, ${T[kind].linkFk}) VALUES ($1, $2, $3)`, [tenantId, contractId, id]);
    }
    const { versions, tasks, contracts } = nestedControllers(kind);
    const req = { queryRunner: runner, user: { sub: USER }, tenant: { id: tenantId } };
    const ref = `${REF[kind]}-35`;

    // Reads by reference answer the line's rows only.
    assert.deepEqual((await versions.listForItem(ref, req)).map((v: any) => v.id), [versionId], `${kind}: versions by reference`);
    assert.deepEqual((await tasks.list(ref, req)).map((t: any) => t.id), [taskId], `${kind}: tasks by reference`);
    assert.deepEqual(await contracts.list(ref, req), { items: [{ id: contractId, name: 'Reference contract' }] }, `${kind}: contracts by reference`);

    // A write by reference: emptying the line's contracts removes its link, not the other line's.
    assert.deepEqual(await contracts.bulkReplace(ref, { contract_ids: [] }, req), { ok: true, added: 0, removed: 1 }, `${kind}: contracts replaced by reference`);
    assert.equal(await count(runner, T[kind].contracts, T[kind].linkFk, itemId), 0, `${kind}: the line's contract link is gone`);
    assert.equal(await count(runner, T[kind].contracts, T[kind].linkFk, otherItemId), 1, `${kind}: the other line's contract link is kept`);

    // Every route of the three families: a malformed id or the other type's reference is a 400, an unknown reference a 404.
    const routes: Array<[string, (id: string) => Promise<unknown>]> = [
      ['versions GET', (id) => versions.listForItem(id, req)],
      ['versions POST', (id) => versions.createForItem(id, { version_name: 'Refused', as_of_date: '2032-01-01', input_grain: 'annual' }, req)],
      ['versions PATCH', (id) => versions.updateForItem(id, { id: versionId, notes: 'Refused' }, req)],
      ['tasks GET', (id) => tasks.list(id, req)],
      ['tasks POST', (id) => tasks.create(id, { title: 'Refused' }, req)],
      ['tasks PATCH', (id) => tasks.update(id, { id: taskId, title: 'Refused' }, req)],
      ['contracts GET', (id) => contracts.list(id, req)],
      ['contracts bulk-replace', (id) => contracts.bulkReplace(id, { contract_ids: [contractId] }, req)],
    ];
    for (const [label, call] of routes) {
      await assert.rejects(
        () => call('not-an-id'),
        (err: unknown) => err instanceof BadRequestException && (err as Error).message === 'Invalid item reference: not-an-id',
        `${kind}: ${label} with a malformed id is a 400`,
      );
      await assert.rejects(
        () => call(`${OTHER_REF[kind]}-35`),
        (err: unknown) => err instanceof BadRequestException && /^Invalid reference for /.test((err as Error).message),
        `${kind}: ${label} with the other type's reference is a 400`,
      );
      await assert.rejects(
        () => call(`${REF[kind]}-999`),
        (err: unknown) => err instanceof NotFoundException,
        `${kind}: ${label} with an unknown reference is a 404`,
      );
    }

    // No SQL error ran (it would have aborted the transaction) and the refused writes changed nothing.
    assert.equal(await count(runner, T[kind].versions, T[kind].linkFk, itemId), 1, `${kind}: no version added`);
    const [task] = await runner.query(`SELECT title FROM tasks WHERE id = $1`, [taskId]);
    assert.equal(task.title, 'Reference task 1', `${kind}: the task is unchanged`);
    assert.equal(await count(runner, T[kind].contracts, T[kind].linkFk, itemId), 0, `${kind}: no contract link added`);
  });
}

void runSpecs('item-reference.integration.spec', KINDS.flatMap((kind) => [
  [`testUpdateAndDeleteByReference(${kind})`, () => testUpdateAndDeleteByReference(kind)],
  [`testMalformedIdIsA400(${kind})`, () => testMalformedIdIsA400(kind)],
  [`testVersionsTasksContractsByReference(${kind})`, () => testVersionsTasksContractsByReference(kind)],
] as Array<[string, () => Promise<void>]>));

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
