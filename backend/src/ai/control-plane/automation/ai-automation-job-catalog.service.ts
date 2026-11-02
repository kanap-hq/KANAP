import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY,
  AUTOMATION_PROVIDER_CAPABILITY_VERSION,
} from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiAutomationJobCatalog } from '../entities/ai-automation-job-catalog.entity';
import { AiEvidence } from '../entities/ai-evidence.entity';
import { hashStableJson } from '../evidence/ai-evidence.service';
import {
  AutomationCatalogJob,
  AutomationLaunchActionPayload,
  AutomationTargetSelector,
} from '../providers/provider.types';
import { isRecord } from '../../../common/object-guards';
import { codedForbidden } from '../../../auth/module-right-required';

const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|cookie|session|credential)/i;
const SECRET_VALUE_RE = /\b(Bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:password|token|secret|api[-_]?key)\s*[:=]\s*[^ \n\r\t]+)/i;
const BROAD_TARGETS = new Set(['', '*', 'all', 'any', 'everyone']);
const VALID_ENVIRONMENTS = new Set(['mock', 'lab', 'sandbox', 'staging', 'production']);

type TargetPolicy = {
  allowed_types?: string[];
  allowed_values?: string[];
  allowed_patterns?: string[];
  forbidden_selectors?: string[];
  allow_broad_selectors?: boolean;
  allow_unlisted_values?: boolean;
  max_targets?: number;
};

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]));
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return SECRET_VALUE_RE.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsSecretLikeValue);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(([key, entry]) => SECRET_KEY_RE.test(key) || containsSecretLikeValue(entry));
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function normalizeEnvironment(value: string): string {
  return value.trim().toLowerCase();
}

function compileAllowedPatterns(values: string[]): RegExp[] {
  return values.map((pattern) => {
    if (pattern.length > 128 || /\\[1-9]/.test(pattern) || /\([^)]*[+*][^)]*\)\s*(?:[+*]|\{\d)/.test(pattern)) {
      throw new BadRequestException('Automation target policy contains an unsafe allowed pattern.');
    }
    try {
      return new RegExp(pattern);
    } catch {
      throw new BadRequestException('Automation target policy contains an invalid allowed pattern.');
    }
  });
}

function catalogToProviderJob(row: AiAutomationJobCatalog): AutomationCatalogJob {
  return {
    id: row.id,
    providerKey: row.provider_key,
    jobKey: row.job_key,
    catalogVersion: row.catalog_version,
    displayName: row.display_name,
    description: row.description,
    environment: normalizeEnvironment(row.environment),
    externalJobTemplateRef: row.external_job_template_ref,
    enabled: row.enabled,
    launchAllowed: row.launch_allowed,
    dryRunSupported: row.dry_run_supported,
    dryRunRequired: row.dry_run_required,
    variableSchema: row.variable_schema_json,
    targetPolicy: row.target_policy_json,
    blastRadiusLimit: row.blast_radius_limit,
    cooldownSeconds: row.cooldown_seconds,
    timeoutSeconds: row.timeout_seconds,
    redactionPolicy: row.redaction_policy_json ?? { fields: [] },
    liveTestSafety: row.live_test_safety,
    cancelAllowed: row.cancel_allowed,
    metadata: row.metadata_json ?? null,
  };
}

export type NormalizedAutomationTarget = AutomationTargetSelector & {
  blastRadius: number;
  targetRef: string;
};

export type DryRunMatch = {
  evidence: AiEvidence;
  dryRunFingerprint: string;
  dryRunResultHash: string;
};

@Injectable()
export class AiAutomationJobCatalogService {
  private readonly ajv = new Ajv({
    allErrors: true,
    coerceTypes: false,
    strict: false,
    validateSchema: false,
  });
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(
    @InjectRepository(AiAutomationJobCatalog)
    private readonly catalogRepo: Repository<AiAutomationJobCatalog>,
  ) {
    addFormats(this.ajv);
  }

  private repository(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiAutomationJobCatalog);
  }

  private actionRepository(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiActionRequest);
  }

  private evidenceRepository(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiEvidence);
  }

  private validatorFor(job: AutomationCatalogJob): ValidateFunction {
    const cacheKey = `${job.id}:${job.catalogVersion}:${hashStableJson(job.variableSchema)}`;
    const existing = this.validators.get(cacheKey);
    if (existing) {
      return existing;
    }
    const validator = this.ajv.compile(job.variableSchema);
    this.validators.set(cacheKey, validator);
    return validator;
  }

  async listAllowedJobs(
    context: AiExecutionContextWithManager,
    providerKey?: string | null,
  ): Promise<AutomationCatalogJob[]> {
    const where: Record<string, unknown> = {
      tenant_id: context.tenantId,
      enabled: true,
    };
    if (providerKey) {
      where.provider_key = providerKey;
    }
    const rows = await this.repository(context).find({ where });
    return rows.map(catalogToProviderJob);
  }

  async getCatalogJob(
    context: AiExecutionContextWithManager,
    providerKey: string,
    jobKey: string,
  ): Promise<AutomationCatalogJob> {
    const row = await this.repository(context).findOne({
      where: {
        tenant_id: context.tenantId,
        provider_key: providerKey,
        job_key: jobKey,
      },
    });
    if (!row) {
      throw new NotFoundException('Automation job is not allowlisted for this tenant.');
    }
    const job = catalogToProviderJob(row);
    this.assertCatalogSafe(job);
    return job;
  }

  assertCatalogSafe(job: AutomationCatalogJob): void {
    const environment = typeof job.environment === 'string' ? normalizeEnvironment(job.environment) : '';
    if (!job.enabled) {
      throw codedForbidden('AUTOMATION_JOB_DISABLED', 'Automation job is disabled.');
    }
    if (!VALID_ENVIRONMENTS.has(environment)) {
      throw new BadRequestException('Automation job environment is invalid.');
    }
    if (!job.providerKey || !job.jobKey || !job.externalJobTemplateRef) {
      throw new BadRequestException('Automation job catalog entry is incomplete.');
    }
    if (!isRecord(job.variableSchema) || job.variableSchema.type !== 'object') {
      throw new BadRequestException('Automation job variable schema must be an object schema.');
    }
    if (job.variableSchema.additionalProperties !== false) {
      throw new BadRequestException('Automation job variable schema must reject additional properties.');
    }
    if (!Number.isInteger(job.blastRadiusLimit) || job.blastRadiusLimit < 1) {
      throw new BadRequestException('Automation job blast-radius limit must be at least one target.');
    }
    if (!Number.isInteger(job.cooldownSeconds) || job.cooldownSeconds < 0) {
      throw new BadRequestException('Automation job cooldown must be non-negative.');
    }
    if (!Number.isInteger(job.timeoutSeconds) || job.timeoutSeconds < 1 || job.timeoutSeconds > 1800) {
      throw new BadRequestException('Automation job timeout is outside the allowed range.');
    }
  }

  assertLaunchEligible(job: AutomationCatalogJob): void {
    this.assertCatalogSafe(job);
    if (!job.launchAllowed) {
      throw codedForbidden('AUTOMATION_LAUNCH_NOT_ALLOWED', 'Automation job launch is not allowed by the catalog.');
    }
    if (normalizeEnvironment(String(job.environment)) === 'production') {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Production automation launch is not enabled in Phase 4.');
    }
  }

  assertDryRunEligible(job: AutomationCatalogJob): void {
    this.assertCatalogSafe(job);
    if (!job.dryRunSupported) {
      throw codedForbidden('AUTOMATION_LAUNCH_NOT_ALLOWED', 'Automation job does not support dry-run/check mode.');
    }
  }

  validateVariables(job: AutomationCatalogJob, variables: unknown): Record<string, unknown> {
    if (!isRecord(variables)) {
      throw new BadRequestException('Automation variables must be a JSON object.');
    }
    if (containsSecretLikeValue(variables)) {
      throw new BadRequestException('Automation variables cannot contain secret-looking fields.');
    }
    const normalized = normalizeJson(variables) as Record<string, unknown>;
    const validator = this.validatorFor(job);
    if (validator(normalized)) {
      return normalized;
    }
    const errors = (validator.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`.trim());
    throw new BadRequestException({
      message: 'Automation variables failed catalog schema validation.',
      errors,
    });
  }

  validateTarget(job: AutomationCatalogJob, rawTarget: unknown): NormalizedAutomationTarget {
    if (!isRecord(rawTarget)) {
      throw new BadRequestException('Automation target selector must be an object.');
    }
    const type = typeof rawTarget.type === 'string' ? rawTarget.type.trim() : '';
    const values = parseStringArray(rawTarget.values);
    if (!type || values.length === 0) {
      throw new BadRequestException('Automation target selector must include a type and at least one value.');
    }
    const policy = isRecord(job.targetPolicy) ? job.targetPolicy as TargetPolicy : {};
    const allowedTypes = parseStringArray(policy.allowed_types);
    if (allowedTypes.length > 0 && !allowedTypes.includes(type)) {
      throw codedForbidden('AUTOMATION_TARGET_NOT_ALLOWED', 'Automation target type is not allowed for this job.');
    }
    const forbidden = new Set([
      ...parseStringArray(policy.forbidden_selectors).map((value) => value.toLowerCase()),
      ...Array.from(BROAD_TARGETS),
    ]);
    const allowBroad = policy.allow_broad_selectors === true;
    const normalizedValues = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
    for (const value of normalizedValues) {
      const lower = value.toLowerCase();
      if (!allowBroad && forbidden.has(lower)) {
        throw codedForbidden('AUTOMATION_TARGET_NOT_ALLOWED', 'Broad or forbidden automation target selectors are not allowed.');
      }
    }
    const allowedValues = parseStringArray(policy.allowed_values);
    const allowedPatterns = compileAllowedPatterns(parseStringArray(policy.allowed_patterns));
    if (allowedValues.length > 0) {
      const allowedSet = new Set(allowedValues);
      for (const value of normalizedValues) {
        if (!allowedSet.has(value)) {
          throw codedForbidden('AUTOMATION_TARGET_NOT_ALLOWED', 'Automation target selector is outside the job allowlist.');
        }
      }
    } else if (allowedPatterns.length > 0) {
      for (const value of normalizedValues) {
        if (!allowedPatterns.some((pattern) => pattern.test(value))) {
          throw codedForbidden('AUTOMATION_TARGET_NOT_ALLOWED', 'Automation target selector does not match an allowed catalog pattern.');
        }
      }
    } else if (policy.allow_unlisted_values !== true) {
      throw codedForbidden('AUTOMATION_TARGET_NOT_ALLOWED', 'Automation target policy must explicitly allow the requested selector.');
    }
    const maxTargets = Number.isInteger(policy.max_targets) && Number(policy.max_targets) > 0
      ? Number(policy.max_targets)
      : job.blastRadiusLimit;
    if (normalizedValues.length > job.blastRadiusLimit || normalizedValues.length > maxTargets) {
      throw codedForbidden('AUTOMATION_TARGET_NOT_ALLOWED', 'Automation target selector exceeds the configured blast-radius limit.');
    }
    return {
      type,
      values: normalizedValues,
      blastRadius: normalizedValues.length,
      targetRef: `${type}:${normalizedValues.join(',')}`,
    };
  }

  dryRunFingerprint(input: {
    job: AutomationCatalogJob;
    target: AutomationTargetSelector;
    variables: Record<string, unknown>;
  }): string {
    return hashStableJson({
      provider_key: input.job.providerKey,
      job_key: input.job.jobKey,
      environment: input.job.environment,
      catalog_version: input.job.catalogVersion,
      target: input.target,
      variables: input.variables,
    });
  }

  launchIdempotencyKey(input: {
    tenantId: string;
    job: AutomationCatalogJob;
    target: AutomationTargetSelector;
    variables: Record<string, unknown>;
    dryRunResultHash?: string | null;
    nowMs?: number | null;
  }): string {
    const cooldownWindowMs = Math.max(input.job.cooldownSeconds, 1) * 1000;
    const executionWindow = Math.floor((input.nowMs ?? Date.now()) / cooldownWindowMs);
    return hashStableJson({
      tenant_id: input.tenantId,
      provider_key: input.job.providerKey,
      job_key: input.job.jobKey,
      environment: input.job.environment,
      variables: input.variables,
      target: input.target,
      capability_version: AUTOMATION_PROVIDER_CAPABILITY_VERSION,
      dry_run_result_hash: input.dryRunResultHash ?? null,
      execution_window: executionWindow,
    });
  }

  async findMatchingDryRunEvidence(
    context: AiExecutionContextWithManager,
    job: AutomationCatalogJob,
    target: AutomationTargetSelector,
    variables: Record<string, unknown>,
  ): Promise<DryRunMatch> {
    const dryRunFingerprint = this.dryRunFingerprint({ job, target, variables });
    const rows = await this.evidenceRepository(context).find({
      where: {
        tenant_id: context.tenantId,
        source_provider: `automation:${job.providerKey}`,
        source_object_type: 'job_dry_run',
      },
    });
    const evidence = rows.find((row) => {
      const payload = row.payload_json;
      return isRecord(payload)
        && payload.dryRunFingerprint === dryRunFingerprint
        && payload.providerKey === job.providerKey
        && payload.jobKey === job.jobKey
        && payload.catalogVersion === job.catalogVersion
        && payload.status === 'successful';
    });
    if (!evidence) {
      throw codedForbidden('AUTOMATION_DRY_RUN_REQUIRED', 'Matching successful dry-run evidence is required before launch preparation.');
    }
    const payload = evidence.payload_json as Record<string, unknown>;
    const dryRunResultHash = typeof payload.dryRunResultHash === 'string'
      ? payload.dryRunResultHash
      : evidence.content_hash;
    return { evidence, dryRunFingerprint, dryRunResultHash };
  }

  async assertCooldownAllowsPreparation(
    context: AiExecutionContextWithManager,
    input: {
      job: AutomationCatalogJob;
      targetRef: string;
      idempotencyKey: string;
    },
  ): Promise<void> {
    await this.assertCooldown(context, {
      ...input,
      currentActionId: null,
      includePending: true,
    });
  }

  async assertCooldownAllowsExecution(
    context: AiExecutionContextWithManager,
    input: {
      job: AutomationCatalogJob;
      targetRef: string;
      idempotencyKey: string;
      currentActionId: string;
    },
  ): Promise<void> {
    await this.assertCooldown(context, {
      ...input,
      includePending: false,
    });
  }

  private async assertCooldown(
    context: AiExecutionContextWithManager,
    input: {
      job: AutomationCatalogJob;
      targetRef: string;
      idempotencyKey: string;
      currentActionId?: string | null;
      includePending: boolean;
    },
  ): Promise<void> {
    if (input.job.cooldownSeconds <= 0) {
      return;
    }
    const rows = await this.actionRepository(context).find({
      where: {
        tenant_id: context.tenantId,
        capability_name: AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY,
        capability_version: AUTOMATION_PROVIDER_CAPABILITY_VERSION,
        provider_key: input.job.providerKey,
        target_ref: input.targetRef,
      },
    });
    const now = Date.now();
    const cooldownMs = input.job.cooldownSeconds * 1000;
    for (const action of rows) {
      if (action.id === input.currentActionId) {
        continue;
      }
      const metadata = action.metadata_json;
      const automation = isRecord(metadata?.automation) ? metadata.automation as Record<string, unknown> : null;
      if (automation?.job_key !== input.job.jobKey) {
        continue;
      }
      if (input.includePending && ['pending', 'approved'].includes(action.status)) {
        if (action.idempotency_key === input.idempotencyKey) {
          continue;
        }
        throw codedForbidden('AUTOMATION_LAUNCH_PENDING', 'Another automation launch for this job and target is already pending or approved.');
      }
      const executedAt = action.executed_at instanceof Date ? action.executed_at : null;
      if (executedAt && now - executedAt.getTime() < cooldownMs) {
        throw codedForbidden('AGENT_COOLDOWN_ACTIVE', 'Automation job cooldown is active for this target.');
      }
    }
  }

  buildLaunchPayload(input: {
    job: AutomationCatalogJob;
    target: NormalizedAutomationTarget;
    variables: Record<string, unknown>;
    dryRunEvidenceId?: string | null;
    dryRunResultHash?: string | null;
  }): AutomationLaunchActionPayload {
    return {
      providerKey: input.job.providerKey,
      jobKey: input.job.jobKey,
      catalogVersion: input.job.catalogVersion,
      environment: input.job.environment,
      externalJobTemplateRef: input.job.externalJobTemplateRef,
      variables: input.variables,
      target: {
        type: input.target.type,
        values: input.target.values,
      },
      dryRunRequired: input.job.dryRunRequired,
      dryRunEvidenceId: input.dryRunEvidenceId ?? null,
      dryRunResultHash: input.dryRunResultHash ?? null,
      blastRadius: input.target.blastRadius,
      timeoutSeconds: input.job.timeoutSeconds,
      redactionPolicy: input.job.redactionPolicy,
      liveTestSafety: input.job.liveTestSafety,
    };
  }
}
