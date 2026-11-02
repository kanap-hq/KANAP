import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { countAttention } from '../control-plane/agent-control/ai-agent-attention.util';
import { AiAgentControlService } from '../control-plane/agent-control/ai-agent-control.service';
import { AiAgentWorkQueueService } from '../control-plane/agent/ai-agent-work-queue.service';
import { UpdateDocumentRelationsAiMutationOperation } from '../mutation/operations/update-document-relations.ai-mutation-operation';

/**
 * Agent-control and document-relation reads share the request's single connection, so a second
 * find or query must not start until the previous one has finished.
 */
const OVERLAP = 'client.query() when the client is already executing a query';

function busyTracker() {
  let busy = 0;
  let maxBusy = 0;
  let calls = 0;
  const occupy = async <T>(work: () => Promise<T> | T): Promise<T> => {
    if (busy > 0) throw new Error(OVERLAP);
    busy += 1;
    maxBusy = Math.max(maxBusy, busy);
    calls += 1;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return await work();
    } finally {
      busy -= 1;
    }
  };
  return { occupy, maxBusy: () => maxBusy, calls: () => calls };
}

function queryBuilder(occupy: <T>(work: () => Promise<T> | T) => Promise<T>, rows: () => unknown[]) {
  const chain: any = {
    where() { return chain; },
    andWhere() { return chain; },
    orderBy() { return chain; },
    addOrderBy() { return chain; },
    distinctOn() { return chain; },
    getMany: () => occupy(() => rows()),
  };
  return chain;
}

function managerFor(rowsFor: (kind: string) => unknown[], options?: { query?: boolean }) {
  const track = busyTracker();
  const manager: Record<string, unknown> = {
    getRepository: () => ({
      find: (args?: { take?: number }) => track.occupy(() => {
        const rows = rowsFor('find');
        return args?.take ? rows.slice(0, args.take) : rows;
      }),
      findOne: () => track.occupy(() => rowsFor('findOne')[0] ?? null),
      createQueryBuilder: () => queryBuilder(track.occupy, () => rowsFor('many')),
    }),
  };
  if (options?.query !== false) {
    manager.query = (sql: string) => track.occupy(() => rowsFor(sql));
  }
  return { manager, maxBusy: track.maxBusy, calls: track.calls };
}

function controlService(extra: Record<string, unknown> = {}) {
  const none = {} as any;
  return new AiAgentControlService(
    none,
    none,
    none,
    (extra.liveTargets as any) ?? none,
    (extra.providers as any) ?? none,
    (extra.agentQueue as any) ?? undefined,
  );
}

function context(manager: unknown) {
  return { tenantId: randomUUID(), userId: null, manager };
}

async function testCountAttentionIsSerial() {
  const busy = managerFor(() => []);
  const summary = await countAttention(busy.manager as any, randomUUID());
  assert.deepEqual(summary, { actions: 0, work_items: 0, total: 0 });
  assert.equal(busy.calls(), 2);
  assert.equal(busy.maxBusy(), 1);
}

async function testListRunsIsSerialAcrossRuns() {
  const runs = [
    { id: 'run-1', tenant_id: 't', created_at: new Date() },
    { id: 'run-2', tenant_id: 't', created_at: new Date() },
  ];
  let finds = 0;
  const busy = managerFor(() => {
    finds += 1;
    return finds === 1 ? runs : [];
  });
  const result = await controlService().listRuns(context(busy.manager) as any);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].counts.tool_executions, 0);
  assert.ok(busy.calls() >= 7);
  assert.equal(busy.maxBusy(), 1);
}

async function testRunDetailIsSerial() {
  const busy = managerFor((kind) => (kind === 'findOne' ? [{ id: 'run-1', tenant_id: 't' }] : []));
  const detail = await controlService().getRunDetail(context(busy.manager) as any, 'run-1');
  assert.equal(detail.run.id, 'run-1');
  assert.deepEqual(detail.run_steps, []);
  assert.deepEqual(detail.action_requests, []);
  assert.ok(busy.calls() >= 9);
  assert.equal(busy.maxBusy(), 1);
}

async function testHelpdeskEvaluationDailyIsSerial() {
  const sql = managerFor(() => []);
  const days = await controlService().getHelpdeskEvaluationDaily(context(sql.manager) as any, { days: 2 });
  assert.equal(days.days.length, 2);
  assert.equal(sql.calls(), 2);
  assert.equal(sql.maxBusy(), 1);

  const fallback = managerFor(() => [], { query: false });
  const fallbackDays = await controlService().getHelpdeskEvaluationDaily(context(fallback.manager) as any, { days: 2 });
  assert.equal(fallbackDays.days.length, 2);
  assert.equal(fallback.calls(), 2);
  assert.equal(fallback.maxBusy(), 1);
}

async function testTicketingReadTargetsAreSerial() {
  const busy = managerFor(() => []);
  const service = controlService({
    liveTargets: {
      findEnabledTargets: async (ctx: { manager: { query: (sql: string) => Promise<unknown> } }) => {
        await ctx.manager.query('SELECT targets');
        return [];
      },
    },
    providers: {
      getApplicability: async (ctx: { manager: { query: (sql: string) => Promise<unknown> } }) => {
        await ctx.manager.query('SELECT applicability');
        return { available: false, reasonCode: 'off', message: 'off' };
      },
    },
  });
  const result = await service.listTicketingReadTargets(context(busy.manager) as any, { provider_key: 'glpi' });
  assert.equal(result.ready, false);
  assert.equal(result.items.length, 0);
  assert.equal(busy.calls(), 2);
  assert.equal(busy.maxBusy(), 1);
}

async function testQueueOverviewReadsAreSerial() {
  const busy = managerFor(() => []);
  const service = controlService({
    agentQueue: {
      listOverview: async () => ({
        definitions: [],
        workItems: [{ id: 'w1', last_action_request_ids: ['a1'], last_run_id: 'r1' }],
        targetStates: [{ id: 's1', last_run_id: 'r2', state_json: { latest_action_request_ids: ['a2'] } }],
        counts: {},
        monitoringDiagnoses: [],
        helpdesk: { summary: null, summaries: [], fleet: null, auditEvents: [] },
      }),
    },
  });
  const overview = await service.getQueueOverview(context(busy.manager) as any);
  assert.equal(overview.work_items.length, 1);
  assert.equal(overview.cost.today_eur, 0);
  assert.ok(busy.calls() >= 3);
  assert.equal(busy.maxBusy(), 1);
}

async function testHelpdeskSummariesAreSerial() {
  const queue = Object.create(AiAgentWorkQueueService.prototype) as AiAgentWorkQueueService;
  const definitions = ['desk-a', 'desk-b'].map((agentKey) => ({
    id: agentKey,
    agent_key: agentKey,
    agent_type: 'helpdesk',
    queue_policy_json: {},
    trigger_policy_json: {},
    scope_policy_json: {},
    metadata_json: {},
  }));
  const track = busyTracker();
  let finds = 0;
  const manager = {
    getRepository: () => ({
      find: () => track.occupy(() => {
        finds += 1;
        return finds === 1 ? definitions : [];
      }),
      createQueryBuilder: () => queryBuilder(track.occupy, () => []),
    }),
  };
  const overview = await queue.listOverview(context(manager) as any, { limit: 10 });
  assert.equal(overview.helpdesk.summaries.length, 2);
  assert.equal(overview.helpdesk.summaries[0].agentDefinitionId, 'desk-a');
  assert.ok(track.calls() > 4);
  assert.equal(track.maxBusy(), 1);
}

async function testDocumentRelationTargetsAreSerial() {
  const track = busyTracker();
  const support = {
    resolveDocumentSnapshot: async () => ({
      document_id: randomUUID(),
      relations: {},
      target_ref: 'DOC-1',
      target_title: 'Runbook',
      revision: 1,
    }),
    assertUpdatePreviewAllowed: async () => undefined,
    assertRelationEditingAllowed: () => undefined,
    resolveRelationTargets: async () => {
      await track.occupy(async () => []);
      return {};
    },
    buildRelationMutation: () => ({ changedTypes: [], nextRelations: {}, nextRelationLabels: {}, currentRelationSnapshot: {} }),
  };
  const operation = new UpdateDocumentRelationsAiMutationOperation(support as any, {} as any);
  await assert.rejects(
    () => operation.prepareCreatePreview({ tenantId: randomUUID(), manager: {} } as any, { document_id: 'DOC-1' } as any),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(error.message, /already match/);
      return true;
    },
  );
  assert.equal(track.calls(), 2);
  assert.equal(track.maxBusy(), 1);
}

async function run() {
  await testCountAttentionIsSerial();
  await testListRunsIsSerialAcrossRuns();
  await testRunDetailIsSerial();
  await testHelpdeskEvaluationDailyIsSerial();
  await testTicketingReadTargetsAreSerial();
  await testQueueOverviewReadsAreSerial();
  await testHelpdeskSummariesAreSerial();
  await testDocumentRelationTargetsAreSerial();
  console.log('ai-agent-serial-queries: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
