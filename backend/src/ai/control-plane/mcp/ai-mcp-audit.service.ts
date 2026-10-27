import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { AiExecutionContextWithManager } from '../../ai.types';
import { redirectHost } from '../../oauth/mcp-oauth.util';
import { redactSensitiveValue } from '../evidence/ai-evidence.service';

/**
 * The MCP journal: every tool call a client made through `POST /ai/mcp`, completed, refused or
 * failed, read by the administrators (Administration › Plaid) and by a key holding
 * `mcp:audit:read` (its own calls only).
 *
 * A completed call (and a failure the tool reports in its own output) is the dispatcher's run and
 * tool execution. A call refused or failed before or during the dispatch leaves nothing behind (the
 * request transaction rolls back): `recordCall` writes it afterwards, in a transaction of its own,
 * in the same two tables, with the cause in `metadata_json.refusal_reason`. The same goes for a
 * request made with a known key that is revoked or expired, or whose owner may no longer use it.
 * Argument values are kept redacted and truncated; a key or a token never enters the journal.
 */

/** Why a call was refused: the client could not run this tool, or not with these arguments. */
export const MCP_REFUSAL_REASONS = [
  'unknown_tool',
  'read_only',
  'key_policy',
  'permission',
  'disabled',
  'invalid_input',
  'key_revoked',
  'key_expired',
  'owner_not_allowed',
] as const;
/** Why an accepted call failed. */
export const MCP_FAILURE_REASONS = ['not_found', 'error'] as const;

export type McpRefusalReason = typeof MCP_REFUSAL_REASONS[number];
export type McpFailureReason = typeof MCP_FAILURE_REASONS[number];
export type McpCallReason = McpRefusalReason | McpFailureReason;

/** The result the journal shows; `failed` covers every status other than these three. */
export const MCP_AUDIT_RESULTS = ['completed', 'refused', 'failed'] as const;
export type McpAuditResult = typeof MCP_AUDIT_RESULTS[number] | 'running';

export function isMcpRefusalReason(reason: string): reason is McpRefusalReason {
  return (MCP_REFUSAL_REASONS as readonly string[]).includes(reason);
}

export type AiMcpCallRecord = {
  /** The tool the client named, or the JSON-RPC method of a request refused before any tool. */
  toolName: string;
  arguments?: unknown;
  reason: McpCallReason;
  /** What the client read, without secret. */
  message: string;
  effect?: string | null;
  capabilityVersion?: string | null;
  durationMs?: number | null;
  userId?: string | null;
  apiKeyId?: string | null;
  requestId?: string | null;
};

export type AiMcpAuditFilters = {
  apiKeyId?: string | null;
  userId?: string | null;
  runId?: string | null;
  toolExecutionId?: string | null;
  capabilityName?: string | null;
  status?: string | null;
  result?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type AiMcpAuditItem = {
  run_id: string;
  tool_execution_id: string;
  tenant_id: string;
  ai_api_key_id: string | null;
  user_id: string | null;
  user_name: string | null;
  key_label: string | null;
  key_kind: string | null;
  oauth_client_name: string | null;
  /** The host of a connection's redirect URI (`claude.ai`), which tells two clients of the same name apart. */
  oauth_redirect_host: string | null;
  capability_name: string;
  capability_version: string;
  status: string;
  result: McpAuditResult;
  reason: string | null;
  /** What the client read when the call was refused or failed, keys and tokens hidden. */
  error_message: string | null;
  effect: string;
  duration_ms: number | null;
  run_created_at: string;
  tool_created_at: string;
  completed_at: string | null;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  evidence_ids: string[];
};

export type AiMcpAuditFacets = {
  people: Array<{ id: string; name: string | null }>;
  keys: Array<{
    id: string;
    label: string;
    credential_kind: string;
    oauth_client_name: string | null;
    oauth_redirect_host: string | null;
    user_id: string;
    revoked: boolean;
  }>;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 100_000;
const MAX_TOOL_NAME_CHARS = 160;
const MAX_MESSAGE_CHARS = 1_000;
const MAX_ARGUMENT_STRING_CHARS = 200;
const MAX_ARGUMENT_ENTRIES = 20;
const MAX_ARGUMENT_DEPTH = 4;
const MAX_ARGUMENTS_JSON_CHARS = 2_000;
// A KANAP key or OAuth refresh token (`kanap_mcp_…`, `kanap_mcprt_…`), or a JWT (an OAuth access
// token or authorization code), wherever it appears in a value.
const CREDENTIAL_PATTERNS = [
  /kanap_mcp[a-z]*_[A-Za-z0-9_-]+/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g,
];
// Argument names whose values the journal drops, on top of the evidence rule (api key, token,
// secret, password, authorization, cookie, session).
const SENSITIVE_ARGUMENT_NAME = /(passw|pwd|passphrase|credential|private[-_]?key|access[-_]?key|bearer|jwt|^auth$)/i;

function hideCredentials(value: string): string {
  return CREDENTIAL_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function previewValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return truncate(hideCredentials(value), MAX_ARGUMENT_STRING_CHARS);
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (depth >= MAX_ARGUMENT_DEPTH) {
    return '[...]';
  }
  if (Array.isArray(value)) {
    const entries = value.slice(0, MAX_ARGUMENT_ENTRIES).map((entry) => previewValue(entry, depth + 1));
    if (value.length > MAX_ARGUMENT_ENTRIES) {
      entries.push(`[${value.length - MAX_ARGUMENT_ENTRIES} more]`);
    }
    return entries;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const kept = entries
      .slice(0, MAX_ARGUMENT_ENTRIES)
      .map(([key, entry]) => [
        truncate(hideCredentials(key), 80),
        SENSITIVE_ARGUMENT_NAME.test(key) ? '[REDACTED]' : previewValue(entry, depth + 1),
      ]);
    if (entries.length > MAX_ARGUMENT_ENTRIES) {
      kept.push(['[more]', entries.length - MAX_ARGUMENT_ENTRIES]);
    }
    return Object.fromEntries(kept);
  }
  return truncate(hideCredentials(String(value)), MAX_ARGUMENT_STRING_CHARS);
}

/**
 * The arguments of an MCP call as the journal keeps them: values included, secrets and emails
 * redacted (same rule as the evidence), keys and tokens hidden, each string cut at 200 characters
 * and the whole at about 2,000.
 */
export function mcpArgumentPreview(value: unknown): unknown {
  const preview = previewValue(redactSensitiveValue(value), 0);
  const json = JSON.stringify(preview) ?? 'null';
  if (json.length <= MAX_ARGUMENTS_JSON_CHARS) {
    return preview;
  }
  return { truncated: true, preview: `${json.slice(0, MAX_ARGUMENTS_JSON_CHARS - 3)}...` };
}

function hostOf(uri: unknown): string | null {
  return typeof uri === 'string' && uri ? redirectHost(uri) || null : null;
}

function resultOf(status: string): McpAuditResult {
  if (status === 'completed' || status === 'refused' || status === 'running') {
    return status;
  }
  return 'failed';
}

@Injectable()
export class AiMcpAuditService {
  /** Writes one refused or failed call. The caller runs it in a transaction of its own. */
  async recordCall(
    context: { tenantId: string; manager: EntityManager },
    record: AiMcpCallRecord,
  ): Promise<void> {
    const status = isMcpRefusalReason(record.reason) ? 'refused' : 'failed';
    const message = truncate(hideCredentials(record.message), MAX_MESSAGE_CHARS);
    const metadata = JSON.stringify({ ai_api_key_id: record.apiKeyId ?? null, refusal_reason: record.reason });
    const inputSummary = JSON.stringify({ arguments: mcpArgumentPreview(record.arguments ?? {}) });
    const toolName = truncate(hideCredentials(String(record.toolName || 'unknown')), MAX_TOOL_NAME_CHARS);
    const rows = await context.manager.query(
      `INSERT INTO ai_runs (
         tenant_id, user_id, request_id, ai_api_key_id, invocation_channel, trigger_kind, status,
         input_summary, output_summary, metadata_json, completed_at
       ) VALUES ($1, $2, $3, $4, 'mcp', 'mcp_client', $5, $6::jsonb, $7::jsonb, $8::jsonb, now())
       RETURNING id`,
      [
        context.tenantId,
        record.userId || null,
        record.requestId ?? null,
        record.apiKeyId || null,
        status,
        inputSummary,
        JSON.stringify({ error: message }),
        metadata,
      ],
    );
    await context.manager.query(
      `INSERT INTO ai_tool_executions (
         tenant_id, run_id, capability_name, capability_version, surface, effect, status,
         input_summary, error_message, duration_ms, metadata_json, completed_at
       ) VALUES ($1, $2, $3, $4, 'mcp', $5, $6, $7::jsonb, $8, $9, $10::jsonb, now())`,
      [
        context.tenantId,
        rows[0].id,
        toolName,
        record.capabilityVersion ?? '',
        record.effect ?? 'unknown',
        status,
        inputSummary,
        message,
        record.durationMs == null ? null : Math.max(0, Math.round(record.durationMs)),
        metadata,
      ],
    );
  }

  async list(
    context: AiExecutionContextWithManager,
    filters?: AiMcpAuditFilters,
  ): Promise<{ items: AiMcpAuditItem[]; limit: number; offset: number; has_more: boolean }> {
    const normalized = this.normalizeFilters(filters ?? {});
    const params: unknown[] = [context.tenantId];
    const clauses = [
      'tool.tenant_id = $1',
      "tool.surface = 'mcp'",
      "run.invocation_channel = 'mcp'",
    ];
    const add = (sql: (placeholder: string) => string, value: unknown) => {
      params.push(value);
      clauses.push(sql(`$${params.length}`));
    };

    if (normalized.apiKeyId) add((p) => `run.ai_api_key_id = ${p}`, normalized.apiKeyId);
    if (normalized.userId) add((p) => `run.user_id = ${p}`, normalized.userId);
    if (normalized.runId) add((p) => `run.id = ${p}`, normalized.runId);
    if (normalized.toolExecutionId) add((p) => `tool.id = ${p}`, normalized.toolExecutionId);
    if (normalized.capabilityName) add((p) => `tool.capability_name = ${p}`, normalized.capabilityName);
    if (normalized.status) add((p) => `tool.status = ${p}`, normalized.status);
    if (normalized.result === 'failed') {
      clauses.push("tool.status NOT IN ('completed', 'refused', 'running')");
    } else if (normalized.result) {
      add((p) => `tool.status = ${p}`, normalized.result);
    }
    if (normalized.from) add((p) => `tool.created_at >= ${p}`, normalized.from);
    if (normalized.to) add((p) => `tool.created_at < ${p}`, normalized.to);
    params.push(normalized.limit + 1);
    const limitParam = `$${params.length}`;
    params.push(normalized.offset);
    const offsetParam = `$${params.length}`;

    const rows = await context.manager.query(
      `
        SELECT
          run.id::text AS run_id,
          tool.id::text AS tool_execution_id,
          tool.tenant_id::text AS tenant_id,
          run.ai_api_key_id::text AS ai_api_key_id,
          run.user_id::text AS user_id,
          COALESCE(NULLIF(btrim(concat_ws(' ', person.first_name, person.last_name)), ''), person.email) AS user_name,
          api_key.label AS key_label,
          api_key.credential_kind AS key_kind,
          api_key.oauth_client_name,
          api_key.oauth_redirect_uri,
          tool.capability_name,
          tool.capability_version,
          tool.status,
          tool.metadata_json->>'refusal_reason' AS reason,
          tool.error_message,
          tool.effect,
          tool.duration_ms,
          run.created_at AS run_created_at,
          tool.created_at AS tool_created_at,
          tool.completed_at,
          tool.input_summary,
          tool.output_summary,
          COALESCE(
            (
              SELECT array_agg(evidence.id::text ORDER BY evidence.created_at)
              FROM ai_evidence evidence
              WHERE evidence.tool_execution_id = tool.id
                AND evidence.tenant_id = tool.tenant_id
            ),
            ARRAY[]::text[]
          ) AS evidence_ids
        FROM ai_tool_executions tool
        JOIN ai_runs run
          ON run.id = tool.run_id
         AND run.tenant_id = tool.tenant_id
        LEFT JOIN users person
          ON person.id = run.user_id
         AND person.tenant_id = run.tenant_id
        LEFT JOIN ai_api_keys api_key
          ON api_key.id = run.ai_api_key_id
         AND api_key.tenant_id = run.tenant_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY tool.created_at DESC, tool.id DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      params,
    );

    const page = rows.slice(0, normalized.limit);
    return {
      items: page.map((row: any) => ({
        run_id: String(row.run_id),
        tool_execution_id: String(row.tool_execution_id),
        tenant_id: String(row.tenant_id),
        ai_api_key_id: row.ai_api_key_id ? String(row.ai_api_key_id) : null,
        user_id: row.user_id ? String(row.user_id) : null,
        user_name: row.user_name ? String(row.user_name) : null,
        key_label: row.key_label ? String(row.key_label) : null,
        key_kind: row.key_kind ? String(row.key_kind) : null,
        oauth_client_name: row.oauth_client_name ? String(row.oauth_client_name) : null,
        oauth_redirect_host: hostOf(row.oauth_redirect_uri),
        capability_name: String(row.capability_name),
        capability_version: String(row.capability_version ?? ''),
        status: String(row.status),
        result: resultOf(String(row.status)),
        reason: row.reason ? String(row.reason) : null,
        error_message: row.error_message
          ? truncate(hideCredentials(String(row.error_message)), MAX_MESSAGE_CHARS)
          : null,
        effect: String(row.effect),
        duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
        run_created_at: new Date(row.run_created_at).toISOString(),
        tool_created_at: new Date(row.tool_created_at).toISOString(),
        completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        input_summary: row.input_summary ?? null,
        output_summary: row.output_summary ?? null,
        evidence_ids: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [],
      })),
      limit: normalized.limit,
      offset: normalized.offset,
      has_more: rows.length > normalized.limit,
    };
  }

  /** The people and the keys or connections the journal filters on: every MCP credential of the tenant. */
  async listFacets(context: AiExecutionContextWithManager): Promise<AiMcpAuditFacets> {
    const rows = await context.manager.query(
      `
        SELECT
          api_key.id::text AS id,
          api_key.label,
          api_key.credential_kind,
          api_key.oauth_client_name,
          api_key.oauth_redirect_uri,
          api_key.revoked_at,
          api_key.user_id::text AS user_id,
          COALESCE(NULLIF(btrim(concat_ws(' ', person.first_name, person.last_name)), ''), person.email) AS user_name
        FROM ai_api_keys api_key
        LEFT JOIN users person
          ON person.id = api_key.user_id
         AND person.tenant_id = api_key.tenant_id
        WHERE api_key.tenant_id = $1
        ORDER BY api_key.created_at DESC
        LIMIT 500
      `,
      [context.tenantId],
    );
    const people = new Map<string, string | null>();
    for (const row of rows) {
      if (!people.has(row.user_id)) people.set(String(row.user_id), row.user_name ? String(row.user_name) : null);
    }
    return {
      people: Array.from(people, ([id, name]) => ({ id, name }))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
      keys: rows.map((row: any) => ({
        id: String(row.id),
        label: String(row.label),
        credential_kind: String(row.credential_kind ?? 'api_key'),
        oauth_client_name: row.oauth_client_name ? String(row.oauth_client_name) : null,
        oauth_redirect_host: hostOf(row.oauth_redirect_uri),
        user_id: String(row.user_id),
        revoked: !!row.revoked_at,
      })),
    };
  }

  private normalizeFilters(filters: AiMcpAuditFilters) {
    const limit = filters.limit == null ? DEFAULT_LIMIT : Number(filters.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
    }
    const offset = filters.offset == null ? 0 : Number(filters.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
      throw new BadRequestException(`offset must be an integer from 0 to ${MAX_OFFSET}.`);
    }
    const result = this.optionalToken(filters.result, 'result');
    if (result && !(MCP_AUDIT_RESULTS as readonly string[]).includes(result)) {
      throw new BadRequestException(`result must be one of ${MCP_AUDIT_RESULTS.join(', ')}.`);
    }
    return {
      apiKeyId: this.optionalUuid(filters.apiKeyId, 'api_key_id'),
      userId: this.optionalUuid(filters.userId, 'user_id'),
      runId: this.optionalUuid(filters.runId, 'run_id'),
      toolExecutionId: this.optionalUuid(filters.toolExecutionId, 'tool_execution_id'),
      capabilityName: this.optionalToken(filters.capabilityName, 'capability_name'),
      status: this.optionalToken(filters.status, 'status'),
      result,
      from: this.optionalDate(filters.from, 'from'),
      to: this.optionalDate(filters.to, 'to'),
      limit,
      offset,
    };
  }

  private optionalUuid(value: unknown, field: string): string | null {
    if (value == null || value === '') {
      return null;
    }
    const normalized = String(value).trim();
    if (!isUuid(normalized)) {
      throw new BadRequestException(`${field} must be a UUID.`);
    }
    return normalized;
  }

  private optionalToken(value: unknown, field: string): string | null {
    if (value == null || value === '') {
      return null;
    }
    const normalized = String(value).trim();
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(normalized)) {
      throw new BadRequestException(`${field} contains unsupported characters.`);
    }
    return normalized;
  }

  private optionalDate(value: unknown, field: string): string | null {
    if (value == null || value === '') {
      return null;
    }
    const time = Date.parse(String(value));
    if (!Number.isFinite(time)) {
      throw new BadRequestException(`${field} must be a date (ISO 8601).`);
    }
    return new Date(time).toISOString();
  }
}
