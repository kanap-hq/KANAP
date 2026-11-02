import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiActionRequestService } from '../action-request/ai-action-request.service';
import { CapabilityContract, CapabilityExecutionContext, EXECUTE_APPROVED_PREVIEW_CAPABILITY } from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiApproval } from '../entities/ai-approval.entity';
import { AiApprovalPolicyResolverService } from '../policy/ai-approval-policy-resolver.service';
import { PolicyDecisionRecord } from '../policy/policy-decision.types';
import { isRecord } from '../../../common/object-guards';
import { codedForbidden } from '../../../auth/module-right-required';

const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;
const DEFAULT_APPROVED_ACTION_EXECUTION_TTL_MS = 30 * 60 * 1000;
const APPROVED_ACTION_EXECUTING_STATUS = 'executing';

export type AiApprovalSource = 'human_chat' | 'human_ui' | 'teams' | 'policy' | 'system';

function approvalExpiryForAction(action: AiActionRequest, now = new Date()): Date {
  const minimum = new Date(now.getTime() + DEFAULT_APPROVED_ACTION_EXECUTION_TTL_MS);
  if (!action.expires_at) {
    return minimum;
  }
  const currentExpiry = action.expires_at instanceof Date
    ? action.expires_at
    : new Date(action.expires_at);
  return Number.isFinite(currentExpiry.getTime()) && currentExpiry > minimum
    ? currentExpiry
    : minimum;
}

function executionClaimId(action: AiActionRequest): string | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const batch = isRecord(metadata?.approved_batch_context) ? metadata.approved_batch_context : null;
  const value = batch?.execution_claim_id;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function executionMetadataClaimId(execution?: Partial<CapabilityExecutionContext> | null): string | null {
  const value = execution?.metadata?.action_execution_claim_id;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

@Injectable()
export class AiApprovalService {
  constructor(
    @InjectRepository(AiApproval)
    private readonly approvalRepo: Repository<AiApproval>,
    private readonly actions: AiActionRequestService,
    @Optional()
    private readonly policyResolver?: AiApprovalPolicyResolverService,
  ) {}

  private repo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiApproval);
  }

  private async findDurableApproval(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
  ): Promise<AiApproval> {
    const approval = await this.repo(context).findOne({
      where: {
        tenant_id: context.tenantId,
        action_request_id: action.id,
        capability_name: action.capability_name,
        capability_version: action.capability_version,
        input_hash: action.input_hash,
        status: 'approved',
        expires_at: MoreThan(new Date()),
      },
      order: { decided_at: 'DESC', created_at: 'DESC' },
    });
    if (!approval) {
      throw codedForbidden('AGENT_ACTION_APPROVAL_REQUIRED', 'A valid durable approval is required before execution.');
    }
    if (approval.action_request_id !== action.id || approval.input_hash !== action.input_hash) {
      throw codedForbidden('AGENT_ACTION_CHANGED', 'Approval does not match the action request scope.');
    }
    return approval;
  }

  async approvePreviewFromChat(
    context: AiExecutionContextWithManager,
    previewId: string,
    reason?: string | null,
  ): Promise<{ action: AiActionRequest; approval: AiApproval }> {
    const action = await this.actions.ensureForPreview(context, previewId, {
      capabilityName: EXECUTE_APPROVED_PREVIEW_CAPABILITY,
      capabilityVersion: '1.0.0',
      effect: 'write',
    });
    const expiresAt = approvalExpiryForAction(action);
    const approval = await this.repo(context).save(this.repo(context).create({
      tenant_id: context.tenantId,
      action_request_id: action.id,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      source: 'human_chat',
      status: 'approved',
      actor_user_id: context.userId,
      actor_label: null,
      input_hash: action.input_hash,
      evidence_ids: action.evidence_ids ?? null,
      reason: reason ?? null,
      matched_policy_id: null,
      matched_policy_version: null,
      decision_json: null,
      expires_at: expiresAt,
      decided_at: new Date(),
      created_at: new Date(),
    }));
    await this.actions.markApproved(context, action, { expiresAt });
    return { action, approval };
  }

  async rejectPreviewFromChat(
    context: AiExecutionContextWithManager,
    previewId: string,
    reason?: string | null,
  ): Promise<{ action: AiActionRequest; approval: AiApproval }> {
    const action = await this.actions.ensureForPreview(context, previewId, {
      capabilityName: EXECUTE_APPROVED_PREVIEW_CAPABILITY,
      capabilityVersion: '1.0.0',
      effect: 'write',
    });
    const approval = await this.repo(context).save(this.repo(context).create({
      tenant_id: context.tenantId,
      action_request_id: action.id,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      source: 'human_chat',
      status: 'rejected',
      actor_user_id: context.userId,
      actor_label: null,
      input_hash: action.input_hash,
      evidence_ids: action.evidence_ids ?? null,
      reason: reason ?? null,
      matched_policy_id: null,
      matched_policy_version: null,
      decision_json: null,
      expires_at: action.expires_at ?? new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS),
      decided_at: new Date(),
      created_at: new Date(),
    }));
    await this.actions.markRejected(context, action, reason ?? null);
    return { action, approval };
  }

  async approvePreviewsFromChat(
    context: AiExecutionContextWithManager,
    previewIds: string[],
  ): Promise<Array<{ action: AiActionRequest; approval: AiApproval }>> {
    const results: Array<{ action: AiActionRequest; approval: AiApproval }> = [];
    for (const previewId of previewIds) {
      results.push(await this.approvePreviewFromChat(context, previewId));
    }
    return results;
  }

  async rejectPreviewsFromChat(
    context: AiExecutionContextWithManager,
    previewIds: string[],
  ): Promise<Array<{ action: AiActionRequest; approval: AiApproval }>> {
    const results: Array<{ action: AiActionRequest; approval: AiApproval }> = [];
    for (const previewId of previewIds) {
      results.push(await this.rejectPreviewFromChat(context, previewId));
    }
    return results;
  }

  async approveActionRequest(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    opts?: {
      source?: AiApprovalSource;
      reason?: string | null;
      actorLabel?: string | null;
    },
  ): Promise<{ action: AiActionRequest; approval: AiApproval }> {
    const action = await this.actions.findProviderActionForExecution(context, actionRequestId);
    if (action.status === 'executed') {
      throw codedForbidden('AGENT_ACTION_ALREADY_EXECUTED', 'Executed action requests cannot be approved again.');
    }
    if (action.status === 'failed') {
      throw codedForbidden('AGENT_ACTION_FAILED', 'Failed action requests require a new approval cycle.');
    }
    if (action.status === 'rejected') {
      throw codedForbidden('AGENT_ACTION_REJECTED', 'Rejected action requests cannot be approved.');
    }
    if (action.status === 'dismissed') {
      throw codedForbidden('AGENT_ACTION_DISMISSED', 'Dismissed action requests cannot be approved.');
    }
    if (action.status === 'expired') {
      throw codedForbidden('AGENT_ACTION_EXPIRED', 'Expired action requests cannot be approved.');
    }
    if (action.expires_at && action.expires_at <= new Date()) {
      await this.actions.markExpired(context, action);
      throw codedForbidden('AGENT_ACTION_EXPIRED', 'Expired action requests cannot be approved.');
    }
    const expiresAt = approvalExpiryForAction(action);
    const approval = await this.repo(context).save(this.repo(context).create({
      tenant_id: context.tenantId,
      action_request_id: action.id,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      source: opts?.source ?? 'human_ui',
      status: 'approved',
      actor_user_id: context.userId,
      actor_label: opts?.actorLabel ?? null,
      input_hash: action.input_hash,
      evidence_ids: action.evidence_ids ?? null,
      reason: opts?.reason ?? null,
      matched_policy_id: null,
      matched_policy_version: null,
      decision_json: null,
      expires_at: expiresAt,
      decided_at: new Date(),
      created_at: new Date(),
    }));
    await this.actions.markApproved(context, action, { expiresAt });
    return { action, approval };
  }

  async rejectActionRequest(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    reason?: string | null,
  ): Promise<{ action: AiActionRequest; approval: AiApproval }> {
    const action = await this.actions.findProviderActionForExecution(context, actionRequestId);
    if (action.status !== 'pending' && action.status !== 'approved') {
      throw codedForbidden('AGENT_ACTION_NOT_PENDING', 'Only pending or approved action requests can be rejected.');
    }
    if (action.expires_at && action.expires_at <= new Date()) {
      await this.actions.markExpired(context, action);
      throw codedForbidden('AGENT_ACTION_EXPIRED', 'Expired action requests cannot be rejected.');
    }
    const approval = await this.repo(context).save(this.repo(context).create({
      tenant_id: context.tenantId,
      action_request_id: action.id,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      source: 'human_ui',
      status: 'rejected',
      actor_user_id: context.userId,
      actor_label: null,
      input_hash: action.input_hash,
      evidence_ids: action.evidence_ids ?? null,
      reason: reason ?? null,
      matched_policy_id: null,
      matched_policy_version: null,
      decision_json: null,
      expires_at: action.expires_at ?? new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS),
      decided_at: new Date(),
      created_at: new Date(),
    }));
    await this.actions.markRejected(context, action, reason ?? null);
    return { action, approval };
  }

  async dismissActionRequest(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    reason?: string | null,
  ): Promise<{ action: AiActionRequest; approval: AiApproval }> {
    const action = await this.actions.findProviderActionForExecution(context, actionRequestId);
    if (action.status !== 'pending' && action.status !== 'approved') {
      throw codedForbidden('AGENT_ACTION_NOT_PENDING', 'Only pending or approved action requests can be dismissed.');
    }
    if (action.expires_at && action.expires_at <= new Date()) {
      await this.actions.markExpired(context, action);
      throw codedForbidden('AGENT_ACTION_EXPIRED', 'Expired action requests cannot be dismissed.');
    }
    const approval = await this.repo(context).save(this.repo(context).create({
      tenant_id: context.tenantId,
      action_request_id: action.id,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      source: 'human_ui',
      status: 'dismissed',
      actor_user_id: context.userId,
      actor_label: null,
      input_hash: action.input_hash,
      evidence_ids: action.evidence_ids ?? null,
      reason: reason ?? null,
      matched_policy_id: null,
      matched_policy_version: null,
      decision_json: null,
      expires_at: action.expires_at ?? new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS),
      decided_at: new Date(),
      created_at: new Date(),
    }));
    await this.actions.markDismissed(context, action, reason ?? null);
    return { action, approval };
  }

  async resolveApprovedAction(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
  ): Promise<AiApproval> {
    if (action.tenant_id !== context.tenantId) {
      throw codedForbidden('AGENT_ACTION_NOT_FOUND', 'Approval does not belong to this tenant.');
    }
    if (action.status === 'rejected') {
      throw codedForbidden('AGENT_ACTION_REJECTED', 'Rejected action requests cannot be executed.');
    }
    if (action.status === 'dismissed') {
      throw codedForbidden('AGENT_ACTION_DISMISSED', 'Dismissed action requests cannot be executed.');
    }
    if (action.status === 'executed') {
      throw codedForbidden('AGENT_ACTION_ALREADY_EXECUTED', 'Action request has already been executed.');
    }
    if (action.status === 'failed') {
      throw codedForbidden('AGENT_ACTION_FAILED', 'Failed action requests require a new approval cycle.');
    }
    if (action.expires_at && action.expires_at <= new Date()) {
      await this.actions.markExpired(context, action);
      throw codedForbidden('AGENT_ACTION_EXPIRED', 'Action request approval has expired.');
    }
    if (action.status !== 'approved') {
      throw codedForbidden('AGENT_ACTION_APPROVAL_REQUIRED', 'Action request must be approved before execution.');
    }
    return this.findDurableApproval(context, action);
  }

  private async approveActionRequestByPolicy(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    decision: PolicyDecisionRecord,
  ): Promise<AiApproval> {
    const expiresAt = approvalExpiryForAction(action);
    const approval = await this.repo(context).save(this.repo(context).create({
      tenant_id: context.tenantId,
      action_request_id: action.id,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      source: 'policy',
      status: 'approved',
      actor_user_id: null,
      actor_label: decision.matched_policy_key ? `policy:${decision.matched_policy_key}` : 'policy',
      input_hash: action.input_hash,
      evidence_ids: action.evidence_ids ?? null,
      reason: 'Policy-approved controlled autonomy decision.',
      matched_policy_id: decision.matched_policy_id ?? null,
      matched_policy_version: decision.matched_policy_version ?? null,
      decision_json: decision as unknown as Record<string, unknown>,
      expires_at: expiresAt,
      decided_at: new Date(),
      created_at: new Date(),
    }));
    await this.actions.markApproved(context, action, { expiresAt });
    return approval;
  }

  async resolveApprovedActionForExecution(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    contract: CapabilityContract,
    execution?: Partial<CapabilityExecutionContext> | null,
  ): Promise<AiApproval> {
    try {
      return await this.resolveApprovedAction(context, action);
    } catch (error) {
      if (
        action.status === APPROVED_ACTION_EXECUTING_STATUS
        && executionClaimId(action)
        && executionClaimId(action) === executionMetadataClaimId(execution)
      ) {
        return this.findDurableApproval(context, action);
      }
      if (action.status !== 'pending' || !this.policyResolver) {
        throw error;
      }
    }

    const decision = await this.policyResolver.resolve(context, action, contract, execution);
    await this.actions.recordPolicyDecision(context, action, decision);
    if (decision.outcome !== 'policy_approved' || !decision.approved) {
      throw new ForbiddenException({
        code: decision.outcome === 'human_required' ? 'AGENT_ACTION_APPROVAL_REQUIRED' : 'AGENT_ACTION_POLICY_DENIED',
        message: decision.outcome === 'human_required'
          ? 'Human approval is required before execution.'
          : 'Policy approval denied.',
        decision,
      });
    }
    return this.approveActionRequestByPolicy(context, action, decision);
  }

  async expireStaleApprovals(context: AiExecutionContextWithManager): Promise<number> {
    const result = await this.repo(context).createQueryBuilder()
      .update(AiApproval)
      .set({ status: 'expired' })
      .where('tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('status = :status', { status: 'approved' })
      .andWhere('expires_at < now()')
      .execute();
    return result.affected ?? 0;
  }
}
