// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AiBusinessRecordMutationSupportService } from '../mutation/ai-business-record-mutation-support.service';
import { UpdateTaskFieldsAiMutationOperation } from '../mutation/operations/update-task-fields.ai-mutation-operation';
import type { AiExecutionContextWithManager } from '../ai.types';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { inRolledBackTransaction, seedCreationTenant } from '../../common/creation/__tests__/creation-cancel.fixtures';

// Kad and the pairs of a record (lot I7a of 26.12.1). "Put the stream Ops on REQ-n" with two streams
// named Ops takes the one of the request's category (P12); with no category, Kad is told to ask which,
// the categories named; a stream of another category is refused before the card, by the rule the
// screen's save applies (P13). The category a stream gives, or the stream a category change drops,
// joins the card. The same on a task, whose category is its project's where it has none.

async function seed(runner: QueryRunner) {
  const base = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin', tasks: 'admin' });
  const { tenantId } = base;
  const id = () => randomUUID();
  const ids = { it: id(), biz: id(), opsIt: id(), opsBiz: id(), devIt: id(), runBiz: id(), companyA: id(), companyB: id(), finA: id(), finB: id() };
  await runner.query(`INSERT INTO portfolio_categories (id, tenant_id, name) VALUES ($1, $3, 'IT'), ($2, $3, 'Business')`, [ids.it, ids.biz, tenantId]);
  await runner.query(
    `INSERT INTO portfolio_streams (id, tenant_id, category_id, name)
     VALUES ($1, $5, $6, 'Ops'), ($2, $5, $7, 'Ops'), ($3, $5, $6, 'Dev'), ($4, $5, $7, 'Run')`,
    [ids.opsIt, ids.opsBiz, ids.devIt, ids.runBiz, tenantId, ids.it, ids.biz],
  );
  await runner.query(
    `INSERT INTO companies (id, tenant_id, name, country_iso, city) VALUES ($1, $3, 'Alpha', 'FR', 'Lyon'), ($2, $3, 'Beta', 'FR', 'Brest')`,
    [ids.companyA, ids.companyB, tenantId],
  );
  await runner.query(
    `INSERT INTO departments (id, tenant_id, company_id, name) VALUES ($1, $3, $4, 'Finance'), ($2, $3, $5, 'Finance')`,
    [ids.finA, ids.finB, tenantId, ids.companyA, ids.companyB],
  );
  return { ...base, ids };
}

function context(runner: QueryRunner, tenantId: string, userId: string): AiExecutionContextWithManager {
  return { tenantId, userId, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', conversationId: 'membership-spec', manager: runner.manager } as AiExecutionContextWithManager;
}

function support(): any {
  return new AiBusinessRecordMutationSupportService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
}

/** The refusal of a preview, inside a savepoint so the transaction goes on: its code and message. */
async function refusal(runner: QueryRunner, prepare: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  await runner.query('SAVEPOINT kad_membership');
  try {
    await prepare();
  } catch (error) {
    await runner.query('ROLLBACK TO SAVEPOINT kad_membership');
    const body = (error as any)?.getResponse?.();
    return { code: body?.code, message: (error as Error).message };
  }
  await runner.query('ROLLBACK TO SAVEPOINT kad_membership');
  throw new Error('expected the preview to be refused');
}

async function testRequestsAndProjects() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, ids } = await seed(runner);
    const ctx = context(runner, tenantId, creatorId);
    const kad = support();
    const request = async (n: number, values: { category?: string | null; stream?: string | null; company?: string | null }) => {
      await runner.query(
        `INSERT INTO portfolio_requests (id, tenant_id, item_number, name, status, category_id, stream_id, company_id)
         VALUES ($1, $2, $3, $4, 'pending_review', $5, $6, $7)`,
        [randomUUID(), tenantId, n, `Request ${n}`, values.category ?? null, values.stream ?? null, values.company ?? null],
      );
      return `REQ-${n}`;
    };
    const preview = (ref: string, fields: Record<string, unknown>, entity_type = 'requests') => kad.prepareUpdatePreview(ctx, { entity_type, ref, fields });

    // "Put the stream Ops on REQ-1": the Ops of the request's category.
    const business = await preview(await request(1, { category: ids.biz }), { stream_id: 'Ops' });
    assert.equal(business.mutationInput.fields.stream_id, ids.opsBiz, 'the Ops of the request category');
    // No category: Kad asks which, the categories named.
    await request(2, {});
    const ask = await refusal(runner, () => preview('REQ-2', { stream_id: 'Ops' }));
    assert.equal(ask.code, 'STREAM_NAME_IN_SEVERAL_CATEGORIES', ask.message);
    assert.match(ask.message, /"Business", "IT"/);
    assert.match(ask.message, /Ask which category/);
    // The category given with it, in the same sentence.
    const both = await preview('REQ-2', { category_id: 'IT', stream_id: 'Ops' });
    assert.deepEqual([both.mutationInput.fields.category_id, both.mutationInput.fields.stream_id], [ids.it, ids.opsIt]);
    // A stream of another category: refused before the card, as the screen's save is.
    await request(3, { category: ids.it });
    const outside = await refusal(runner, () => preview('REQ-3', { stream_id: 'Run' }));
    assert.equal(outside.code, 'STREAM_OUTSIDE_CATEGORY', outside.message);
    assert.match(outside.message, /The stream "Run" belongs to the category "Business"\. It cannot go with the category "IT"\./);
    const department = await preview('REQ-3', { company_id: 'Alpha', department_id: 'Finance' });
    assert.equal(department.mutationInput.fields.department_id, ids.finA, 'the department of the company given with it');
    // A unique stream gives its category, which joins the card.
    const given = await preview('REQ-2', { stream_id: 'Dev' });
    assert.deepEqual([given.mutationInput.fields.stream_id, given.mutationInput.fields.category_id], [ids.devIt, ids.it]);
    assert.equal(given.mutationInput.display_values.category_id, 'IT');
    // The category changed alone drops the stream, on the card.
    await request(4, { category: ids.it, stream: ids.opsIt });
    const moved = await preview('REQ-4', { category_id: 'Business' });
    assert.ok(Object.prototype.hasOwnProperty.call(moved.mutationInput.fields, 'stream_id'), 'the stream is on the card');
    assert.equal(moved.mutationInput.fields.stream_id, null);
    // Departments: by the request's company; with no company, Kad asks.
    await request(5, { company: ids.companyB });
    assert.equal((await preview('REQ-5', { department_id: 'Finance' })).mutationInput.fields.department_id, ids.finB);
    assert.equal((await refusal(runner, () => preview('REQ-2', { department_id: 'Finance' }))).code, 'DEPARTMENT_NAME_IN_SEVERAL_COMPANIES');

    // A project, by the same rule.
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, category_id)
       VALUES ($1, $2, 1, 'Project', 'in_progress', 'fast_track', 0, $3)`,
      [randomUUID(), tenantId, ids.it],
    );
    assert.equal((await preview('PRJ-1', { stream_id: 'Ops' }, 'projects')).mutationInput.fields.stream_id, ids.opsIt);
    assert.equal((await refusal(runner, () => preview('PRJ-1', { stream_id: 'Run' }, 'projects'))).code, 'STREAM_OUTSIDE_CATEGORY');
  });
}

async function testTasks() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, ids } = await seed(runner);
    const ctx = context(runner, tenantId, creatorId);
    const project = randomUUID();
    await runner.query(
      `INSERT INTO portfolio_projects (id, tenant_id, item_number, name, status, origin, execution_progress, category_id, stream_id)
       VALUES ($1, $2, 1, 'Business project', 'in_progress', 'fast_track', 0, $3, $4)`,
      [project, tenantId, ids.biz, ids.runBiz],
    );
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, item_number, title, status, related_object_type, related_object_id) VALUES ($1, $2, 1, 'Task', 'open', 'project', $3)`,
      [randomUUID(), tenantId, project],
    );
    await runner.query(
      `INSERT INTO tasks (id, tenant_id, item_number, title, status) VALUES ($1, $2, 2, 'Standalone', 'open')`,
      [randomUUID(), tenantId],
    );
    const operation: any = new (UpdateTaskFieldsAiMutationOperation as any)(undefined, undefined, undefined);
    const preview = (ref: string, fields: Record<string, unknown>) => operation.prepareCreatePreview(ctx, { ref, fields });

    const shown = await preview('T-1', { stream: 'Ops' });
    assert.equal(shown.mutationInput.fields.stream_id, ids.opsBiz, 'the Ops of the category the task shows, its project one');
    assert.equal((await refusal(runner, () => preview('T-1', { stream: 'Dev' }))).code, 'STREAM_OUTSIDE_CATEGORY');
    const ask = await refusal(runner, () => preview('T-2', { stream: 'Ops' }));
    assert.equal(ask.code, 'STREAM_NAME_IN_SEVERAL_CATEGORIES', ask.message);
    const given = await preview('T-2', { stream: 'Dev' });
    assert.deepEqual([given.mutationInput.fields.stream_id, given.mutationInput.fields.category_id], [ids.devIt, ids.it]);
    const both = await preview('T-2', { stream: 'Ops', category: 'IT' });
    assert.equal(both.mutationInput.fields.stream_id, ids.opsIt, 'the category given in the same sentence');
  });
}

async function main() {
  const specs: Array<[string, () => Promise<void>]> = [
    ['requests and projects', testRequestsAndProjects],
    ['tasks', testTasks],
  ];
  await dataSource.initialize();
  let failed = 0;
  try {
    for (const [name, spec] of specs) {
      try {
        await spec();
        console.log(`ok - ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`not ok - ${name}\n${(error as Error).stack}`);
      }
    }
  } finally {
    await closeMarkdownWorkers();
    await dataSource.destroy();
  }
  process.exit(failed ? 1 : 0);
}

void main();
