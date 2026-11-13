import { In } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { agentActionWhere } from '../action-request/ai-action-request.service';
import { AiAgentWorkItem } from '../entities/ai-agent-work-item.entity';

/**
 * Server-side definition of a "Needs attention" row, mirroring the operator UI
 * predicate (`actionNeedsAttention` / `workItemNeedsAttention` in the frontend)
 * for terminal outcomes only: expired, failed, or dead-lettered proposals that
 * carry an explanation, and failed or dead-lettered checks. Rows already
 * acknowledged carry `metadata_json.attention_acknowledged` and are excluded.
 *
 * Approved proposals with a transient execution error are deliberately left
 * out: they are still being retried and must not be hidden in bulk.
 */
type Manager = AiExecutionContextWithManager['manager'];

export type AttentionScope = { agentDefinitionId?: string | null };

export type AttentionSummary = { actions: number; work_items: number; total: number };

export type AttentionStampInput = AttentionScope & {
  userId: string | null;
  reason?: string | null;
};

const ACTION_ATTENTION_STATUSES = ['expired', 'failed', 'dead_letter'];
const WORK_ITEM_ATTENTION_STATUSES = ['failed', 'dead_letter'];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAcknowledged(metadata: Record<string, unknown>): boolean {
  return Object.keys(record(metadata.attention_acknowledged)).length > 0;
}

export function actionRowNeedsAttention(action: Pick<AiActionRequest, 'status' | 'error_message' | 'metadata_json'>): boolean {
  if (!ACTION_ATTENTION_STATUSES.includes(action.status)) {
    return false;
  }
  const metadata = record(action.metadata_json);
  if (isAcknowledged(metadata)) {
    return false;
  }
  const batch = record(metadata.approved_batch_context);
  return nonEmpty(action.error_message)
    || nonEmpty(batch.dead_letter_reason)
    || nonEmpty(batch.last_execution_error)
    || nonEmpty(metadata.last_execution_error);
}

export function workItemRowNeedsAttention(workItem: Pick<AiAgentWorkItem, 'status' | 'metadata_json'>): boolean {
  return WORK_ITEM_ATTENTION_STATUSES.includes(workItem.status) && !isAcknowledged(record(workItem.metadata_json));
}

function actionInScope(action: Pick<AiActionRequest, 'metadata_json'>, scope: AttentionScope): boolean {
  return !scope.agentDefinitionId || record(action.metadata_json).agent_definition_id === scope.agentDefinitionId;
}

async function attentionActions(manager: Manager, tenantId: string, scope: AttentionScope): Promise<AiActionRequest[]> {
  const rows = await manager.getRepository(AiActionRequest).find({
    where: { tenant_id: tenantId, status: In(ACTION_ATTENTION_STATUSES), ...agentActionWhere() },
  });
  return rows.filter((action) => actionInScope(action, scope) && actionRowNeedsAttention(action));
}

async function attentionWorkItems(manager: Manager, tenantId: string, scope: AttentionScope): Promise<AiAgentWorkItem[]> {
  const rows = await manager.getRepository(AiAgentWorkItem).find({
    where: scope.agentDefinitionId
      ? { tenant_id: tenantId, status: In(WORK_ITEM_ATTENTION_STATUSES), agent_definition_id: scope.agentDefinitionId }
      : { tenant_id: tenantId, status: In(WORK_ITEM_ATTENTION_STATUSES) },
  });
  return rows.filter(workItemRowNeedsAttention);
}

export async function countAttention(manager: Manager, tenantId: string, scope: AttentionScope = {}): Promise<AttentionSummary> {
  // One after the other: the request's single connection runs its queries in turn anyway.
  const actions = await attentionActions(manager, tenantId, scope);
  const workItems = await attentionWorkItems(manager, tenantId, scope);
  return { actions: actions.length, work_items: workItems.length, total: actions.length + workItems.length };
}

/**
 * Stamp every row that needs attention as acknowledged. The stamp has the same
 * shape as the single-row acknowledgement (`{ at, user_id }`), plus an optional
 * `reason` for system-initiated stamps (e.g. the agent was deleted).
 */
export async function stampAttentionAcknowledged(
  manager: Manager,
  tenantId: string,
  input: AttentionStampInput,
): Promise<{ action_ids: string[]; work_item_ids: string[] }> {
  const stampedAt = new Date();
  const stamp: Record<string, unknown> = {
    at: stampedAt.toISOString(),
    user_id: input.userId || null,
  };
  if (input.reason) {
    stamp.reason = input.reason;
  }

  const actionRepo = manager.getRepository(AiActionRequest);
  const actions = await attentionActions(manager, tenantId, input);
  for (const action of actions) {
    action.metadata_json = { ...record(action.metadata_json), attention_acknowledged: { ...stamp } } as any;
    action.updated_at = stampedAt;
    await actionRepo.save(action);
  }

  const workItemRepo = manager.getRepository(AiAgentWorkItem);
  const workItems = await attentionWorkItems(manager, tenantId, input);
  for (const workItem of workItems) {
    workItem.metadata_json = { ...record(workItem.metadata_json), attention_acknowledged: { ...stamp } } as any;
    workItem.updated_at = stampedAt;
    await workItemRepo.save(workItem);
  }

  return {
    action_ids: actions.map((action) => action.id),
    work_item_ids: workItems.map((workItem) => workItem.id),
  };
}
