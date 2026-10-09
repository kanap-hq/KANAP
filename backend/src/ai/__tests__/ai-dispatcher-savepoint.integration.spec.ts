import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { AiExecutionContextWithManager } from '../ai.types';
import { CapabilityContract, CapabilityContractSchema } from '../control-plane/capability/capability-contract';
import { AiCapabilityDispatcherService } from '../control-plane/dispatcher/ai-capability-dispatcher.service';
import { AiEvidenceService } from '../control-plane/evidence/ai-evidence.service';
import {
  assert,
  inRolledBackTransaction,
  runSpecs,
  seedItem,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// A capability whose SQL fails must not poison the transaction it shares with the
// dispatcher's bookkeeping and with the next capabilities. Replays the 2026-10-09
// chat turn: the OPEX detail looked up `OPX-3` where a uuid was expected, Postgres
// aborted the transaction, the failure bookkeeping then failed with "current
// transaction is aborted" and that message reached the model instead of the real
// error. The dispatcher now runs each handler under its own savepoint.
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.

const BROKEN = 'spec.opex.rename_then_lookup_by_raw_ref';
const LOOKUP = 'spec.opex.lookup_by_ref';
const ITEM_NAME = 'SAP BW/4HANA License';

function contract(name: string): CapabilityContract {
  return CapabilityContractSchema.parse({
    name,
    version: '1.0.0',
    description: 'Spec capability.',
    category: 'discovery',
    provider_kind: 'kanap_domain',
    supported_surfaces: ['chat', 'internal'],
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    effect: 'read',
    risk_level: 'low',
    max_autonomy_level: 'A1',
    default_approval: 'none',
    evidence: { persist_input: false, persist_output: true, redact_fields: [], retention: 'standard' },
    tenant_permissions: ['ai.surface'],
    business_resources: [],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['ref'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: true },
    live_test_safety: 'live_read',
    compatibility: {},
  });
}

type Handler = (context: AiExecutionContextWithManager, input: any) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  // Writes, then runs the incident's query with a raw reference in a uuid array.
  [BROKEN]: async (context, input) => {
    await context.manager.query(
      `UPDATE spend_items SET product_name = 'Renamed by the failed tool' WHERE tenant_id = $1 AND item_number = 3`,
      [context.tenantId],
    );
    return context.manager.query(
      `SELECT i.id FROM spend_items i WHERE i.tenant_id = $1 AND i.id = ANY($2)`,
      [context.tenantId, [input.ref]],
    );
  },
  [LOOKUP]: async (context, input) => {
    const itemNumber = Number(String(input.ref).replace(/^OPX-/i, ''));
    const items = await context.manager.query(
      `SELECT id, product_name FROM spend_items WHERE tenant_id = $1 AND item_number = $2`,
      [context.tenantId, itemNumber],
    );
    return { items };
  },
};

function dispatcher(): AiCapabilityDispatcherService {
  return new AiCapabilityDispatcherService(
    {} as any,
    {} as any,
    {} as any,
    { resolve: async (_context: unknown, name: string) => ({ contract: contract(name), handler: handlers[name] }) } as any,
    new AiEvidenceService({} as any),
    { assertNotPaused: async () => undefined } as any,
    {} as any,
    {} as any,
  );
}

function context(runner: QueryRunner, tenantId: string): AiExecutionContextWithManager {
  return {
    tenantId,
    userId: null as any,
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    manager: runner.manager,
  } as AiExecutionContextWithManager;
}

// An agent runs several capabilities in one transaction, as the chat runs the
// handler and the bookkeeping of one tool call in one transaction.
async function testFailedSqlLeavesTheTransactionUsable() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'ai-dispatch-sp');
    const itemId = await seedItem(runner, 'opex', tenantId, 3, ITEM_NAME);
    const ctx = context(runner, tenantId);
    const service = dispatcher();
    const execution = { surface: 'internal', trigger_kind: 'internal' } as const;

    await assert.rejects(
      service.execute(ctx, { capabilityName: BROKEN, input: { ref: 'OPX-3' }, execution: { ...execution, stepIndex: 1 } }),
      (err: any) => err?.code === '22P02' && /invalid input syntax for type uuid/.test(err.message),
      'the caller gets the database error of the tool, not "current transaction is aborted"',
    );

    const [run] = await runner.query(`SELECT id, status FROM ai_runs WHERE tenant_id = $1`, [tenantId]);
    assert.equal(run?.status, 'failed', 'the failed run is recorded');

    const second: any = await service.execute(ctx, {
      capabilityName: LOOKUP,
      input: { ref: 'OPX-3' },
      execution: { ...execution, runId: run.id, stepIndex: 2 },
    });
    assert.deepEqual(
      second.output.items,
      [{ id: itemId, product_name: ITEM_NAME }],
      'the next capability runs, and the failed tool\'s write is undone',
    );

    const executions = await runner.query(
      `SELECT capability_name, status, error_message FROM ai_tool_executions WHERE tenant_id = $1 ORDER BY capability_name`,
      [tenantId],
    );
    assert.deepEqual(executions.map((row: any) => [row.capability_name, row.status]), [
      [LOOKUP, 'completed'],
      [BROKEN, 'failed'],
    ]);
    assert.match(executions[1].error_message, /invalid input syntax for type uuid/);
    const [evidence] = await runner.query(
      `SELECT count(*)::int AS n FROM ai_evidence WHERE tenant_id = $1 AND tool_execution_id = $2`,
      [tenantId, second.tool_execution_id],
    );
    assert.equal(evidence.n, 1, 'the evidence of the successful capability is written');

    const [setting] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS tenant`);
    assert.equal(setting.tenant, tenantId, 'the tenant context survives the rollback');
  });
}

runSpecs('ai-dispatcher-savepoint.integration.spec', [
  ['a failed SQL statement in a capability leaves the transaction usable', testFailedSqlLeavesTheTransactionUsable],
]);
