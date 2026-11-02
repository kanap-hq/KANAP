import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiLiveTestTarget } from '../entities/ai-live-test-target.entity';
import { codedForbidden, requestContextMissing } from '../../../auth/module-right-required';

export type LiveTestAllowedEffect = 'read' | 'dry_run' | 'sandbox_write';
export type LiveTestSafetyLabel = 'read_only' | 'dry_run_only' | 'sandbox_only';

export type SaveLiveTestTargetInput = {
  providerKind: string;
  providerKey: string;
  environment: string;
  targetKind: string;
  targetKey: string;
  externalRef: string;
  allowedEffect: LiveTestAllowedEffect;
  safetyLabel: LiveTestSafetyLabel;
  enabled?: boolean;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  redactionPolicy?: Record<string, unknown> | null;
};

export type LiveTargetCriteria = {
  providerKind: string;
  allowedEffect: LiveTestAllowedEffect;
  providerKey?: string | null;
  environment?: string | null;
  targetKind?: string | null;
  targetKey?: string | null;
};

export type LiveTargetSelector = {
  type: string;
  values: string[];
};

const VALID_PROVIDER_KINDS = new Set([
  'ticketing',
  'monitoring',
  'virtualization',
  'directory',
  'automation',
]);
const VALID_ENVIRONMENTS = new Set(['mock', 'lab', 'sandbox', 'staging', 'production']);
const VALID_EFFECTS = new Set(['read', 'dry_run', 'sandbox_write']);
const VALID_SAFETY_LABELS = new Set(['read_only', 'dry_run_only', 'sandbox_only']);
const VALID_TARGET_KINDS = new Set([
  'ticket',
  'alert',
  'sensor',
  'vm',
  'host',
  'user',
  'group',
  'awx_job',
  'awx_target',
]);
const BROAD_VALUES = new Set([
  '',
  '*',
  'all',
  'any',
  'everyone',
  'unrestricted',
  'all_users',
  'all users',
  'domain users',
  'all_hosts',
  'all-hosts',
  'all_devices',
  'all-devices',
  'all_vms',
  'all-vms',
]);
const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|cookie|session|client_secret|credential)/i;
const SECRET_VALUE_RE = /\b(Bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:password|token|secret|api[-_]?key)\s*[:=]\s*[^ \n\r\t]+)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function containsPlaintextSecret(value: unknown): boolean {
  if (typeof value === 'string') {
    return SECRET_VALUE_RE.test(value);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsPlaintextSecret(entry));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (SECRET_KEY_RE.test(key)) {
      return true;
    }
    return containsPlaintextSecret(entry);
  });
}

function normalizeIdentifier(value: string, field: string, max = 128): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > max) {
    throw new BadRequestException(`${field} is required.`);
  }
  const lower = normalized.toLowerCase();
  if (BROAD_VALUES.has(lower) || lower.includes('*')) {
    throw codedForbidden('LIVE_TEST_TARGET_NOT_ALLOWED', `${field} cannot be broad or wildcard-like.`);
  }
  return normalized;
}

function normalizeLower(value: string, field: string, allowed: Set<string>): string {
  const normalized = value.trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new BadRequestException(`${field} is invalid.`);
  }
  return normalized;
}

function assertNoSecrets(value: unknown, field: string): void {
  if (containsPlaintextSecret(value)) {
    throw new BadRequestException(`Live-test target ${field} contains plaintext-looking secret material.`);
  }
}

export function normalizeLiveTargetSelector(metadata: unknown): LiveTargetSelector {
  const metadataRecord = asRecord(metadata);
  const raw = metadataRecord?.target;
  const targetRecord = asRecord(raw);
  if (!targetRecord) {
    throw new BadRequestException('AWX dry-run safe target metadata must include target selector.');
  }
  const rawType = targetRecord.type;
  const rawValues = targetRecord.values;
  if (typeof rawType !== 'string' || !Array.isArray(rawValues)) {
    throw new BadRequestException('AWX dry-run safe target selector is malformed.');
  }
  const type = normalizeIdentifier(rawType, 'metadata.target.type', 64);
  const values = rawValues.map((value, index) => {
    if (typeof value !== 'string') {
      throw new BadRequestException('AWX dry-run safe target selector values must be strings.');
    }
    return normalizeIdentifier(value, `metadata.target.values[${index}]`, 256);
  });
  if (values.length < 1 || values.length > 64) {
    throw new BadRequestException('AWX dry-run safe target selector must include between 1 and 64 values.');
  }
  return { type, values };
}

function safetyAllowsEffect(effect: LiveTestAllowedEffect, safetyLabel: LiveTestSafetyLabel): boolean {
  if (effect === 'read') {
    return safetyLabel === 'read_only' || safetyLabel === 'sandbox_only';
  }
  if (effect === 'dry_run') {
    return safetyLabel === 'dry_run_only' || safetyLabel === 'sandbox_only';
  }
  return safetyLabel === 'sandbox_only';
}

@Injectable()
export class AiLiveTestTargetService {
  constructor(
    @InjectRepository(AiLiveTestTarget)
    private readonly liveTargetRepo: Repository<AiLiveTestTarget>,
  ) {}

  private repository(context: AiExecutionContextWithManager): Repository<AiLiveTestTarget> {
    return context.manager.getRepository(AiLiveTestTarget);
  }

  validateInput(input: SaveLiveTestTargetInput): SaveLiveTestTargetInput {
    const providerKind = normalizeLower(input.providerKind, 'providerKind', VALID_PROVIDER_KINDS);
    const providerKey = normalizeIdentifier(input.providerKey, 'providerKey');
    const environment = normalizeLower(input.environment, 'environment', VALID_ENVIRONMENTS);
    const targetKind = normalizeLower(input.targetKind, 'targetKind', VALID_TARGET_KINDS);
    const targetKey = normalizeIdentifier(input.targetKey, 'targetKey');
    const externalRef = normalizeIdentifier(input.externalRef, 'externalRef', 512);
    const allowedEffect = normalizeLower(input.allowedEffect, 'allowedEffect', VALID_EFFECTS) as LiveTestAllowedEffect;
    const safetyLabel = normalizeLower(input.safetyLabel, 'safetyLabel', VALID_SAFETY_LABELS) as LiveTestSafetyLabel;
    if (!safetyAllowsEffect(allowedEffect, safetyLabel)) {
      throw codedForbidden('LIVE_TEST_TARGET_NOT_ALLOWED', 'Live-test target safety label does not allow the requested effect.');
    }
    if (allowedEffect !== 'read' && environment === 'production') {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Production live-test targets cannot allow dry-run or sandbox write effects in Phase 8.');
    }
    assertNoSecrets(input.metadata, 'metadata');
    assertNoSecrets(input.redactionPolicy, 'redaction policy');
    const metadataRecord = asRecord(input.metadata);
    if (input.metadata != null && !metadataRecord) {
      throw new BadRequestException('Live-test target metadata must be a JSON object.');
    }
    const redactionPolicy = asRecord(input.redactionPolicy);
    if (input.redactionPolicy != null && !redactionPolicy) {
      throw new BadRequestException('Live-test target redaction policy must be a JSON object.');
    }
    let metadata = metadataRecord;
    if (providerKind === 'automation' && allowedEffect === 'dry_run' && targetKind === 'awx_job') {
      const selector = normalizeLiveTargetSelector(metadataRecord);
      metadata = {
        ...metadataRecord,
        target: selector,
      };
    }
    return {
      ...input,
      providerKind,
      providerKey,
      environment,
      targetKind,
      targetKey,
      externalRef,
      allowedEffect,
      safetyLabel,
      metadata,
      redactionPolicy,
    };
  }

  async saveTarget(
    context: AiExecutionContextWithManager,
    input: SaveLiveTestTargetInput,
  ): Promise<AiLiveTestTarget> {
    if (!context.tenantId) {
      throw requestContextMissing('Tenant context is required for live-test target storage.');
    }
    const normalized = this.validateInput(input);
    const repo = this.repository(context);
    const existing = await repo.findOne({
      where: {
        tenant_id: context.tenantId,
        provider_kind: normalized.providerKind,
        provider_key: normalized.providerKey,
        environment: normalized.environment,
        target_kind: normalized.targetKind,
        target_key: normalized.targetKey,
      },
    });
    return repo.save(repo.create({
      ...(existing ?? {}),
      tenant_id: context.tenantId,
      provider_kind: normalized.providerKind,
      provider_key: normalized.providerKey,
      environment: normalized.environment,
      target_kind: normalized.targetKind,
      target_key: normalized.targetKey,
      external_ref: normalized.externalRef,
      allowed_effect: normalized.allowedEffect,
      safety_label: normalized.safetyLabel,
      enabled: normalized.enabled ?? existing?.enabled ?? false,
      expires_at: normalized.expiresAt ?? existing?.expires_at ?? null,
      metadata_json: normalized.metadata ?? existing?.metadata_json ?? null,
      redaction_policy_json: normalized.redactionPolicy ?? existing?.redaction_policy_json ?? null,
      created_at: existing?.created_at ?? new Date(),
      updated_at: new Date(),
    }));
  }

  async findEnabledTargets(
    context: AiExecutionContextWithManager,
    criteria: LiveTargetCriteria,
  ): Promise<AiLiveTestTarget[]> {
    if (!context.tenantId) {
      throw requestContextMissing('Tenant context is required for live-test target lookup.');
    }
    const rows = await this.repository(context).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: criteria.providerKind,
        allowed_effect: criteria.allowedEffect,
        enabled: true,
      },
    });
    const now = Date.now();
    return rows.filter((row) => {
      if (criteria.providerKey && row.provider_key !== criteria.providerKey) {
        return false;
      }
      if (criteria.environment && row.environment !== criteria.environment) {
        return false;
      }
      if (criteria.targetKind && row.target_kind !== criteria.targetKind) {
        return false;
      }
      if (criteria.targetKey && row.target_key !== criteria.targetKey) {
        return false;
      }
      if (row.expires_at && row.expires_at.getTime() <= now) {
        return false;
      }
      return true;
    });
  }

  async requireSingleEnabledTarget(
    context: AiExecutionContextWithManager,
    criteria: LiveTargetCriteria,
  ): Promise<AiLiveTestTarget> {
    const matches = await this.findEnabledTargets(context, criteria);
    if (matches.length === 0) {
      throw new NotFoundException('No enabled safe live-test target matches the requested provider/effect.');
    }
    if (matches.length > 1) {
      throw codedForbidden('LIVE_TEST_TARGET_AMBIGUOUS', 'Live-test target selection is ambiguous; specify a provider key or target key.');
    }
    return matches[0];
  }
}
