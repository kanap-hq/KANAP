import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { CapabilityContract, CapabilityContractSchema, CapabilityExecutionContext } from '../capability/capability-contract';
import { AiExternalMcpServer } from '../entities/ai-external-mcp-server.entity';
import { AiExternalMcpToolSnapshot } from '../entities/ai-external-mcp-tool-snapshot.entity';
import { hashStableJson } from '../evidence/ai-evidence.service';
import { parseCredentialRef } from '../providers/adapter-config.service';
import { AdapterErrorCode, AdapterEvidenceSeed, AdapterResult } from '../providers/provider.types';
import { AiExternalMcpMockTransport, ExternalMcpMockToolDefinition } from './ai-external-mcp-mock-transport.service';
import { EMAIL_ADDRESSES } from '../../../common/text-scan';

const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|cookie|session|client_secret)/i;
const EMAIL_RE = EMAIL_ADDRESSES;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi;
const SECRET_ASSIGNMENT_RE = /\b(password|token|secret|api[-_]?key)\s*[:=]\s*[^ \n\r\t]+/gi;
const SERVER_KEY_RE = /^[a-z0-9][a-z0-9_.-]{1,126}$/;
const VALID_TRANSPORTS = new Set(['mock', 'stdio', 'sse', 'streamable_http']);
const ADAPTER_ERROR_CODES = new Set<AdapterErrorCode>([
  'not_configured',
  'disabled',
  'malformed_config',
  'unauthorized',
  'forbidden',
  'not_found',
  'timeout',
  'rate_limited',
  'provider_unavailable',
  'invalid_response',
  'missing_credentials',
  'unsupported_provider_version',
  'unsafe_operation',
  'unknown',
]);
const PHASE7_SUPPORTED_SURFACES = ['internal', 'scheduler', 'alert'] as const;

type ExternalMcpBridgeResult = AdapterResult<{
  serverKey: string;
  toolName: string;
  output: unknown;
}>;

export type SaveExternalMcpServerInput = {
  serverKey: string;
  displayName?: string | null;
  transportKind?: string | null;
  endpointConfig?: Record<string, unknown> | null;
  credentialRef?: Record<string, unknown> | null;
  enabled?: boolean;
  maxEffect?: string | null;
  redactionPolicy?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type SaveExternalMcpToolSnapshotInput = {
  serverKey: string;
  externalToolName: string;
  capabilityName?: string | null;
  capabilityVersion?: string | null;
  toolDescription?: string | null;
  inputSchema: Record<string, unknown>;
  schemaVersion?: string | null;
  enabled?: boolean;
  mcpExposureEnabled?: boolean;
  redactionPolicy?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function containsPlaintextSecret(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsPlaintextSecret(entry));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (SECRET_KEY_RE.test(key) && key !== 'ref' && key !== 'secret_ref') {
      return true;
    }
    return containsPlaintextSecret(entry);
  });
}

function normalizeServerKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SERVER_KEY_RE.test(normalized)) {
    throw new BadRequestException('External MCP server key must be a stable lower-case identifier.');
  }
  return normalized;
}

function normalizeExternalToolName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 128) {
    throw new BadRequestException('External MCP tool name is required.');
  }
  return normalized;
}

function capabilityPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    || 'tool';
}

function stableExternalMcpCapabilityName(serverKey: string, externalToolName: string): string {
  return `external_mcp.${serverKey}.${capabilityPart(externalToolName)}`;
}

function stringArrayField(value: unknown, field: string): string[] {
  const record = asRecord(value);
  const raw = record?.[field];
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`${field} must be an array of strings.`);
  }
  const values = raw.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new BadRequestException(`${field} must be an array of non-empty strings.`);
    }
    return entry.trim();
  });
  return Array.from(new Set(values));
}

function isBridgeResult(value: unknown): value is ExternalMcpBridgeResult {
  const record = asRecord(value);
  if (!record || typeof record.ok !== 'boolean') {
    return false;
  }
  if (record.ok === true) {
    return asRecord(record.data) != null && Array.isArray(record.evidence);
  }
  return typeof record.errorCode === 'string'
    && typeof record.message === 'string'
    && typeof record.retryable === 'boolean';
}

function pathMatches(path: string, redactFields: Set<string>): boolean {
  return redactFields.has(path) || redactFields.has(path.replace(/^\//, ''));
}

function redactString(value: string): string {
  return value
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT_RE, '$1=[REDACTED]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(IPV4_RE, '[REDACTED_IP]');
}

function redactExternalValue(value: unknown, redactFields: Set<string>, path = ''): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactExternalValue(entry, redactFields, `${path}/${index}`));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    const childPath = `${path}/${key}`;
    if (SECRET_KEY_RE.test(key) || pathMatches(childPath, redactFields)) {
      return [key, '[REDACTED]'];
    }
    return [key, redactExternalValue(entry, redactFields, childPath)];
  }));
}

function normalizeAdapterErrorCode(value: unknown): AdapterErrorCode {
  return typeof value === 'string' && ADAPTER_ERROR_CODES.has(value as AdapterErrorCode)
    ? value as AdapterErrorCode
    : 'unknown';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

@Injectable()
export class AiExternalMcpBridgeService {
  constructor(
    @InjectRepository(AiExternalMcpServer)
    private readonly serverRepo: Repository<AiExternalMcpServer>,
    @InjectRepository(AiExternalMcpToolSnapshot)
    private readonly toolSnapshotRepo: Repository<AiExternalMcpToolSnapshot>,
    private readonly mockTransport: AiExternalMcpMockTransport,
  ) {}

  private serverRepository(context: AiExecutionContextWithManager): Repository<AiExternalMcpServer> {
    return context.manager.getRepository(AiExternalMcpServer);
  }

  private toolRepository(context: AiExecutionContextWithManager): Repository<AiExternalMcpToolSnapshot> {
    return context.manager.getRepository(AiExternalMcpToolSnapshot);
  }

  schemaHash(inputSchema: Record<string, unknown>): string {
    return hashStableJson(inputSchema);
  }

  capabilityName(serverKey: string, externalToolName: string): string {
    return stableExternalMcpCapabilityName(normalizeServerKey(serverKey), normalizeExternalToolName(externalToolName));
  }

  async saveServer(
    context: AiExecutionContextWithManager,
    input: SaveExternalMcpServerInput,
  ): Promise<AiExternalMcpServer> {
    this.assertTenantContext(context);
    const serverKey = normalizeServerKey(input.serverKey);
    const transportKind = (input.transportKind ?? 'mock').trim();
    if (!VALID_TRANSPORTS.has(transportKind)) {
      throw new BadRequestException('Unsupported external MCP transport kind.');
    }
    const repo = this.serverRepository(context);
    const existing = await repo.findOne({ where: { tenant_id: context.tenantId, server_key: serverKey } });
    const enabled = input.enabled ?? existing?.enabled ?? false;
    if (enabled && transportKind !== 'mock') {
      throw new ForbiddenException('Live external MCP transports are not enabled in Phase 7.');
    }
    const maxEffect = input.maxEffect ?? existing?.max_effect ?? 'read';
    if (maxEffect !== 'read') {
      throw new BadRequestException('Phase 7 external MCP bridge only supports read-only tools.');
    }
    this.assertNoPlaintextSecrets(input.endpointConfig, 'endpoint_config');
    this.assertNoPlaintextSecrets(input.credentialRef, 'credential_ref');
    this.assertNoPlaintextSecrets(input.metadata, 'metadata');
    const credential = parseCredentialRef(input.credentialRef ?? null);
    if (transportKind !== 'mock' && !credential) {
      throw new BadRequestException('Non-mock external MCP servers require a credential reference.');
    }

    const entity = repo.create({
      ...(existing ?? {}),
      tenant_id: context.tenantId,
      server_key: serverKey,
      display_name: input.displayName ?? existing?.display_name ?? null,
      transport_kind: transportKind,
      endpoint_config_json: input.endpointConfig ?? existing?.endpoint_config_json ?? null,
      credential_ref_json: input.credentialRef ?? existing?.credential_ref_json ?? (transportKind === 'mock' ? { kind: 'none' } : null),
      enabled,
      max_effect: 'read',
      redaction_policy_json: input.redactionPolicy ?? existing?.redaction_policy_json ?? null,
      metadata_json: input.metadata ?? existing?.metadata_json ?? null,
      created_at: existing?.created_at ?? new Date(),
      updated_at: new Date(),
    });
    return repo.save(entity);
  }

  async saveToolSnapshot(
    context: AiExecutionContextWithManager,
    input: SaveExternalMcpToolSnapshotInput,
  ): Promise<AiExternalMcpToolSnapshot> {
    this.assertTenantContext(context);
    const serverKey = normalizeServerKey(input.serverKey);
    const externalToolName = normalizeExternalToolName(input.externalToolName);
    const inputSchema = asRecord(input.inputSchema);
    if (!inputSchema) {
      throw new BadRequestException('External MCP tool input schema must be an object.');
    }
    const server = await this.serverRepository(context).findOne({
      where: { tenant_id: context.tenantId, server_key: serverKey },
    });
    if (!server) {
      throw new NotFoundException('External MCP server registration was not found.');
    }
    const capabilityName = input.capabilityName?.trim() || this.capabilityName(serverKey, externalToolName);
    if (!capabilityName.startsWith('external_mcp.')) {
      throw new BadRequestException('External MCP capability names must use the external_mcp namespace.');
    }
    const capabilityVersion = input.capabilityVersion?.trim() || '1.0.0';
    const schemaVersion = input.schemaVersion?.trim() || capabilityVersion;
    if (input.mcpExposureEnabled) {
      throw new ForbiddenException('External MCP tools are not re-exported through KANAP MCP in Phase 7.');
    }
    this.assertNoPlaintextSecrets(input.metadata, 'metadata');

    const repo = this.toolRepository(context);
    const existing = await repo.findOne({
      where: { tenant_id: context.tenantId, capability_name: capabilityName, capability_version: capabilityVersion },
    });
    const entity = repo.create({
      ...(existing ?? {}),
      tenant_id: context.tenantId,
      server_id: server.id,
      server_key: server.server_key,
      external_tool_name: externalToolName,
      capability_name: capabilityName,
      capability_version: capabilityVersion,
      tool_description: input.toolDescription ?? existing?.tool_description ?? null,
      input_schema_json: inputSchema,
      input_schema_hash: this.schemaHash(inputSchema),
      schema_version: schemaVersion,
      effect: 'read',
      enabled: input.enabled ?? existing?.enabled ?? false,
      mcp_exposure_enabled: false,
      redaction_policy_json: input.redactionPolicy ?? existing?.redaction_policy_json ?? null,
      metadata_json: input.metadata ?? existing?.metadata_json ?? null,
      created_at: existing?.created_at ?? new Date(),
      updated_at: new Date(),
    });
    return repo.save(entity);
  }

  async listMockTools(
    context: AiExecutionContextWithManager,
    serverKeyInput: string,
  ): Promise<ExternalMcpMockToolDefinition[]> {
    this.assertTenantContext(context);
    const serverKey = normalizeServerKey(serverKeyInput);
    const server = await this.serverRepository(context).findOne({
      where: { tenant_id: context.tenantId, server_key: serverKey },
    });
    if (!server) {
      throw new NotFoundException('External MCP server registration was not found.');
    }
    if (server.transport_kind !== 'mock') {
      throw new ForbiddenException('Only mock external MCP discovery is available in Phase 7.');
    }
    return this.mockTransport.listTools(serverKey);
  }

  async listCapabilityContracts(context: AiExecutionContextWithManager): Promise<CapabilityContract[]> {
    this.assertTenantContext(context);
    const snapshots = await this.toolRepository(context).find({
      where: { tenant_id: context.tenantId, enabled: true },
    });
    const contracts: CapabilityContract[] = [];
    for (const snapshot of snapshots) {
      const server = await this.enabledServerForSnapshot(context, snapshot);
      if (!server) {
        continue;
      }
      if (!this.snapshotSchemaHashMatches(snapshot)) {
        continue;
      }
      contracts.push(this.contractFor(server, snapshot));
    }
    return contracts;
  }

  async resolveCapabilityContract(
    context: AiExecutionContextWithManager,
    capabilityName: string,
    capabilityVersion: string,
  ): Promise<CapabilityContract | null> {
    this.assertTenantContext(context);
    const snapshot = await this.toolRepository(context).findOne({
      where: {
        tenant_id: context.tenantId,
        capability_name: capabilityName,
        capability_version: capabilityVersion,
        enabled: true,
      },
    });
    if (!snapshot) {
      return null;
    }
    const server = await this.enabledServerForSnapshot(context, snapshot);
    if (!server) {
      return null;
    }
    return this.contractFor(server, snapshot);
  }

  async executeTool(
    context: AiExecutionContextWithManager,
    contract: CapabilityContract,
    input: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<ExternalMcpBridgeResult> {
    this.assertTenantContext(context);
    if (!PHASE7_SUPPORTED_SURFACES.includes(execution.surface as any)) {
      throw new ForbiddenException('External MCP bridge is not available on this execution surface.');
    }
    if (contract.provider_kind !== 'external_mcp' || contract.effect !== 'read') {
      throw new ForbiddenException('External MCP bridge only executes read-only external MCP capabilities.');
    }
    const snapshot = await this.toolRepository(context).findOne({
      where: {
        tenant_id: context.tenantId,
        capability_name: contract.name,
        capability_version: contract.version,
        enabled: true,
      },
    });
    if (!snapshot) {
      throw new ForbiddenException('External MCP tool is not allowlisted for this tenant.');
    }
    const server = await this.enabledServerForSnapshot(context, snapshot);
    if (!server) {
      throw new ForbiddenException('External MCP server is not enabled for this tenant.');
    }
    this.assertSnapshotStillMatchesContract(server, snapshot, contract);
    if (server.transport_kind !== 'mock') {
      throw new ForbiddenException('Live external MCP transports are not enabled in Phase 7.');
    }
    const callInput = asRecord(input);
    if (!callInput) {
      throw new BadRequestException('External MCP bridge input must be an object.');
    }
    const transportOutput = await this.mockTransport.callTool(server.server_key, snapshot.external_tool_name, callInput);
    if (isBridgeResult(transportOutput)) {
      return this.normalizeTransportOutput(server, snapshot, transportOutput);
    }
    return this.malformedProviderOutput(server, snapshot, transportOutput);
  }

  private assertTenantContext(context: AiExecutionContextWithManager): void {
    if (!context.tenantId) {
      throw new ForbiddenException('Tenant context is required for external MCP bridge execution.');
    }
  }

  private assertNoPlaintextSecrets(value: unknown, field: string): void {
    if (containsPlaintextSecret(value)) {
      throw new BadRequestException(`External MCP ${field} contains plaintext-looking secret fields.`);
    }
  }

  private redactionFields(server: AiExternalMcpServer, snapshot: AiExternalMcpToolSnapshot): string[] {
    return Array.from(new Set([
      ...stringArrayField(server.redaction_policy_json, 'fields'),
      ...stringArrayField(snapshot.redaction_policy_json, 'fields'),
    ]));
  }

  private async enabledServerForSnapshot(
    context: AiExecutionContextWithManager,
    snapshot: AiExternalMcpToolSnapshot,
  ): Promise<AiExternalMcpServer | null> {
    const server = await this.serverRepository(context).findOne({
      where: {
        id: snapshot.server_id,
        tenant_id: context.tenantId,
        server_key: snapshot.server_key,
        enabled: true,
        transport_kind: 'mock',
      },
    });
    return server ?? null;
  }

  private normalizedEvidenceSeed(
    server: AiExternalMcpServer,
    snapshot: AiExternalMcpToolSnapshot,
    input: {
      sourceType: 'external_mcp_tool_output' | 'external_mcp_tool_error';
      summary: string;
      payload: unknown;
    },
  ): AdapterEvidenceSeed {
    return {
      sourceProvider: `external_mcp:${server.server_key}`,
      sourceType: input.sourceType,
      sourceId: snapshot.external_tool_name,
      collectedAt: new Date().toISOString(),
      trustLevel: 'external',
      summary: input.summary,
      redactedPayload: redactExternalValue(input.payload, new Set(this.redactionFields(server, snapshot))),
      rawPayloadRetention: 'redacted',
    };
  }

  private normalizeTransportOutput(
    server: AiExternalMcpServer,
    snapshot: AiExternalMcpToolSnapshot,
    result: ExternalMcpBridgeResult,
  ): ExternalMcpBridgeResult {
    if (result.ok === true) {
      const data = asRecord(result.data) ?? {};
      const output = Object.prototype.hasOwnProperty.call(data, 'output') ? data.output : result.data;
      return {
        ok: true,
        data: {
          serverKey: server.server_key,
          toolName: snapshot.external_tool_name,
          output,
        },
        providerRequestId: stringOrNull(result.providerRequestId),
        warnings: Array.isArray(result.warnings)
          ? result.warnings.filter((warning): warning is string => typeof warning === 'string')
          : undefined,
        evidence: [this.normalizedEvidenceSeed(server, snapshot, {
          sourceType: 'external_mcp_tool_output',
          summary: `External MCP output for ${snapshot.external_tool_name}.`,
          payload: output,
        })],
      };
    }

    const errorCode = normalizeAdapterErrorCode(result.errorCode);
    const message = typeof result.message === 'string' && result.message.trim().length > 0
      ? result.message.trim()
      : 'External MCP provider returned an error.';
    return {
      ok: false,
      errorCode,
      message,
      retryable: result.retryable === true,
      providerRequestId: stringOrNull(result.providerRequestId),
      evidence: [this.normalizedEvidenceSeed(server, snapshot, {
        sourceType: 'external_mcp_tool_error',
        summary: `External MCP provider returned ${errorCode}.`,
        payload: {
          errorCode,
          message,
          retryable: result.retryable === true,
        },
      })],
    };
  }

  private snapshotSchemaHashMatches(snapshot: AiExternalMcpToolSnapshot): boolean {
    return this.schemaHash(snapshot.input_schema_json) === snapshot.input_schema_hash;
  }

  private contractFor(server: AiExternalMcpServer, snapshot: AiExternalMcpToolSnapshot): CapabilityContract {
    const redactionFields = this.redactionFields(server, snapshot);
    return CapabilityContractSchema.parse({
      name: snapshot.capability_name,
      version: snapshot.capability_version,
      description: snapshot.tool_description ?? `Governed external MCP tool ${snapshot.capability_name}.`,
      category: 'external_mcp_bridge',
      provider_kind: 'external_mcp',
      supported_surfaces: [...PHASE7_SUPPORTED_SURFACES],
      input_schema: snapshot.input_schema_json,
      output_schema: { type: 'object' },
      effect: 'read',
      risk_level: 'low',
      max_autonomy_level: 'A1',
      default_approval: 'none',
      approval_strategy: { mode: 'none' },
      evidence: {
        persist_input: false,
        persist_output: true,
        redact_fields: redactionFields,
        retention: 'standard',
      },
      tenant_permissions: ['ai.surface'],
      business_resources: ['external_mcp'],
      timeout_seconds: 30,
      retry_policy: { automatic_retry: false, max_attempts: 1 },
      idempotency: { mode: 'idempotent', key_fields: ['input'] },
      rollback: { supported: false },
      cost: { estimated_unit_cost: null, metered: false },
      redaction_policy: { fields: redactionFields },
      mcp_exposure: { enabled: false, read_only: false },
      live_test_safety: 'mock_only',
      compatibility: { ai_tool_name: null },
    });
  }

  private assertSnapshotStillMatchesContract(
    server: AiExternalMcpServer,
    snapshot: AiExternalMcpToolSnapshot,
    contract: CapabilityContract,
  ): void {
    if (
      snapshot.tenant_id !== server.tenant_id
      || snapshot.server_key !== server.server_key
      || snapshot.capability_name !== contract.name
      || snapshot.capability_version !== contract.version
    ) {
      throw new ForbiddenException('External MCP allowlist snapshot no longer matches the capability contract.');
    }
    if (server.max_effect !== 'read' || snapshot.effect !== 'read') {
      throw new ForbiddenException('External MCP bridge only supports read-only effect in Phase 7.');
    }
    if (snapshot.mcp_exposure_enabled) {
      throw new ForbiddenException('External MCP bridge tools are not exposed through KANAP MCP in Phase 7.');
    }
    const schemaHash = this.schemaHash(snapshot.input_schema_json);
    if (schemaHash !== snapshot.input_schema_hash || this.schemaHash(contract.input_schema) !== snapshot.input_schema_hash) {
      throw new ForbiddenException('External MCP tool schema snapshot no longer matches its stored hash.');
    }
  }

  private malformedProviderOutput(
    server: AiExternalMcpServer,
    snapshot: AiExternalMcpToolSnapshot,
    output: unknown,
  ): ExternalMcpBridgeResult {
    return {
      ok: false,
      errorCode: 'invalid_response',
      message: 'External MCP transport returned malformed output.',
      retryable: false,
      providerRequestId: `mock-mcp-${server.server_key}-${snapshot.external_tool_name}-malformed`,
      evidence: [{
        sourceProvider: `external_mcp:${server.server_key}`,
        sourceType: 'external_mcp_tool_error',
        sourceId: snapshot.external_tool_name,
        collectedAt: new Date().toISOString(),
        trustLevel: 'external',
        summary: 'External MCP transport returned malformed output.',
        redactedPayload: {
          malformed: true,
          output,
        },
        rawPayloadRetention: 'redacted',
      }],
    };
  }
}
