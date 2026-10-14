import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiEvidence } from '../entities/ai-evidence.entity';
import { AdapterEvidenceSeed } from '../providers/provider.types';
import { EMAIL_ADDRESSES } from '../../../common/text-scan';

const MAX_SUMMARY_CHARS = 2000;
const MAX_PAYLOAD_JSON_CHARS = 24000;
const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|cookie|session)/i;
const EMAIL_RE = EMAIL_ADDRESSES;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi;
const SECRET_ASSIGNMENT_RE = /\b(password|token|secret|api[-_]?key)\s*[:=]\s*[^ \n\r\t]+/gi;

export type AiEvidenceSeed = {
  runId?: string | null;
  toolExecutionId?: string | null;
  actionRequestId?: string | null;
  sourceProvider: string;
  sourceObjectType: string;
  sourceObjectId?: string | null;
  sourceUri?: string | null;
  trustLevel?: string | null;
  summary?: string | null;
  payload?: unknown;
  retentionClass?: string | null;
  redactFields?: string[];
  collectedAt?: Date;
};

// Must match JSON.stringify semantics (undefined-valued keys dropped, toJSON
// honored, undefined array entries as null) so that hashes computed over
// in-memory values still match after the value is persisted to JSONB and
// loaded back. Divergence here breaks input-hash integrity checks on stored
// action requests.
export function stableStringify(value: unknown): string {
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return stableStringify((value as { toJSON: () => unknown }).toJSON());
  }
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? 'null' : stableStringify(entry))).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function hashStableJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function redactString(value: string): string {
  return value
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT_RE, '$1=[REDACTED]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(IPV4_RE, '[REDACTED_IP]');
}

function pathMatches(path: string, redactFields: Set<string>): boolean {
  return redactFields.has(path) || redactFields.has(path.replace(/^\//, ''));
}

function redactValue(value: unknown, redactFields: Set<string>, path = ''): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, redactFields, `${path}/${index}`));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    const childPath = `${path}/${key}`;
    if (SECRET_KEY_RE.test(key) || pathMatches(childPath, redactFields)) {
      return [key, '[REDACTED]'];
    }
    return [key, redactValue(entry, redactFields, childPath)];
  }));
}

function truncateText(value: string, max = MAX_SUMMARY_CHARS): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function summarizePayload(value: unknown): string {
  if (value == null) {
    return 'No payload.';
  }
  if (typeof value === 'string') {
    return truncateText(value);
  }
  if (Array.isArray(value)) {
    return truncateText(`Array with ${value.length} item(s): ${stableStringify(value.slice(0, 3))}`);
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).slice(0, 20);
    return truncateText(`Object keys: ${keys.join(', ') || 'none'}`);
  }
  return truncateText(String(value));
}

@Injectable()
export class AiEvidenceService {
  constructor(
    @InjectRepository(AiEvidence)
    private readonly evidenceRepo: Repository<AiEvidence>,
  ) {}

  redact(value: unknown, redactFields: string[] = []): unknown {
    return redactValue(value, new Set(redactFields));
  }

  hash(value: unknown): string {
    return hashStableJson(value);
  }

  summarize(value: unknown): Record<string, unknown> {
    const redacted = this.redact(value);
    return {
      hash: this.hash(redacted),
      summary: summarizePayload(redacted),
    };
  }

  async recordEvidence(
    context: AiExecutionContextWithManager,
    seed: AiEvidenceSeed,
    manager?: EntityManager,
  ): Promise<AiEvidence> {
    const repo = (manager ?? context.manager).getRepository(AiEvidence);
    const redactedPayload = this.redact(seed.payload ?? null, seed.redactFields ?? []);
    const serialized = stableStringify(redactedPayload);
    const payloadJson = serialized.length <= MAX_PAYLOAD_JSON_CHARS
      ? redactedPayload as Record<string, unknown> | unknown[] | null
      : null;
    const evidence = repo.create({
      tenant_id: context.tenantId,
      run_id: seed.runId ?? null,
      tool_execution_id: seed.toolExecutionId ?? null,
      action_request_id: seed.actionRequestId ?? null,
      source_provider: seed.sourceProvider,
      source_object_type: seed.sourceObjectType,
      source_object_id: seed.sourceObjectId ?? null,
      source_uri: seed.sourceUri ?? null,
      trust_level: seed.trustLevel ?? 'system',
      redaction_status: 'redacted',
      content_hash: this.hash(redactedPayload),
      summary: truncateText(seed.summary ?? summarizePayload(redactedPayload)),
      payload_json: payloadJson,
      retention_class: seed.retentionClass ?? 'standard',
      collected_at: seed.collectedAt ?? new Date(),
    });
    return repo.save(evidence);
  }

  async recordAdapterEvidenceSeeds(
    context: AiExecutionContextWithManager,
    seeds: AdapterEvidenceSeed[],
    options: {
      runId?: string | null;
      toolExecutionId?: string | null;
      actionRequestId?: string | null;
      retentionClass?: string | null;
      redactFields?: string[];
    } = {},
    manager?: EntityManager,
  ): Promise<AiEvidence[]> {
    const rows: AiEvidence[] = [];
    for (const seed of seeds) {
      rows.push(await this.recordEvidence(context, {
        runId: options.runId ?? null,
        toolExecutionId: options.toolExecutionId ?? null,
        actionRequestId: options.actionRequestId ?? null,
        sourceProvider: seed.sourceProvider,
        sourceObjectType: seed.sourceType,
        sourceObjectId: seed.sourceId ?? null,
        sourceUri: seed.sourceUri ?? null,
        trustLevel: seed.trustLevel,
        summary: seed.summary,
        payload: seed.redactedPayload ?? null,
        retentionClass: seed.rawPayloadRetention ?? options.retentionClass ?? 'standard',
        redactFields: options.redactFields ?? [],
        collectedAt: new Date(seed.collectedAt),
      }, manager));
    }
    return rows;
  }
}
