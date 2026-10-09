import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  AiBulkMutationExclusionDto,
  AiExecutionContextWithManager,
  AiMutationPlanDto,
  AiMutationPlanPrepareResultDto,
  AiMutationPlanStepDto,
  AiMutationPreviewDto,
  AiMutationWriteToolName,
} from './ai.types';
import { AiMutationPlan } from './ai-mutation-plan.entity';
import { AiMutationPlanStep } from './ai-mutation-plan-step.entity';
import { AiMutationPreview } from './ai-mutation-preview.entity';
import { AiPolicyService } from './ai-policy.service';
import { LEGACY_GLPI_TICKETING_PROVIDER_KEY } from './control-plane/providers/provider-constants';
import { AiMutationOperationRegistry } from './mutation/ai-mutation-operation.registry';
import { AiPreparedMutationPreview } from './mutation/ai-mutation-operation.types';
import { mapDatabaseError } from '../common/filters/database-error.mapping';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_CONVERSATION_PREVIEWS = 50;
const MAX_PENDING_CONVERSATION_PREVIEWS = 50;
const EXECUTION_SAVEPOINT_NAME = 'ai_mutation_preview_execution';
/** A preview whose data was held by another operation: nothing ran, it can be approved again. */
const PREVIEW_DATA_BUSY_MESSAGE =
  'The data this change writes was busy with another operation, so nothing was changed. Approve it again in a moment.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_-]+)\.(id|ref|title)\s*\}\}/g;

export type AiMutationPlanOperationInput = {
  operation_id?: string | null;
  label?: string | null;
  tool_name: string;
  input: Record<string, unknown>;
  depends_on?: string[];
};

export type AiMutationPlanInput = {
  summary?: string | null;
  operations: AiMutationPlanOperationInput[];
  target_set_label?: string | null;
  expected_target_refs?: string[];
  expected_target_count?: number | null;
  explicit_exclusions?: AiBulkMutationExclusionDto[];
};

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function cloneJsonRecord(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function normalizePlanOperationForCompatibility(
  toolName: string,
  input: Record<string, unknown>,
): { toolName: string; input: Record<string, unknown> } {
  if (toolName !== 'import_glpi_ticket') {
    return { toolName, input };
  }
  return {
    toolName: 'import_ticket',
    input: {
      ...input,
      provider_key: LEGACY_GLPI_TICKETING_PROVIDER_KEY,
    },
  };
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(object[key])}`,
  ).join(',')}}`;
}

function normalizeTargetRef(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeTargetRefs(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const ref = normalizeTargetRef(value);
    if (!ref || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function normalizeExplicitExclusions(values: unknown): AiBulkMutationExclusionDto[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const exclusions: AiBulkMutationExclusionDto[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const candidate = value as Record<string, unknown>;
    const ref = normalizeTargetRef(candidate.ref);
    const reason = String(candidate.reason ?? '').trim();
    if (!ref || !reason || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    exclusions.push({ ref, reason });
  }
  return exclusions;
}

function normalizeExpectedTargetCount(value: unknown, expectedRefs: string[]): number | null {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.max(Math.trunc(parsed), expectedRefs.length);
  }
  return expectedRefs.length > 0 ? expectedRefs.length : null;
}

function planStepTargetRef(step: AiMutationPlanStep): string | null {
  return normalizeTargetRef((step.input || {}).ref);
}

@Injectable()
export class AiMutationPreviewService {
  constructor(
    @InjectRepository(AiMutationPreview)
    private readonly previewRepo: Repository<AiMutationPreview>,
    @InjectRepository(AiMutationPlan)
    private readonly planRepo: Repository<AiMutationPlan>,
    @InjectRepository(AiMutationPlanStep)
    private readonly planStepRepo: Repository<AiMutationPlanStep>,
    private readonly policy: AiPolicyService,
    private readonly operations: AiMutationOperationRegistry,
  ) {}

  private getRepo(manager?: EntityManager) {
    return (manager ?? this.previewRepo.manager).getRepository(AiMutationPreview);
  }

  private getPlanRepo(manager?: EntityManager) {
    return (manager ?? this.planRepo.manager).getRepository(AiMutationPlan);
  }

  private getPlanStepRepo(manager?: EntityManager) {
    return (manager ?? this.planStepRepo.manager).getRepository(AiMutationPlanStep);
  }

  private assertConversationScope(
    preview: AiMutationPreview,
    conversationId: string | null | undefined,
  ): void {
    if (!conversationId) {
      return;
    }
    if (preview.conversation_id !== conversationId) {
      throw new ForbiddenException('AI preview does not belong to this conversation.');
    }
  }

  private toPreviewDto(preview: AiMutationPreview): AiMutationPreviewDto {
    const operation = this.operations.getOperation(preview.tool_name);
    const presentation = operation.presentPreview(preview);

    return {
      preview_id: preview.id,
      tool_name: preview.tool_name as AiMutationWriteToolName,
      status: preview.status,
      target: presentation.target,
      changes: presentation.changes,
      requires_confirmation: preview.status === 'pending',
      actions: preview.status === 'pending'
        ? ['approve', 'reject'] as Array<'approve' | 'reject'>
        : [],
      summary: presentation.summary,
      error_message: preview.error_message ?? null,
      conversation_id: preview.conversation_id ?? null,
      created_at: preview.created_at.toISOString(),
      expires_at: toIso(preview.expires_at),
      approved_at: toIso(preview.approved_at),
      rejected_at: toIso(preview.rejected_at),
      executed_at: toIso(preview.executed_at),
    };
  }

  private getOperationBusinessResource<TInput>(
    operation: ReturnType<AiMutationOperationRegistry['getOperation']>,
    params: { input?: TInput; preview?: AiMutationPreview },
  ): string {
    return operation.resolveBusinessResource?.(params as any) ?? operation.businessResource;
  }

  private normalizePlanStepKey(value: string | null | undefined, fallback: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return fallback;
    }
    return normalized.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || fallback;
  }

  private toPlanStepDto(step: AiMutationPlanStep): AiMutationPlanStepDto {
    return {
      id: step.id,
      step_key: step.step_key,
      label: step.label ?? null,
      tool_name: step.tool_name as AiMutationWriteToolName,
      status: step.status,
      preview_id: step.preview_id ?? null,
      depends_on: Array.isArray(step.depends_on) ? step.depends_on : [],
      error_message: step.error_message ?? null,
    };
  }

  private toPlanDto(plan: AiMutationPlan, steps: AiMutationPlanStep[]): AiMutationPlanDto {
    return {
      plan_id: plan.id,
      summary: plan.summary ?? null,
      status: plan.status,
      steps: steps.map((step) => this.toPlanStepDto(step)),
    };
  }

  private clonePlanInput(input: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(input ?? {}));
  }

  /**
   * What makes two previews the same request: the tool, the target, the change and the state it
   * was asked against (`current_values.values`, as stored: JSON). A retry finds its preview, even
   * once executed; the same change asked again after the record moved on (back and forth between
   * two values) is a new preview.
   */
  private previewSignature(
    toolName: string,
    prepared: Pick<AiPreparedMutationPreview, 'targetEntityType' | 'targetEntityId' | 'mutationInput' | 'currentValues'>,
  ): string {
    const values = prepared.currentValues?.values;
    return stableStringify({
      tool_name: toolName,
      target_entity_type: prepared.targetEntityType,
      target_entity_id: prepared.targetEntityId ?? null,
      mutation_input: prepared.mutationInput,
      current_values: values === undefined ? null : JSON.parse(JSON.stringify(values)),
    });
  }

  private planOperationSignature(
    toolName: string,
    input: Record<string, unknown>,
    dependsOn: string[],
  ): string {
    return stableStringify({
      tool_name: toolName,
      input,
      depends_on: [...dependsOn].sort(),
    });
  }

  private async findEquivalentConversationPreview(
    context: AiExecutionContextWithManager,
    toolName: string,
    prepared: AiPreparedMutationPreview,
  ): Promise<AiMutationPreview | null> {
    if (!context.conversationId) {
      return null;
    }
    const candidates = await this.getRepo(context.manager).find({
      where: {
        tenant_id: context.tenantId,
        conversation_id: context.conversationId,
        user_id: context.userId,
        tool_name: toolName,
        status: In(['pending', 'approved', 'executed']),
      },
      order: { created_at: 'ASC' },
      take: MAX_CONVERSATION_PREVIEWS,
    });
    const signature = this.previewSignature(toolName, prepared);
    return candidates.find((candidate) =>
      this.previewSignature(candidate.tool_name, {
        targetEntityType: candidate.target_entity_type,
        targetEntityId: candidate.target_entity_id,
        mutationInput: candidate.mutation_input,
        currentValues: candidate.current_values,
      }) === signature,
    ) ?? null;
  }

  private applyPlanPlaceholders(
    value: unknown,
    dependencyValues: Map<string, { id: string | null; ref: string | null; title: string | null }>,
  ): unknown {
    if (typeof value === 'string') {
      return value.replace(PLAN_PLACEHOLDER_RE, (_match, rawKey: string, field: 'id' | 'ref' | 'title') => {
        const dependency = dependencyValues.get(rawKey);
        const replacement = dependency?.[field] ?? null;
        if (!replacement) {
          throw new BadRequestException(`Plan dependency ${rawKey}.${field} is not available yet.`);
        }
        return replacement;
      });
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.applyPlanPlaceholders(entry, dependencyValues));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, entry]) => [key, this.applyPlanPlaceholders(entry, dependencyValues)]),
      );
    }
    return value;
  }

  private buildDependencyValues(steps: AiMutationPlanStep[]) {
    return new Map(steps.map((step) => [
      step.step_key,
      {
        id: step.result_entity_id ?? null,
        ref: step.result_ref ?? null,
        title: step.result_title ?? null,
      },
    ]));
  }

  private async updatePlanStatus(
    manager: EntityManager,
    plan: AiMutationPlan,
  ): Promise<void> {
    const steps = await this.getPlanStepRepo(manager).find({
      where: {
        tenant_id: plan.tenant_id,
        plan_id: plan.id,
      },
    });
    const hasActive = steps.some((step) => step.status === 'waiting_dependency' || step.status === 'preview_ready');
    const hasFailed = steps.some((step) => step.status === 'failed' || step.status === 'blocked');
    if (!hasActive && steps.length > 0) {
      plan.status = hasFailed ? 'failed' : 'completed';
      plan.updated_at = new Date();
      await this.getPlanRepo(manager).save(plan);
    }
  }

  async expireStalePreviews(
    manager: EntityManager,
    tenantId: string,
    opts?: { conversationId?: string | null; userId?: string | null },
  ): Promise<number> {
    const repo = this.getRepo(manager);
    const result = await repo.createQueryBuilder()
      .update(AiMutationPreview)
      .set({ status: 'expired' })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :status', { status: 'pending' })
      .andWhere('expires_at < now()')
      .andWhere(opts?.conversationId ? 'conversation_id = :conversationId' : '1=1', { conversationId: opts?.conversationId })
      .andWhere(opts?.userId ? 'user_id = :userId' : '1=1', { userId: opts?.userId })
      .execute();
    return result.affected ?? 0;
  }

  private async assertPendingCapacityAvailable(
    context: AiExecutionContextWithManager,
    conversationId: string | null,
  ): Promise<void> {
    if (!conversationId) {
      return;
    }

    await this.expireStalePreviews(context.manager, context.tenantId, {
      conversationId,
      userId: context.userId,
    });

    const pendingCount = await this.getRepo(context.manager).count({
      where: {
        tenant_id: context.tenantId,
        conversation_id: conversationId,
        user_id: context.userId,
        status: 'pending',
      },
    });

    if (pendingCount >= MAX_PENDING_CONVERSATION_PREVIEWS) {
      throw new ConflictException('Too many pending AI previews exist in this conversation.');
    }
  }

  async createPreview<TInput>(
    context: AiExecutionContextWithManager,
    toolName: AiMutationWriteToolName,
    input: TInput,
  ): Promise<AiMutationPreviewDto> {
    const operation = this.operations.getOperation<TInput>(toolName);
    await this.policy.assertWriteAccess(
      context,
      this.getOperationBusinessResource(operation, { input }),
      context.manager,
    );
    await this.assertPendingCapacityAvailable(context, context.conversationId ?? null);

    const prepared = await operation.prepareCreatePreview(context, input);
    const existing = await this.findEquivalentConversationPreview(context, operation.toolName, prepared);
    if (existing) {
      return this.toPreviewDto(existing);
    }

    const repo = this.getRepo(context.manager);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);

    const preview = await repo.save(repo.create({
      tenant_id: context.tenantId,
      conversation_id: context.conversationId ?? null,
      user_id: context.userId,
      tool_name: operation.toolName,
      target_entity_type: prepared.targetEntityType,
      target_entity_id: prepared.targetEntityId,
      mutation_input: prepared.mutationInput,
      current_values: prepared.currentValues,
      status: 'pending',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
      expires_at: expiresAt,
      error_message: null,
      created_at: now,
    }));

    return this.toPreviewDto(preview);
  }

  private async createPreviewForPlanStep(
    context: AiExecutionContextWithManager,
    step: AiMutationPlanStep,
    input: Record<string, unknown>,
  ): Promise<AiMutationPreviewDto> {
    const preview = await this.createPreview(
      context,
      step.tool_name as AiMutationWriteToolName,
      input,
    );
    step.preview_id = preview.preview_id;
    if (preview.status === 'executed' || preview.status === 'failed') {
      step.status = preview.status === 'executed' ? 'executed' : 'failed';
      step.error_message = preview.error_message ?? null;
      step.result_entity_type = preview.target.entity_type ?? null;
      step.result_entity_id = preview.target.entity_id ?? null;
      step.result_ref = preview.target.ref ?? null;
      step.result_title = preview.target.title ?? null;
    } else {
      step.status = 'preview_ready';
      step.error_message = null;
    }
    step.updated_at = new Date();
    await this.getPlanStepRepo(context.manager).save(step);
    return preview;
  }

  async createMutationPlan(
    context: AiExecutionContextWithManager,
    input: AiMutationPlanInput,
  ): Promise<AiMutationPlanPrepareResultDto> {
    const operations = Array.isArray(input.operations) ? input.operations : [];
    if (operations.length === 0) {
      throw new BadRequestException('Mutation plan requires at least one operation.');
    }
    if (operations.length > MAX_PENDING_CONVERSATION_PREVIEWS) {
      throw new BadRequestException('Mutation plan contains too many operations.');
    }

    const expectedRefs = normalizeTargetRefs(input.expected_target_refs);
    const expectedCount = normalizeExpectedTargetCount(input.expected_target_count, expectedRefs);
    const explicitExclusions = normalizeExplicitExclusions(input.explicit_exclusions);
    const excludedRefSet = new Set(explicitExclusions.map((exclusion) => exclusion.ref));
    const targetSetLabel = input.target_set_label ? String(input.target_set_label).trim() || null : null;

    const planRepo = this.getPlanRepo(context.manager);
    const stepRepo = this.getPlanStepRepo(context.manager);
    const now = new Date();
    const plan = await planRepo.save(planRepo.create({
      tenant_id: context.tenantId,
      conversation_id: context.conversationId ?? null,
      user_id: context.userId,
      summary: input.summary ? String(input.summary).trim() || null : null,
      status: 'active',
      created_at: now,
      updated_at: now,
    }));

    const seenKeys = new Set<string>();
    const keyAliases = new Map<string, string>();
    const operationSignatures = new Map<string, string>();
    const steps: AiMutationPlanStep[] = [];
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      const fallbackKey = `step_${index + 1}`;
      const rawStepKey = this.normalizePlanStepKey(operation.operation_id, fallbackKey);
      let stepKey = rawStepKey;
      if (seenKeys.has(stepKey)) {
        stepKey = `${stepKey}_${index + 1}`;
      }

      const rawToolName = String(operation.tool_name || '').trim();
      const dependsOn = Array.isArray(operation.depends_on)
        ? operation.depends_on
          .map((value) => this.normalizePlanStepKey(value, ''))
          .filter(Boolean)
          .map((value) => keyAliases.get(value) ?? value)
        : [];
      let stepInput = this.clonePlanInput(operation.input ?? {});
      const normalizedOperation = normalizePlanOperationForCompatibility(rawToolName, stepInput);
      const toolName = normalizedOperation.toolName;
      stepInput = normalizedOperation.input;
      const operationSignature = this.planOperationSignature(toolName, stepInput, dependsOn);
      const existingStepKey = operationSignatures.get(operationSignature);
      if (existingStepKey) {
        keyAliases.set(rawStepKey, existingStepKey);
        continue;
      }

      seenKeys.add(stepKey);
      operationSignatures.set(operationSignature, stepKey);
      const supported = this.operations.isSupportedToolName(toolName);
      const step = await stepRepo.save(stepRepo.create({
        tenant_id: context.tenantId,
        conversation_id: context.conversationId ?? null,
        user_id: context.userId,
        plan_id: plan.id,
        step_key: stepKey,
        label: operation.label ? String(operation.label).trim() || null : null,
        tool_name: toolName,
        input: stepInput,
        depends_on: dependsOn,
        preview_id: null,
        status: supported ? 'waiting_dependency' : 'failed',
        error_message: supported ? null : `Unsupported mutation tool ${toolName}.`,
        created_at: now,
        updated_at: now,
      }));
      steps.push(step);
    }

    const previews: AiMutationPreviewDto[] = [];
    const errors: AiMutationPlanPrepareResultDto['errors'] = [];
    const knownStepKeys = new Set(steps.map((step) => step.step_key));

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step.status === 'failed') {
        errors.push({
          index,
          step_key: step.step_key,
          label: step.label ?? null,
          tool_name: step.tool_name,
          message: step.error_message || 'Step failed.',
        });
        continue;
      }
      const unknownDependency = step.depends_on.find((dependency) => !knownStepKeys.has(dependency));
      if (unknownDependency) {
        step.status = 'failed';
        step.error_message = `Unknown dependency ${unknownDependency}.`;
        step.updated_at = new Date();
        await stepRepo.save(step);
        errors.push({
          index,
          step_key: step.step_key,
          label: step.label ?? null,
          tool_name: step.tool_name,
          message: step.error_message,
        });
        continue;
      }
      if (step.depends_on.length > 0) {
        continue;
      }
      try {
        const preview = await this.createPreviewForPlanStep(context, step, step.input);
        if (step.status === 'executed') {
          previews.push(...await this.advanceMutationPlanFromExecutedStep(context, step));
        } else {
          previews.push(preview);
        }
      } catch (error: any) {
        step.status = 'failed';
        step.error_message = error?.message || 'Preview creation failed.';
        step.updated_at = new Date();
        await stepRepo.save(step);
        errors.push({
          index,
          step_key: step.step_key,
          label: step.label ?? null,
          tool_name: step.tool_name,
          message: step.error_message || 'Preview creation failed.',
        });
      }
    }

    const blockedSteps = await this.blockWaitingStepsWithFailedDependencies(context, plan.id);
    for (const blocked of blockedSteps) {
      const index = steps.findIndex((step) => step.step_key === blocked.step_key);
      errors.push({
        index: index >= 0 ? index : 0,
        step_key: blocked.step_key,
        label: blocked.label ?? null,
        tool_name: blocked.tool_name,
        message: blocked.error_message || 'Step was blocked by a failed dependency.',
      });
    }

    const savedSteps = await stepRepo.find({
      where: {
        tenant_id: context.tenantId,
        plan_id: plan.id,
      },
      order: { created_at: 'ASC' },
    });
    await this.updatePlanStatus(context.manager, plan);
    const deferred = savedSteps.filter((step) => step.status === 'waiting_dependency');
    const failed = savedSteps.filter((step) => step.status === 'failed' || step.status === 'blocked').length;
    const coveredRefs = normalizeTargetRefs(previews.map((preview) => preview.target.ref));
    const coveredRefSet = new Set(coveredRefs);
    const failedRefs = normalizeTargetRefs(
      savedSteps
        .filter((step) => step.status === 'failed' || step.status === 'blocked')
        .map((step) => planStepTargetRef(step)),
    );
    const failedRefSet = new Set(failedRefs);
    const missingRefs = expectedRefs.filter((ref) =>
      !coveredRefSet.has(ref)
      && !failedRefSet.has(ref)
      && !excludedRefSet.has(ref),
    );
    const countHandled = previews.length + failed + explicitExclusions.length;
    const countIncomplete = expectedCount != null && countHandled < expectedCount;
    const targetSetComplete = missingRefs.length === 0 && !countIncomplete;
    return {
      plan: this.toPlanDto(plan, savedSteps),
      previews,
      errors,
      deferred: deferred.map((step) => this.toPlanStepDto(step)),
      total: savedSteps.length,
      created: previews.length,
      failed,
      deferred_count: deferred.length,
      target_set_label: targetSetLabel,
      expected_count: expectedCount,
      expected_refs: expectedRefs,
      covered_refs: coveredRefs,
      missing_refs: missingRefs,
      excluded: explicitExclusions,
      complete: failed === 0 && deferred.length === 0 && targetSetComplete,
    };
  }

  async getPreviewForUser(
    context: AiExecutionContextWithManager,
    previewId: string,
  ): Promise<AiMutationPreview> {
    const preview = await this.getRepo(context.manager).findOne({
      where: {
        id: previewId,
        tenant_id: context.tenantId,
        user_id: context.userId,
      },
    });

    if (!preview) {
      throw new NotFoundException('AI preview not found.');
    }

    if (!this.operations.isSupportedToolName(preview.tool_name)) {
      throw new BadRequestException('Unsupported preview type.');
    }

    return preview;
  }

  /**
   * The preview, read again under its row lock after a first read that
   * checks it is the user's: two approvals of one preview, or an approval and
   * a rejection, take turns, and the second finds it no longer pending, so it
   * never executes twice (plan planning/perf-scale, lot 3B, Annexe A #24).
   * FOR NO KEY UPDATE: the preview's key never changes, and the rows that
   * reference it (plan steps, action requests) need not wait. The lock is
   * taken before the execution's own locks (a budget line, then its version)
   * and held until the request ends.
   */
  private async lockPreviewForUser(
    context: AiExecutionContextWithManager,
    previewId: string,
  ): Promise<AiMutationPreview> {
    const preview = await this.getPreviewForUser(context, previewId);
    await context.manager.query(
      'SELECT id FROM ai_mutation_previews WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE',
      [context.tenantId, preview.id],
    );
    return this.getPreviewForUser(context, previewId);
  }

  /**
   * A batch locks all its previews first, in id order, then runs them in the
   * order given: two batches that share previews never each hold one while
   * waiting for the other (each run also locks budget lines, after its
   * preview). Ids that are not the user's previews (or not ids) are left to
   * the per-preview read, which refuses them as before.
   */
  private async lockPreviewsInIdOrder(context: AiExecutionContextWithManager, previewIds: string[]): Promise<void> {
    const ids = previewIds.filter((id) => UUID_RE.test(id));
    if (ids.length < 2) return;
    await context.manager.query(
      `SELECT id FROM ai_mutation_previews
        WHERE tenant_id = $1 AND user_id = $2 AND id = ANY($3::uuid[])
        ORDER BY id
          FOR NO KEY UPDATE`,
      [context.tenantId, context.userId, ids],
    );
  }

  private async markPlanStepsFromExecutedPreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiMutationPlanStep[]> {
    const stepRepo = this.getPlanStepRepo(context.manager);
    const steps = await stepRepo.find({
      where: {
        tenant_id: context.tenantId,
        preview_id: preview.id,
        user_id: context.userId,
      },
    });

    const dto = this.toPreviewDto(preview);
    const updatedSteps: AiMutationPlanStep[] = [];
    for (const step of steps) {
      step.status = preview.status === 'executed' ? 'executed' : 'failed';
      step.error_message = preview.error_message ?? null;
      step.result_entity_type = dto.target.entity_type ?? preview.target_entity_type ?? null;
      step.result_entity_id = dto.target.entity_id ?? preview.target_entity_id ?? null;
      step.result_ref = dto.target.ref ?? null;
      step.result_title = dto.target.title ?? null;
      step.updated_at = new Date();
      updatedSteps.push(await stepRepo.save(step));
    }
    return updatedSteps;
  }

  private async blockPlanDependents(
    context: AiExecutionContextWithManager,
    planId: string,
    dependencyKey: string,
    reason: string,
  ): Promise<void> {
    const stepRepo = this.getPlanStepRepo(context.manager);
    const steps = await stepRepo.find({
      where: {
        tenant_id: context.tenantId,
        plan_id: planId,
      },
    });
    for (const step of steps) {
      if (step.status !== 'waiting_dependency') continue;
      if (!Array.isArray(step.depends_on) || !step.depends_on.includes(dependencyKey)) continue;
      step.status = 'blocked';
      step.error_message = reason;
      step.updated_at = new Date();
      await stepRepo.save(step);
      await this.blockPlanDependents(context, planId, step.step_key, reason);
    }
  }

  private async blockWaitingStepsWithFailedDependencies(
    context: AiExecutionContextWithManager,
    planId: string,
  ): Promise<AiMutationPlanStep[]> {
    const stepRepo = this.getPlanStepRepo(context.manager);
    const blockedSteps: AiMutationPlanStep[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      const steps = await stepRepo.find({
        where: {
          tenant_id: context.tenantId,
          plan_id: planId,
        },
      });
      const failedKeys = new Set(steps
        .filter((step) => step.status === 'failed' || step.status === 'blocked')
        .map((step) => step.step_key));
      for (const step of steps) {
        if (step.status !== 'waiting_dependency') continue;
        const failedDependency = step.depends_on.find((dependency) => failedKeys.has(dependency));
        if (!failedDependency) continue;
        step.status = 'blocked';
        step.error_message = `Dependency ${failedDependency} did not execute.`;
        step.updated_at = new Date();
        await stepRepo.save(step);
        blockedSteps.push(step);
        progressed = true;
      }
    }
    return blockedSteps;
  }

  private async advanceMutationPlanFromExecutedStep(
    context: AiExecutionContextWithManager,
    executedStep: AiMutationPlanStep,
  ): Promise<AiMutationPreviewDto[]> {
    const planRepo = this.getPlanRepo(context.manager);
    const stepRepo = this.getPlanStepRepo(context.manager);
    const plan = await planRepo.findOne({
      where: {
        id: executedStep.plan_id,
        tenant_id: context.tenantId,
        user_id: context.userId,
      },
    });
    if (!plan) {
      return [];
    }

    if (executedStep.status !== 'executed') {
      await this.blockPlanDependents(
        context,
        executedStep.plan_id,
        executedStep.step_key,
        executedStep.error_message || 'A dependency did not execute.',
      );
      await this.updatePlanStatus(context.manager, plan);
      return [];
    }

    const createdPreviews: AiMutationPreviewDto[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      const steps = await stepRepo.find({
        where: {
          tenant_id: context.tenantId,
          plan_id: executedStep.plan_id,
        },
        order: { created_at: 'ASC' },
      });
      const dependencyValues = this.buildDependencyValues(steps);
      const executedKeys = new Set(steps
        .filter((step) => step.status === 'executed')
        .map((step) => step.step_key));
      const failedKeys = new Set(steps
        .filter((step) => step.status === 'failed' || step.status === 'blocked')
        .map((step) => step.step_key));

      for (const step of steps) {
        if (step.status !== 'waiting_dependency') continue;
        const failedDependency = step.depends_on.find((dependency) => failedKeys.has(dependency));
        if (failedDependency) {
          step.status = 'blocked';
          step.error_message = `Dependency ${failedDependency} did not execute.`;
          step.updated_at = new Date();
          await stepRepo.save(step);
          progressed = true;
          continue;
        }
        if (!step.depends_on.every((dependency) => executedKeys.has(dependency))) {
          continue;
        }
        try {
          const resolvedInput = this.applyPlanPlaceholders(step.input, dependencyValues) as Record<string, unknown>;
          createdPreviews.push(await this.createPreviewForPlanStep(context, step, resolvedInput));
          progressed = true;
        } catch (error: any) {
          step.status = 'failed';
          step.error_message = error?.message || 'Preview creation failed.';
          step.updated_at = new Date();
          await stepRepo.save(step);
          progressed = true;
        }
      }
    }

    await this.updatePlanStatus(context.manager, plan);
    return createdPreviews;
  }

  private async advanceMutationPlanAfterPreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiMutationPreviewDto[]> {
    const executedSteps = await this.markPlanStepsFromExecutedPreview(context, preview);
    const previewsById = new Map<string, AiMutationPreviewDto>();
    for (const executedStep of executedSteps) {
      const followUps = await this.advanceMutationPlanFromExecutedStep(context, executedStep);
      for (const followUp of followUps) {
        previewsById.set(followUp.preview_id, followUp);
      }
    }
    return Array.from(previewsById.values());
  }

  private async executePreviewInternal(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
    followUpPreviews?: AiMutationPreviewDto[],
  ): Promise<AiMutationPreviewDto> {
    const repo = this.getRepo(context.manager);
    const operation = this.operations.getOperation(preview.tool_name);
    const originalTargetEntityId = preview.target_entity_id;
    const originalCurrentValues = cloneJsonRecord(preview.current_values);
    const queryRunner = context.manager.queryRunner;
    const useSavepoint = queryRunner?.isTransactionActive === true;

    try {
      if (useSavepoint) {
        await queryRunner.query(`SAVEPOINT ${EXECUTION_SAVEPOINT_NAME}`);
      }
      await operation.executePreview(context, preview);
      preview.status = 'executed';
      preview.approved_at = new Date();
      preview.executed_at = new Date();
      preview.error_message = null;
      const saved = await repo.save(preview);
      const dto = this.toPreviewDto(saved);
      const followUps = await this.advanceMutationPlanAfterPreview(context, saved);
      if (followUpPreviews) {
        followUpPreviews.push(...followUps);
      }
      return dto;
    } catch (error: any) {
      if (useSavepoint) {
        await queryRunner.query(`ROLLBACK TO SAVEPOINT ${EXECUTION_SAVEPOINT_NAME}`);
        preview.target_entity_id = originalTargetEntityId;
        preview.current_values = originalCurrentValues;
        // The data was held by another operation (a lock wait that ran out, a deadlock, a
        // statement cut short): everything it ran is rolled back to the savepoint, so the
        // preview stays pending and can be approved again, with a plain message instead of
        // the database's. Its plan does not move.
        const transient = mapDatabaseError(error);
        if (transient && (transient.code === 'busy' || transient.code === 'retry')) {
          preview.error_message = PREVIEW_DATA_BUSY_MESSAGE;
          return this.toPreviewDto(await repo.save(preview));
        }
      }
      preview.status = 'failed';
      preview.approved_at = new Date();
      preview.error_message = error?.message || 'Preview execution failed.';
      const saved = await repo.save(preview);
      const dto = this.toPreviewDto(saved);
      const followUps = await this.advanceMutationPlanAfterPreview(context, saved);
      if (followUpPreviews) {
        followUpPreviews.push(...followUps);
      }
      return dto;
    }
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    previewId: string,
  ): Promise<AiMutationPreviewDto> {
    const preview = await this.lockPreviewForUser(context, previewId);
    const operation = this.operations.getOperation(preview.tool_name);
    await this.policy.assertWriteAccess(
      context,
      this.getOperationBusinessResource(operation, { preview }),
      context.manager,
    );
    this.assertConversationScope(preview, context.conversationId ?? null);

    if (preview.status !== 'pending') {
      return this.toPreviewDto(preview);
    }

    if (preview.expires_at.getTime() < Date.now()) {
      preview.status = 'expired';
      preview.error_message = 'Preview expired before approval.';
      const saved = await this.getRepo(context.manager).save(preview);
      return this.toPreviewDto(saved);
    }

    return this.executePreviewInternal(context, preview);
  }

  private normalizePreviewIds(previewIds: string[]): string[] {
    const ids = previewIds
      .map((id) => String(id || '').trim())
      .filter((id) => id.length > 0);
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      throw new BadRequestException('At least one AI preview id is required.');
    }
    if (uniqueIds.length > MAX_PENDING_CONVERSATION_PREVIEWS) {
      throw new BadRequestException('Too many AI previews were selected.');
    }
    return uniqueIds;
  }

  async executePreviews(
    context: AiExecutionContextWithManager,
    previewIds: string[],
  ): Promise<AiMutationPreviewDto[]> {
    const results: AiMutationPreviewDto[] = [];
    const ids = this.normalizePreviewIds(previewIds);
    await this.lockPreviewsInIdOrder(context, ids);
    for (const previewId of ids) {
      results.push(await this.executePreview(context, previewId));
    }
    return results;
  }

  async executePreviewsWithFollowUps(
    context: AiExecutionContextWithManager,
    previewIds: string[],
  ): Promise<{ results: AiMutationPreviewDto[]; followUpPreviews: AiMutationPreviewDto[] }> {
    const results: AiMutationPreviewDto[] = [];
    const followUpPreviews: AiMutationPreviewDto[] = [];
    const ids = this.normalizePreviewIds(previewIds);
    await this.lockPreviewsInIdOrder(context, ids);
    for (const previewId of ids) {
      const preview = await this.lockPreviewForUser(context, previewId);
      const operation = this.operations.getOperation(preview.tool_name);
      await this.policy.assertWriteAccess(
        context,
        this.getOperationBusinessResource(operation, { preview }),
        context.manager,
      );
      this.assertConversationScope(preview, context.conversationId ?? null);

      if (preview.status !== 'pending') {
        results.push(this.toPreviewDto(preview));
        continue;
      }

      if (preview.expires_at.getTime() < Date.now()) {
        preview.status = 'expired';
        preview.error_message = 'Preview expired before approval.';
        const saved = await this.getRepo(context.manager).save(preview);
        results.push(this.toPreviewDto(saved));
        followUpPreviews.push(...await this.advanceMutationPlanAfterPreview(context, saved));
        continue;
      }

      results.push(await this.executePreviewInternal(context, preview, followUpPreviews));
    }
    return { results, followUpPreviews };
  }

  async rejectPreview(
    context: AiExecutionContextWithManager,
    previewId: string,
  ): Promise<AiMutationPreviewDto> {
    const repo = this.getRepo(context.manager);
    const preview = await this.lockPreviewForUser(context, previewId);
    const operation = this.operations.getOperation(preview.tool_name);
    await this.policy.assertWriteAccess(
      context,
      this.getOperationBusinessResource(operation, { preview }),
      context.manager,
    );
    this.assertConversationScope(preview, context.conversationId ?? null);

    if (preview.status === 'pending') {
      if (preview.expires_at.getTime() < Date.now()) {
        preview.status = 'expired';
        preview.error_message = 'Preview expired before approval.';
      } else {
        preview.status = 'rejected';
        preview.rejected_at = new Date();
        preview.error_message = null;
      }
      const saved = await repo.save(preview);
      const steps = await this.markPlanStepsFromExecutedPreview(context, saved);
      for (const step of steps) {
        await this.blockPlanDependents(
          context,
          step.plan_id,
          step.step_key,
          saved.error_message || 'Dependency preview was not approved.',
        );
        const plan = await this.getPlanRepo(context.manager).findOne({
          where: { id: step.plan_id, tenant_id: context.tenantId, user_id: context.userId },
        });
        if (plan) {
          await this.updatePlanStatus(context.manager, plan);
        }
      }
    }

    return this.toPreviewDto(preview);
  }

  async rejectPreviews(
    context: AiExecutionContextWithManager,
    previewIds: string[],
  ): Promise<AiMutationPreviewDto[]> {
    const results: AiMutationPreviewDto[] = [];
    const ids = this.normalizePreviewIds(previewIds);
    await this.lockPreviewsInIdOrder(context, ids);
    for (const previewId of ids) {
      results.push(await this.rejectPreview(context, previewId));
    }
    return results;
  }

  async createReversePreview(
    context: AiExecutionContextWithManager,
    previewId: string,
  ): Promise<AiMutationPreviewDto> {
    const original = await this.getPreviewForUser(context, previewId);
    const operation = this.operations.getOperation(original.tool_name);
    await this.policy.assertWriteAccess(
      context,
      this.getOperationBusinessResource(operation, { preview: original }),
      context.manager,
    );
    this.assertConversationScope(original, context.conversationId ?? null);

    if (original.status !== 'executed') {
      throw new BadRequestException('Only executed previews can be undone.');
    }
    if (!operation.writePreview.reversible || !operation.prepareReversePreview) {
      throw new BadRequestException('Undo is not supported for this preview type.');
    }

    await this.assertPendingCapacityAvailable(context, original.conversation_id ?? null);

    const prepared = await operation.prepareReversePreview(context, original);
    const repo = this.getRepo(context.manager);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);

    const preview = await repo.save(repo.create({
      tenant_id: context.tenantId,
      conversation_id: original.conversation_id ?? null,
      user_id: context.userId,
      tool_name: original.tool_name,
      target_entity_type: prepared.targetEntityType,
      target_entity_id: prepared.targetEntityId,
      mutation_input: prepared.mutationInput,
      current_values: prepared.currentValues,
      status: 'pending',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
      expires_at: expiresAt,
      error_message: null,
      created_at: now,
    }));

    return this.toPreviewDto(preview);
  }

  async listConversationPreviews(
    context: AiExecutionContextWithManager,
    conversationId: string,
  ): Promise<AiMutationPreviewDto[]> {
    await this.expireStalePreviews(context.manager, context.tenantId, {
      conversationId,
      userId: context.userId,
    });

    const previews = await this.getRepo(context.manager).find({
      where: {
        tenant_id: context.tenantId,
        conversation_id: conversationId,
        user_id: context.userId,
      },
      order: {
        created_at: 'DESC',
      },
      take: MAX_CONVERSATION_PREVIEWS,
    });

    return previews
      .slice()
      .reverse()
      .map((preview) => this.toPreviewDto(preview));
  }

  async hasExecutedUndoablePreviewInConversation(
    context: AiExecutionContextWithManager,
    conversationId: string | null | undefined,
  ): Promise<boolean> {
    if (!conversationId) {
      return false;
    }

    const undoableToolNames = this.operations.getReversibleToolNames();
    if (undoableToolNames.length === 0) {
      return false;
    }

    const count = await this.getRepo(context.manager).count({
      where: {
        tenant_id: context.tenantId,
        conversation_id: conversationId,
        user_id: context.userId,
        status: 'executed',
        tool_name: In(undoableToolNames),
      },
    });

    return count > 0;
  }
}
