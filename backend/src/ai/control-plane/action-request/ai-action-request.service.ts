import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationPreviewDto } from '../../ai.types';
import { EXECUTE_APPROVED_PREVIEW_CAPABILITY } from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiEvaluation } from '../entities/ai-evaluation.entity';
import { hashStableJson } from '../evidence/ai-evidence.service';
import { PolicyDecisionRecord } from '../policy/policy-decision.types';
import { isRecord } from '../../../common/object-guards';

const DEFAULT_PROVIDER_ACTION_TTL_MS = 30 * 60 * 1000;
const PROVIDER_ACTION_RETRYABLE_TERMINAL_STATUSES = new Set(['expired', 'failed', 'rejected', 'dismissed']);

export type ProviderActionRequestSeed = {
  runId?: string | null;
  toolExecutionId?: string | null;
  conversationId?: string | null;
  userId?: string | null;
  capabilityName: string;
  capabilityVersion: string;
  effect: string;
  providerKind: string;
  providerKey: string;
  targetType: string;
  targetId?: string | null;
  targetRef: string;
  actionPayload: Record<string, unknown>;
  idempotencyKey: string;
  evidenceIds?: string[] | null;
  inputSummary?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  expiresAt?: Date | null;
  retryAfterStatuses?: string[] | null;
};

function stringMetadata(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isUniqueViolation(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === '23505';
}

function providerActionRetryableStatuses(seed: ProviderActionRequestSeed): Set<string> {
  const statuses = new Set(PROVIDER_ACTION_RETRYABLE_TERMINAL_STATUSES);
  for (const status of seed.retryAfterStatuses ?? []) {
    if (typeof status === 'string' && status.trim().length > 0) {
      statuses.add(status.trim());
    }
  }
  return statuses;
}

function isRetryableTerminalProviderAction(action: AiActionRequest, seed: ProviderActionRequestSeed): boolean {
  return providerActionRetryableStatuses(seed).has(action.status);
}

function providerActionIsExpired(action: AiActionRequest, now = Date.now()): boolean {
  if (action.status !== 'pending' || !action.expires_at) {
    return false;
  }
  const expiresAt = action.expires_at instanceof Date
    ? action.expires_at.getTime()
    : Date.parse(String(action.expires_at));
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function isMutationPreviewDto(value: unknown): value is AiMutationPreviewDto {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.preview_id === 'string'
    && typeof candidate.tool_name === 'string'
    && typeof candidate.status === 'string'
    && candidate.target != null
    && candidate.changes != null;
}

export function mutationPreviewDtosFromCapabilityResult(result: unknown): AiMutationPreviewDto[] {
  if (isMutationPreviewDto(result)) {
    return [result];
  }
  if (!result || typeof result !== 'object') {
    return [];
  }
  const previews = (result as Record<string, unknown>).previews;
  return Array.isArray(previews) ? previews.filter(isMutationPreviewDto) : [];
}

const NESTED_PREVIEW_KEYS = ['results', 'followUpPreviews'] as const;

/**
 * Every preview card inside a capability result, including the execution
 * shape `{ results, followUpPreviews }`. Callers that show a card to the
 * user read this from the handler output before redaction.
 */
export function userFacingPreviewDtosFromCapabilityResult(result: unknown): AiMutationPreviewDto[] {
  const collected = mutationPreviewDtosFromCapabilityResult(result);
  if (!result || typeof result !== 'object') {
    return collected;
  }
  const record = result as Record<string, unknown>;
  const seen = new Set(collected.map((preview) => preview.preview_id));
  for (const key of NESTED_PREVIEW_KEYS) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (!isMutationPreviewDto(entry) || seen.has(entry.preview_id)) {
        continue;
      }
      seen.add(entry.preview_id);
      collected.push(entry);
    }
  }
  return collected;
}

@Injectable()
export class AiActionRequestService {
  constructor(
    @InjectRepository(AiActionRequest)
    private readonly actionRepo: Repository<AiActionRequest>,
    @InjectRepository(AiMutationPreview)
    private readonly previewRepo: Repository<AiMutationPreview>,
  ) {}

  private actionRepository(manager: EntityManager) {
    return manager.getRepository(AiActionRequest);
  }

  private previewRepository(manager: EntityManager) {
    return manager.getRepository(AiMutationPreview);
  }

  private evaluationRepository(manager: EntityManager) {
    return manager.getRepository(AiEvaluation);
  }

  inputHashForPreview(preview: Pick<AiMutationPreview, 'id' | 'tool_name' | 'mutation_input'>): string {
    return hashStableJson({
      preview_id: preview.id,
      tool_name: preview.tool_name,
      mutation_input: preview.mutation_input ?? {},
    });
  }

  inputHashForProviderAction(seed: Pick<ProviderActionRequestSeed, 'capabilityName' | 'capabilityVersion' | 'effect' | 'providerKind' | 'providerKey' | 'targetType' | 'targetId' | 'targetRef' | 'actionPayload' | 'idempotencyKey'>): string {
    return hashStableJson({
      capability_name: seed.capabilityName,
      capability_version: seed.capabilityVersion,
      effect: seed.effect,
      provider_kind: seed.providerKind,
      provider_key: seed.providerKey,
      target_type: seed.targetType,
      target_id: seed.targetId ?? null,
      target_ref: seed.targetRef,
      action_payload: seed.actionPayload,
      idempotency_key: seed.idempotencyKey,
    });
  }

  providerActionIdempotencyKey(input: {
    tenantId: string;
    providerKey: string;
    ticketId: string;
    noteBody: string;
    capabilityVersion: string;
  }): string {
    return hashStableJson({
      tenant_id: input.tenantId,
      provider_key: input.providerKey,
      ticket_id: input.ticketId,
      note_body: input.noteBody.replace(/\r\n/g, '\n').trim(),
      capability_version: input.capabilityVersion,
    });
  }

  providerActionInputHash(seed: Pick<ProviderActionRequestSeed, 'capabilityName' | 'capabilityVersion' | 'effect' | 'providerKind' | 'providerKey' | 'targetType' | 'targetId' | 'targetRef' | 'actionPayload' | 'idempotencyKey'>): string {
    return this.inputHashForProviderAction(seed);
  }

  private retryProviderActionSeed(seed: ProviderActionRequestSeed, previousAction: AiActionRequest): ProviderActionRequestSeed {
    return {
      ...seed,
      idempotencyKey: hashStableJson({
        original_idempotency_key: seed.idempotencyKey,
        retry_after_action_request_id: previousAction.id,
      }),
      metadata: {
        ...(seed.metadata ?? {}),
        retry_after_action_request_id: previousAction.id,
        retry_after_action_status: previousAction.status,
      },
    };
  }

  async getPreviewForAction(
    context: AiExecutionContextWithManager,
    previewId: string,
  ): Promise<AiMutationPreview> {
    const preview = await this.previewRepository(context.manager).findOne({
      where: {
        id: previewId,
        tenant_id: context.tenantId,
        user_id: context.userId,
      },
    });
    if (!preview) {
      throw new NotFoundException('AI mutation preview not found.');
    }
    if (context.conversationId && preview.conversation_id !== context.conversationId) {
      throw new NotFoundException('AI mutation preview not found for this conversation.');
    }
    return preview;
  }

  async ensureForPreview(
    context: AiExecutionContextWithManager,
    previewId: string,
    opts?: {
      runId?: string | null;
      toolExecutionId?: string | null;
      capabilityName?: string | null;
      capabilityVersion?: string | null;
      effect?: string | null;
      evidenceIds?: string[] | null;
    },
  ): Promise<AiActionRequest> {
    const preview = await this.getPreviewForAction(context, previewId);
    const repo = this.actionRepository(context.manager);
    const existing = await repo.findOne({
      where: {
        tenant_id: context.tenantId,
        preview_id: preview.id,
      },
    });
    if (existing) {
      let changed = false;
      if (opts?.runId && !existing.run_id) {
        existing.run_id = opts.runId;
        changed = true;
      }
      if (opts?.toolExecutionId && !existing.tool_execution_id) {
        existing.tool_execution_id = opts.toolExecutionId;
        changed = true;
      }
      if (opts?.evidenceIds?.length) {
        existing.evidence_ids = Array.from(new Set([...(existing.evidence_ids ?? []), ...opts.evidenceIds]));
        changed = true;
      }
      if (opts?.capabilityName && existing.capability_name !== opts.capabilityName) {
        existing.capability_name = opts.capabilityName;
        changed = true;
      }
      if (opts?.capabilityVersion && existing.capability_version !== opts.capabilityVersion) {
        existing.capability_version = opts.capabilityVersion;
        changed = true;
      }
      if (opts?.effect && existing.effect !== opts.effect) {
        existing.effect = opts.effect;
        changed = true;
      }
      if (changed) {
        existing.updated_at = new Date();
        return repo.save(existing);
      }
      return existing;
    }

    const action = repo.create({
      tenant_id: context.tenantId,
      run_id: opts?.runId ?? null,
      tool_execution_id: opts?.toolExecutionId ?? null,
      conversation_id: preview.conversation_id ?? context.conversationId ?? null,
      user_id: preview.user_id ?? context.userId,
      preview_id: preview.id,
      capability_name: opts?.capabilityName ?? EXECUTE_APPROVED_PREVIEW_CAPABILITY,
      capability_version: opts?.capabilityVersion ?? '1.0.0',
      effect: opts?.effect ?? 'write',
      status: preview.status === 'pending' ? 'pending' : preview.status,
      target_type: preview.target_entity_type ?? null,
      target_id: preview.target_entity_id ?? null,
      target_ref: preview.target_entity_id ?? null,
      idempotency_key: null,
      action_payload_json: null,
      provider_kind: null,
      provider_key: null,
      input_hash: this.inputHashForPreview(preview),
      input_summary: {
        preview_id: preview.id,
        tool_name: preview.tool_name,
        target_entity_type: preview.target_entity_type,
        target_entity_id: preview.target_entity_id,
      },
      evidence_ids: opts?.evidenceIds ?? null,
      expires_at: preview.expires_at ?? null,
      approved_at: preview.approved_at ?? null,
      rejected_at: preview.rejected_at ?? null,
      executed_at: preview.executed_at ?? null,
      error_message: preview.error_message ?? null,
      metadata_json: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return repo.save(action);
  }

  async createOrEnsureProviderAction(
    context: AiExecutionContextWithManager,
    seed: ProviderActionRequestSeed,
  ): Promise<AiActionRequest> {
    if (!context.tenantId) {
      throw new ForbiddenException('Tenant context is required for provider action requests.');
    }
    const repo = this.actionRepository(context.manager);
    const findExisting = (candidate: ProviderActionRequestSeed) => repo.findOne({
      where: {
        tenant_id: context.tenantId,
        capability_name: candidate.capabilityName,
        capability_version: candidate.capabilityVersion,
        idempotency_key: candidate.idempotencyKey,
      },
    });
    const normalizeExpiredPending = async (action: AiActionRequest | null): Promise<AiActionRequest | null> => {
      if (!action || !providerActionIsExpired(action)) {
        return action;
      }
      action.status = 'expired';
      action.updated_at = new Date();
      return repo.save(action);
    };
    let candidateSeed = seed;
    let existing = await normalizeExpiredPending(await findExisting(candidateSeed));
    while (existing && isRetryableTerminalProviderAction(existing, candidateSeed)) {
      candidateSeed = this.retryProviderActionSeed(seed, existing);
      existing = await normalizeExpiredPending(await findExisting(candidateSeed));
    }
    if (existing) {
      return this.mergeExistingProviderAction(context, existing, candidateSeed);
    }

    const expiresAt = candidateSeed.expiresAt ?? new Date(Date.now() + DEFAULT_PROVIDER_ACTION_TTL_MS);
    const action = repo.create({
      tenant_id: context.tenantId,
      run_id: candidateSeed.runId ?? null,
      tool_execution_id: candidateSeed.toolExecutionId ?? null,
      conversation_id: candidateSeed.conversationId ?? context.conversationId ?? null,
      user_id: candidateSeed.userId ?? context.userId ?? null,
      preview_id: null,
      capability_name: candidateSeed.capabilityName,
      capability_version: candidateSeed.capabilityVersion,
      effect: candidateSeed.effect,
      status: 'pending',
      target_type: candidateSeed.targetType,
      target_id: candidateSeed.targetId ?? null,
      target_ref: candidateSeed.targetRef,
      idempotency_key: candidateSeed.idempotencyKey,
      action_payload_json: candidateSeed.actionPayload,
      provider_kind: candidateSeed.providerKind,
      provider_key: candidateSeed.providerKey,
      input_hash: this.inputHashForProviderAction(candidateSeed),
      input_summary: candidateSeed.inputSummary ?? {
        provider_kind: candidateSeed.providerKind,
        provider_key: candidateSeed.providerKey,
        target_type: candidateSeed.targetType,
        target_ref: candidateSeed.targetRef,
        effect: candidateSeed.effect,
      },
      evidence_ids: candidateSeed.evidenceIds ?? null,
      expires_at: expiresAt,
      approved_at: null,
      rejected_at: null,
      executed_at: null,
      error_message: null,
      metadata_json: candidateSeed.metadata ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    try {
      return await repo.save(action);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const concurrentExisting = await findExisting(candidateSeed);
      if (!concurrentExisting) {
        throw error;
      }
      return this.mergeExistingProviderAction(context, concurrentExisting, candidateSeed);
    }
  }

  private async mergeExistingProviderAction(
    context: AiExecutionContextWithManager,
    existing: AiActionRequest,
    seed: ProviderActionRequestSeed,
  ): Promise<AiActionRequest> {
    const expectedHash = this.inputHashForProviderAction({
      capabilityName: existing.capability_name,
      capabilityVersion: existing.capability_version,
      effect: existing.effect,
      providerKind: existing.provider_kind ?? '',
      providerKey: existing.provider_key ?? '',
      targetType: existing.target_type ?? '',
      targetId: existing.target_id ?? null,
      targetRef: existing.target_ref ?? '',
      actionPayload: existing.action_payload_json ?? {},
      idempotencyKey: existing.idempotency_key ?? '',
    });
    if (existing.input_hash !== expectedHash || expectedHash !== this.inputHashForProviderAction(seed)) {
      throw new BadRequestException('Existing provider action request failed input-hash verification.');
    }
    let changed = false;
    if (seed.runId && !existing.run_id) {
      existing.run_id = seed.runId;
      changed = true;
    }
    if (seed.toolExecutionId && !existing.tool_execution_id) {
      existing.tool_execution_id = seed.toolExecutionId;
      changed = true;
    }
    if (seed.evidenceIds?.length) {
      existing.evidence_ids = Array.from(new Set([...(existing.evidence_ids ?? []), ...seed.evidenceIds]));
      changed = true;
    }
    if (seed.metadata && Object.keys(seed.metadata).length > 0) {
      existing.metadata_json = {
        ...(existing.metadata_json ?? {}),
        ...seed.metadata,
      };
      changed = true;
    }
    if (!changed) {
      return existing;
    }
    existing.updated_at = new Date();
    return this.actionRepository(context.manager).save(existing);
  }

  async findProviderActionForExecution(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
  ): Promise<AiActionRequest> {
    const action = await this.actionRepository(context.manager).findOne({
      where: {
        id: actionRequestId,
        tenant_id: context.tenantId,
      },
    });
    if (!action) {
      throw new NotFoundException('AI action request not found.');
    }
    return action;
  }

  verifyProviderActionIntegrity(action: AiActionRequest): void {
    if (!action.idempotency_key || !action.provider_kind || !action.provider_key || !action.target_type || !action.target_ref || !action.action_payload_json) {
      throw new ForbiddenException('Provider action request is incomplete.');
    }
    const expectedHash = this.inputHashForProviderAction({
      capabilityName: action.capability_name,
      capabilityVersion: action.capability_version,
      effect: action.effect,
      providerKind: action.provider_kind,
      providerKey: action.provider_key,
      targetType: action.target_type,
      targetId: action.target_id,
      targetRef: action.target_ref,
      actionPayload: action.action_payload_json,
      idempotencyKey: action.idempotency_key,
    });
    if (expectedHash !== action.input_hash) {
      throw new ForbiddenException('Provider action request payload no longer matches its approval scope.');
    }
  }

  async addEvidenceIds(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    evidenceIds: string[],
  ): Promise<AiActionRequest | null> {
    if (evidenceIds.length === 0) {
      return null;
    }
    const repo = this.actionRepository(context.manager);
    const action = await repo.findOne({
      where: { id: actionRequestId, tenant_id: context.tenantId },
    });
    if (!action) {
      return null;
    }
    action.evidence_ids = Array.from(new Set([...(action.evidence_ids ?? []), ...evidenceIds]));
    action.updated_at = new Date();
    return repo.save(action);
  }

  async recordPolicyDecision(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    decision: PolicyDecisionRecord,
  ): Promise<AiActionRequest> {
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      policy_decision: decision as unknown as Record<string, unknown>,
    };
    action.updated_at = new Date();
    return this.actionRepository(context.manager).save(action);
  }

  async ensureForPreviewDtos(
    context: AiExecutionContextWithManager,
    previews: AiMutationPreviewDto[],
    opts?: {
      runId?: string | null;
      toolExecutionId?: string | null;
      capabilityName?: string | null;
      capabilityVersion?: string | null;
      effect?: string | null;
      evidenceIds?: string[] | null;
    },
  ): Promise<AiActionRequest[]> {
    const actions: AiActionRequest[] = [];
    for (const preview of previews) {
      actions.push(await this.ensureForPreview(context, preview.preview_id, opts));
    }
    return actions;
  }

  async markApproved(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    opts?: {
      expiresAt?: Date | null;
    },
  ): Promise<AiActionRequest> {
    action.status = 'approved';
    action.approved_at = new Date();
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'expiresAt')) {
      action.expires_at = opts.expiresAt ?? null;
    }
    action.updated_at = new Date();
    return this.actionRepository(context.manager).save(action);
  }

  async markExpired(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    reason = 'Action request expired before approval or execution.',
  ): Promise<AiActionRequest> {
    const repo = this.actionRepository(context.manager);
    action.status = 'expired';
    action.error_message = reason;
    action.updated_at = new Date();
    const saved = await repo.save(action);
    await this.updateLinkedEvaluation(context, saved, 'expired', saved.error_message);
    return saved;
  }

  async markRejected(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    reason?: string | null,
  ): Promise<AiActionRequest> {
    const repo = this.actionRepository(context.manager);
    action.status = 'rejected';
    action.rejected_at = new Date();
    action.error_message = reason ?? null;
    action.updated_at = new Date();
    const saved = await repo.save(action);
    await this.updateLinkedEvaluation(context, saved, 'rejected', reason ?? null);
    return saved;
  }

  async markDismissed(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    reason?: string | null,
  ): Promise<AiActionRequest> {
    const repo = this.actionRepository(context.manager);
    action.status = 'dismissed';
    action.error_message = reason ?? null;
    action.updated_at = new Date();
    const saved = await repo.save(action);
    await this.updateLinkedEvaluation(context, saved, 'dismissed', reason ?? null);
    return saved;
  }

  async markExecuted(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    status: string,
    errorMessage?: string | null,
  ): Promise<AiActionRequest> {
    const repo = this.actionRepository(context.manager);
    action.status = status;
    action.executed_at = status === 'executed' ? new Date() : action.executed_at;
    action.error_message = errorMessage ?? null;
    action.updated_at = new Date();
    const saved = await repo.save(action);
    await this.updateLinkedEvaluation(context, saved, status, errorMessage ?? null);
    return saved;
  }

  private async updateLinkedEvaluation(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    status: string,
    errorMessage: string | null,
  ): Promise<void> {
    const evaluationId = stringMetadata(action.metadata_json?.evaluation_id);
    if (!evaluationId) {
      return;
    }
    const repo = this.evaluationRepository(context.manager);
    const evaluation = await repo.findOne({
      where: {
        id: evaluationId,
        tenant_id: context.tenantId,
      },
    });
    if (!evaluation) {
      return;
    }
    evaluation.status = status === 'executed' || status === 'rejected' || status === 'expired' || status === 'dismissed' ? 'completed' : 'pending';
    evaluation.outcome = status === 'executed'
      ? 'provider_action_executed'
      : status === 'rejected'
        ? 'provider_action_rejected'
        : status === 'expired'
          ? 'provider_action_expired_unreviewed'
          : status === 'dismissed'
            ? 'provider_action_dismissed'
            : status === 'failed'
              ? 'provider_action_failed'
              : evaluation.outcome;
    evaluation.feedback_json = {
      ...(isRecord(evaluation.feedback_json) ? evaluation.feedback_json : {}),
      provider_action: {
        action_request_id: action.id,
        status,
        error_message: errorMessage,
        executed_at: action.executed_at?.toISOString?.() ?? null,
        result: isRecord(action.metadata_json?.provider_result) ? action.metadata_json.provider_result : null,
      },
    };
    evaluation.updated_at = new Date();
    await repo.save(evaluation);
  }
}
