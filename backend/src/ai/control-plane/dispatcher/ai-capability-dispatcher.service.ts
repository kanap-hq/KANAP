import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  AiActionRequestService,
  mutationPreviewDtosFromCapabilityResult,
} from '../action-request/ai-action-request.service';
import { AiApprovalService } from '../approval/ai-approval.service';
import { AiCapabilityRegistry } from '../capability/ai-capability.registry';
import {
  CapabilityContract,
  CapabilityExecutionContext,
  CapabilityExecutionResult,
  CapabilitySurface,
  EXECUTE_APPROVED_PREVIEW_CAPABILITY,
} from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiApproval } from '../entities/ai-approval.entity';
import { AiRun } from '../entities/ai-run.entity';
import { AiRunStep } from '../entities/ai-run-step.entity';
import { AiToolExecution } from '../entities/ai-tool-execution.entity';
import { AiEvidenceService } from '../evidence/ai-evidence.service';
import { AiEmergencyPauseService } from '../pause/ai-emergency-pause.service';
import { AdapterEvidenceSeed } from '../providers/provider.types';
import { isRecord } from '../../../common/object-guards';
import { withSavepoint } from '../../../common/savepoint.util';

type DispatchInput = {
  capabilityName: string;
  capabilityVersion?: string | null;
  input: unknown;
  execution?: Partial<CapabilityExecutionContext> | null;
};

type ApprovalGateResult = {
  actionRequests: AiActionRequest[];
  approvals: AiApproval[];
};

function isKnownSurface(value: unknown): value is CapabilitySurface {
  return value === 'chat'
    || value === 'mcp'
    || value === 'scheduler'
    || value === 'alert'
    || value === 'internal';
}

function toOutputStatus(output: unknown): string {
  if (isAdapterFailure(output)) {
    return 'provider_error';
  }
  if (!output || typeof output !== 'object') {
    return 'completed';
  }
  if (Object.prototype.hasOwnProperty.call(output, 'error')) {
    return 'failed';
  }
  return 'completed';
}

function isAdapterFailure(value: unknown): value is {
  ok: false;
  errorCode: string;
  message: string;
  retryable: boolean;
  providerRequestId?: string | null;
  evidence?: AdapterEvidenceSeed[];
} {
  if (!isRecord(value)) {
    return false;
  }
  return value.ok === false
    && typeof value.errorCode === 'string'
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean';
}

function adapterEvidenceSeeds(value: unknown): AdapterEvidenceSeed[] {
  if (!isRecord(value) || !Array.isArray(value.evidence)) {
    return [];
  }
  return value.evidence.filter((seed): seed is AdapterEvidenceSeed => {
    if (!isRecord(seed)) {
      return false;
    }
    return typeof seed.sourceProvider === 'string'
      && typeof seed.sourceType === 'string'
      && typeof seed.collectedAt === 'string'
      && typeof seed.trustLevel === 'string'
      && typeof seed.summary === 'string';
  });
}

function actionRequestIdsFromProviderOutput(value: unknown): string[] {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
    return [];
  }
  const ids = new Set<string>();
  const direct = value.data.action_request_id;
  if (typeof direct === 'string' && direct.length > 0) {
    ids.add(direct);
  }
  const nested = value.data.actionRequest;
  if (isRecord(nested) && typeof nested.id === 'string' && nested.id.length > 0) {
    ids.add(nested.id);
  }
  return Array.from(ids);
}

function providerErrorMetadata(output: unknown): Record<string, unknown> | null {
  if (!isAdapterFailure(output)) {
    return null;
  }
  return {
    error_code: output.errorCode,
    message: output.message,
    retryable: output.retryable,
    provider_request_id: output.providerRequestId ?? null,
  };
}

function aggregateRunStatus(current: string, next: string): string {
  if (current === 'failed' || next === 'failed') {
    return 'failed';
  }
  if (current === 'provider_error' || next === 'provider_error') {
    return 'provider_error';
  }
  return next;
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringMetadata(value: Record<string, unknown> | null, key: string): string | null {
  const raw = value?.[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

@Injectable()
export class AiCapabilityDispatcherService {
  private readonly ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    strict: false,
    validateSchema: false,
  });
  private readonly inputValidators = new Map<string, ValidateFunction>();

  constructor(
    @InjectRepository(AiRun)
    private readonly runRepo: Repository<AiRun>,
    @InjectRepository(AiRunStep)
    private readonly stepRepo: Repository<AiRunStep>,
    @InjectRepository(AiToolExecution)
    private readonly toolExecutionRepo: Repository<AiToolExecution>,
    private readonly registry: AiCapabilityRegistry,
    private readonly evidence: AiEvidenceService,
    private readonly pause: AiEmergencyPauseService,
    private readonly actions: AiActionRequestService,
    private readonly approvals: AiApprovalService,
  ) {
    addFormats(this.ajv);
  }

  private runRepository(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiRun);
  }

  private stepRepository(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiRunStep);
  }

  private toolRepository(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiToolExecution);
  }

  private resolveSurface(context: AiExecutionContextWithManager, execution?: Partial<CapabilityExecutionContext> | null): CapabilitySurface {
    if (isKnownSurface(execution?.surface)) {
      return execution.surface;
    }
    if (isKnownSurface(context.surface)) {
      return context.surface;
    }
    throw new BadRequestException('Unsupported capability surface.');
  }

  private validatorFor(contract: CapabilityContract): ValidateFunction {
    const cacheKey = `${contract.name}:${contract.version}:${JSON.stringify(contract.input_schema)}`;
    const existing = this.inputValidators.get(cacheKey);
    if (existing) {
      return existing;
    }
    const validator = this.ajv.compile(contract.input_schema);
    this.inputValidators.set(cacheKey, validator);
    return validator;
  }

  private formatValidationErrors(errors: ErrorObject[] | null | undefined): string[] {
    return (errors ?? []).map((error) => {
      const path = error.instancePath || '/';
      return `${path} ${error.message ?? 'is invalid'}`.trim();
    });
  }

  private validateCapabilityInput(contract: CapabilityContract, value: unknown): void {
    const validator = this.validatorFor(contract);
    if (validator(value)) {
      return;
    }
    throw new BadRequestException({
      message: 'Capability input validation failed.',
      errors: this.formatValidationErrors(validator.errors),
    });
  }

  private executionMetadata(
    context: AiExecutionContextWithManager,
    execution: Partial<CapabilityExecutionContext> | null | undefined,
    surface: CapabilitySurface,
  ): Record<string, unknown> | null {
    const metadata = asMetadata(execution?.metadata);
    if (surface === 'mcp') {
      metadata.ai_api_key_id = context.aiApiKeyId ?? null;
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  private requiresApproval(contract: CapabilityContract): boolean {
    return contract.effect === 'write'
      || contract.effect === 'remediate'
      || contract.default_approval !== 'none';
  }

  private extractPreviewIds(input: unknown, field: string): string[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ForbiddenException('Capability approval strategy could not resolve action requests.');
    }
    const value = (input as Record<string, unknown>)[field];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new ForbiddenException('Capability approval strategy could not resolve action requests.');
    }
    return value;
  }

  private extractActionRequestId(input: unknown, field: string): string {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ForbiddenException('Capability approval strategy could not resolve action request.');
    }
    const value = (input as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ForbiddenException('Capability approval strategy could not resolve action request.');
    }
    return value.trim();
  }

  private async enforceApprovalGate(
    context: AiExecutionContextWithManager,
    contract: CapabilityContract,
    input: unknown,
    run: AiRun,
    toolExecution: AiToolExecution,
    execution: Partial<CapabilityExecutionContext>,
  ): Promise<ApprovalGateResult> {
    if (!this.requiresApproval(contract)) {
      return { actionRequests: [], approvals: [] };
    }

    if (contract.approval_strategy.mode === 'action_request') {
      const actionRequestId = this.extractActionRequestId(input, contract.approval_strategy.action_request_id_input_field);
      const action = await this.actions.findProviderActionForExecution(context, actionRequestId);
      if (
        action.capability_name !== contract.name
        || action.capability_version !== contract.version
        || action.effect !== contract.effect
      ) {
        throw new ForbiddenException('Action request does not match the executing capability.');
      }
      this.actions.verifyProviderActionIntegrity(action);
      const approval = await this.approvals.resolveApprovedActionForExecution(context, action, contract, execution);
      return { actionRequests: [action], approvals: [approval] };
    }

    if (contract.approval_strategy.mode !== 'mutation_preview') {
      throw new ForbiddenException('Capability requires an explicit approval strategy before execution.');
    }

    const actionRequests: AiActionRequest[] = [];
    const approvals: AiApproval[] = [];
    const previewIds = this.extractPreviewIds(input, contract.approval_strategy.preview_id_input_field);
    for (const previewId of previewIds) {
      const action = await this.actions.ensureForPreview(context, previewId, {
        runId: run.id,
        toolExecutionId: toolExecution.id,
        capabilityName: contract.name,
        capabilityVersion: contract.version,
        effect: contract.effect,
      });
      const approval = await this.approvals.resolveApprovedAction(context, action);
      actionRequests.push(action);
      approvals.push(approval);
    }
    return { actionRequests, approvals };
  }

  private applyApprovalGateMetadata(
    toolExecution: AiToolExecution,
    gate: ApprovalGateResult,
  ): void {
    if (gate.actionRequests.length === 0 && gate.approvals.length === 0) {
      return;
    }
    toolExecution.action_request_id = gate.actionRequests[0]?.id ?? null;
    toolExecution.approval_id = gate.approvals[0]?.id ?? null;
    toolExecution.metadata_json = {
      ...asMetadata(toolExecution.metadata_json),
      approval_gate: {
        action_request_ids: gate.actionRequests.map((action) => action.id),
        approval_ids: gate.approvals.map((approval) => approval.id),
        preview_ids: gate.actionRequests
          .map((action) => action.preview_id)
          .filter((previewId): previewId is string => typeof previewId === 'string' && previewId.length > 0),
      },
    };
  }

  private async createOrLoadRun(
    context: AiExecutionContextWithManager,
    input: DispatchInput,
    surface: CapabilitySurface,
  ): Promise<AiRun> {
    const requestedRunId = input.execution?.runId ?? null;
    const repo = this.runRepository(context);
    if (requestedRunId) {
      const existing = await repo.findOne({
        where: { id: requestedRunId, tenant_id: context.tenantId },
      });
      if (!existing) {
        throw new BadRequestException('Unknown AI run.');
      }
      return existing;
    }

    const summary = this.evidence.summarize(input.input);
    const metadata = this.executionMetadata(context, input.execution, surface);
    return repo.save(repo.create({
      tenant_id: context.tenantId,
      user_id: context.userId || null,
      conversation_id: context.conversationId ?? null,
      request_id: context.requestId ?? null,
      ai_api_key_id: context.aiApiKeyId ?? null,
      invocation_channel: surface,
      trigger_kind: input.execution?.trigger_kind ?? (surface === 'mcp' ? 'mcp_client' : surface === 'internal' ? 'internal' : 'human_user'),
      status: 'running',
      input_summary: summary,
      output_summary: null,
      usage_json: null,
      cost_json: null,
      metadata_json: metadata,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    }));
  }

  async execute<T = unknown>(
    context: AiExecutionContextWithManager,
    input: DispatchInput,
  ): Promise<CapabilityExecutionResult<T>> {
    if (!context.tenantId) {
      throw new ForbiddenException('Tenant context is required for capability execution.');
    }

    const surface = this.resolveSurface(context, input.execution);
    const run = await this.createOrLoadRun(context, input, surface);
    let resolved;
    try {
      resolved = await this.registry.resolve(
        context,
        input.capabilityName,
        input.capabilityVersion ?? undefined,
        surface,
      );
    } catch (error: any) {
      run.status = 'failed';
      run.output_summary = { error: error?.message || 'Capability resolution failed.' };
      run.completed_at = new Date();
      run.updated_at = new Date();
      await this.runRepository(context).save(run);
      throw error;
    }
    const { contract, handler } = resolved;
    const metadata = this.executionMetadata(context, input.execution, surface);

    const startedAt = Date.now();
    const stepRepo = this.stepRepository(context);
    const toolRepo = this.toolRepository(context);
    const inputSummary = this.evidence.summarize(input.input);
    const inputHash = this.evidence.hash(input.input);
    const step = await stepRepo.save(stepRepo.create({
      tenant_id: context.tenantId,
      run_id: run.id,
      step_index: input.execution?.stepIndex ?? 1,
      kind: 'tool',
      status: 'running',
      capability_name: contract.name,
      capability_version: contract.version,
      input_summary: inputSummary,
      output_summary: null,
      error_message: null,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
    }));
    const toolExecution = await toolRepo.save(toolRepo.create({
      tenant_id: context.tenantId,
      run_id: run.id,
      step_id: step.id,
      action_request_id: null,
      approval_id: null,
      capability_name: contract.name,
      capability_version: contract.version,
      surface,
      effect: contract.effect,
      status: 'running',
      input_hash: inputHash,
      input_summary: inputSummary,
      output_summary: null,
      error_message: null,
      duration_ms: null,
      usage_json: null,
      cost_json: null,
      metadata_json: metadata,
      started_at: new Date(),
      completed_at: null,
      created_at: new Date(),
    }));

    try {
      if (!contract.supported_surfaces.includes(surface)) {
        throw new BadRequestException('Capability is not available on this surface.');
      }
      if (
        surface === 'mcp'
        && (
          contract.effect !== 'read'
          || contract.default_approval !== 'none'
          || !contract.mcp_exposure.enabled
          || !contract.mcp_exposure.read_only
        )
      ) {
        throw new BadRequestException('Capability is not exposed through MCP.');
      }
      this.validateCapabilityInput(contract, input.input);
      const agentDefinitionId = stringMetadata(metadata, 'agent_definition_id');
      await this.pause.assertNotPaused(context, contract, { agentDefinitionId });

      const handlerExecution = {
        runId: run.id,
        toolExecutionId: toolExecution.id,
        stepIndex: step.step_index,
        surface,
        trigger_kind: input.execution?.trigger_kind ?? (surface === 'mcp' ? 'mcp_client' : surface === 'internal' ? 'internal' : 'human_user'),
        idempotency_key: input.execution?.idempotency_key ?? null,
        metadata,
      };
      const approvalGate = await this.enforceApprovalGate(context, contract, input.input, run, toolExecution, handlerExecution);
      this.applyApprovalGateMetadata(toolExecution, approvalGate);
      if (toolExecution.action_request_id || toolExecution.approval_id) {
        await toolRepo.save(toolExecution);
      }
      await this.pause.assertNotPaused(context, contract, { agentDefinitionId });

      // The handler runs under its own savepoint. When one of its statements fails, Postgres
      // refuses every later statement of the transaction: the rollback to the savepoint undoes
      // the handler's work only, so the failure bookkeeping below and the caller's next
      // capabilities in the same transaction still run. The tenant context set before stays.
      const rawOutput = await withSavepoint(context.manager, () => handler(context, input.input, handlerExecution));
      const output = this.evidence.redact(rawOutput, contract.redaction_policy.fields) as T;
      const outputSummary = this.evidence.summarize(output);
      const status = toOutputStatus(output);
      const providerError = providerErrorMetadata(output);
      const outputActionRequestIds = actionRequestIdsFromProviderOutput(output);
      const evidenceIds: string[] = [];
      if (contract.evidence.persist_output) {
        const adapterSeeds = adapterEvidenceSeeds(rawOutput);
        if (adapterSeeds.length > 0) {
          const evidenceRows = await this.evidence.recordAdapterEvidenceSeeds(context, adapterSeeds, {
            runId: run.id,
            toolExecutionId: toolExecution.id,
            actionRequestId: toolExecution.action_request_id ?? outputActionRequestIds[0] ?? null,
            retentionClass: contract.evidence.retention,
            redactFields: contract.evidence.redact_fields,
          });
          evidenceIds.push(...evidenceRows.map((evidence) => evidence.id));
        } else {
          const evidence = await this.evidence.recordEvidence(context, {
            runId: run.id,
            toolExecutionId: toolExecution.id,
            sourceProvider: contract.provider_kind,
            sourceObjectType: contract.name,
            sourceObjectId: contract.compatibility.ai_tool_name ?? contract.name,
            trustLevel: contract.provider_kind === 'kanap_domain' ? 'system' : 'external',
            summary: String(outputSummary.summary ?? ''),
            payload: output,
            actionRequestId: toolExecution.action_request_id ?? outputActionRequestIds[0] ?? null,
            retentionClass: contract.evidence.retention,
            redactFields: contract.evidence.redact_fields,
          });
          evidenceIds.push(evidence.id);
        }
      }

      for (const actionRequestId of outputActionRequestIds) {
        await this.actions.addEvidenceIds(context, actionRequestId, evidenceIds);
      }

      let firstActionRequest: AiActionRequest | null = null;
      if (contract.effect === 'propose') {
        const previews = mutationPreviewDtosFromCapabilityResult(output);
        const actionRequests = await this.actions.ensureForPreviewDtos(context, previews, {
          runId: run.id,
          toolExecutionId: toolExecution.id,
          capabilityName: EXECUTE_APPROVED_PREVIEW_CAPABILITY,
          capabilityVersion: '1.0.0',
          effect: 'write',
          evidenceIds,
        });
        firstActionRequest = actionRequests[0] ?? null;
      }

      toolExecution.status = status;
      toolExecution.output_summary = outputSummary;
      toolExecution.error_message = providerError?.message as string | null ?? null;
      toolExecution.action_request_id = firstActionRequest?.id ?? toolExecution.action_request_id;
      toolExecution.metadata_json = {
        ...asMetadata(toolExecution.metadata_json),
        evidence_ids: evidenceIds,
        ...(providerError ? { provider_error: providerError } : {}),
      };
      toolExecution.duration_ms = Math.max(0, Date.now() - startedAt);
      toolExecution.completed_at = new Date();
      await toolRepo.save(toolExecution);

      step.status = status;
      step.output_summary = outputSummary;
      step.error_message = providerError?.message as string | null ?? null;
      step.completed_at = new Date();
      await stepRepo.save(step);

      run.status = aggregateRunStatus(run.status, status);
      run.output_summary = outputSummary;
      run.completed_at = new Date();
      run.updated_at = new Date();
      await this.runRepository(context).save(run);

      return {
        run_id: run.id,
        step_id: step.id,
        tool_execution_id: toolExecution.id,
        output,
      };
    } catch (error: any) {
      const message = error?.message || 'Capability execution failed.';
      toolExecution.status = 'failed';
      toolExecution.error_message = message;
      toolExecution.duration_ms = Math.max(0, Date.now() - startedAt);
      toolExecution.completed_at = new Date();
      await toolRepo.save(toolExecution);

      step.status = 'failed';
      step.error_message = message;
      step.completed_at = new Date();
      await stepRepo.save(step);

      run.status = 'failed';
      run.output_summary = { error: message };
      run.completed_at = new Date();
      run.updated_at = new Date();
      await this.runRepository(context).save(run);
      throw error;
    }
  }
}
