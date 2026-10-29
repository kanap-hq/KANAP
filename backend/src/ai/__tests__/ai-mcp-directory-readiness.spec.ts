import * as assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { AiToolRegistry } from '../ai-tool.registry';
import { AiApiKeysService, McpKeyRefusedException } from '../ai-api-keys.service';
import { McpApiKeyAuthGuard } from '../auth/mcp-api-key-auth.guard';
import { McpApiKeyHashService } from '../auth/mcp-api-key-hash.service';
import { AiCapabilityRegistry } from '../control-plane/capability/ai-capability.registry';
import { AiEvidenceService } from '../control-plane/evidence/ai-evidence.service';
import { MCP_SCOPE_TOOLS_LIST } from '../control-plane/mcp/ai-mcp-access-policy';
import { AiMcpCallRecord, mcpArgumentPreview } from '../control-plane/mcp/ai-mcp-audit.service';
import { AiMcpExposureService } from '../control-plane/mcp/ai-mcp-exposure.service';
import { AiMcpRateLimiter, McpRateLimitedException } from '../control-plane/mcp/ai-mcp-rate-limiter.service';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { Features } from '../../config/features';

// The MCP surface the Anthropic connector directory reviews (brief plaid-mcp-annuaire): the tools of
// a standard key, the refusals that say why, the Retry-After of a 429, a double revocation that
// changes nothing, the argument values the journal keeps, and the journal line of a refused key.
// Over HTTP: ai-mcp-transport.spec.ts. Against the database: ai-mcp-journal.integration.spec.ts.

const CORE_TOOLS = [
  'search_all',
  'describe_entity_filters',
  'query_entities',
  'aggregate_entities',
  'get_filter_values',
  'get_application_classification_catalog',
  'get_entity_detail',
  'get_entity_context',
  'get_entity_comments',
  'get_record_history',
  'search_knowledge',
  'get_document',
];

function standardKey(overrides: Record<string, unknown> = {}) {
  // What POST /ai/keys stores without settings (ai-api-key.entity.ts defaults), as the guard passes it.
  return {
    id: 'key-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    mcp_scopes: ['mcp:tools:list', 'mcp:tools:execute'],
    mcp_allowed_capabilities: ['kanap.read.core'],
    mcp_denied_capabilities: [],
    mcp_max_effect: 'read',
    mcp_rate_limit_per_minute: 60,
    ...overrides,
  };
}

function realExposure(settings: { webSearch: boolean; knowledge?: boolean }) {
  const policy = {
    assertSurfaceAccess: async () => undefined,
    listReadableEntityTypes: async (_ctx: unknown, types: string[]) => types,
    canReadKnowledge: async () => settings.knowledge ?? true,
    assertWriteAccess: async () => { throw new Error('no write'); },
    assertBusinessPermission: async () => undefined,
  };
  const tools = new AiToolRegistry(
    {} as any, {} as any, policy as any, {} as any, {} as any,
    { find: async () => ({ web_search_enabled: settings.webSearch }) } as any,
    {} as any,
    { hasExecutedUndoablePreviewInConversation: async () => false } as any,
    { listOperations: () => [], getOperationOrNull: () => null } as any,
    undefined,
    { getRecordHistory: async () => ({ items: [] }) } as any,
  );
  const registry = new AiCapabilityRegistry(tools, {} as any, {} as any, {} as any, {} as any, {} as any);
  return new AiMcpExposureService(registry, policy as any);
}

const mcpContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  isPlatformHost: false,
  surface: 'mcp' as const,
  authMethod: 'api_key' as const,
  requestId: null,
  aiApiKeyId: 'key-1',
  manager: {} as any,
};

async function withWebSearchReady<T>(ready: boolean, fn: () => Promise<T>): Promise<T> {
  const previous = Features.AI_WEB_SEARCH_READY;
  (Features as any).AI_WEB_SEARCH_READY = ready;
  try {
    return await fn();
  } finally {
    (Features as any).AI_WEB_SEARCH_READY = previous;
  }
}

// P3-1: a standard key (the group kanap.read.core, as every key stores it) lists twelve tools, the
// classification catalog and the record history (Plaid L7) included, and thirteen with web search.
// No key holds the list itself.
async function testStandardKeyListsTwelveToolsThirteenWithWebSearch() {
  const withoutWeb = await withWebSearchReady(true, () =>
    realExposure({ webSearch: false }).listToolJsonSchemas(mcpContext, standardKey(), MCP_SCOPE_TOOLS_LIST));
  assert.deepEqual(withoutWeb.map((tool) => tool.name).sort(), [...CORE_TOOLS].sort());
  assert.equal(withoutWeb.length, 12);

  const withWeb = await withWebSearchReady(true, () =>
    realExposure({ webSearch: true }).listToolJsonSchemas(mcpContext, standardKey(), MCP_SCOPE_TOOLS_LIST));
  assert.deepEqual(withWeb.map((tool) => tool.name).sort(), [...CORE_TOOLS, 'web_search'].sort());
  assert.equal(withWeb.length, 13);
}

// P3-8: the cause of a refusal, from what KANAP declares.
async function testRefusalExplanationsFromTheRealRegistry() {
  const exposure = realExposure({ webSearch: false });
  const explain = (name: string, key = standardKey()) => exposure.explainRefusal(key, name);

  assert.equal(explain('does_not_exist').reason, 'unknown_tool');
  assert.match(explain('does_not_exist').message, /^Unknown tool: does_not_exist\./);
  assert.equal(explain('prepare_mutation_plan').reason, 'read_only');
  assert.match(explain('prepare_mutation_plan').message, /^This server is read only/);
  assert.equal(explain('undo_preview').reason, 'read_only');
  const narrowKey = standardKey({ mcp_allowed_capabilities: ['search_all'] });
  assert.equal(explain('query_entities', narrowKey).reason, 'key_policy');
  assert.match(explain('query_entities', narrowKey).message, /^This key does not allow this tool/);
  const deniedKey = standardKey({ mcp_denied_capabilities: ['get_document'] });
  assert.equal(explain('get_document', deniedKey).reason, 'key_policy');
  assert.equal(explain('web_search').reason, 'disabled');
  assert.equal(explain('search_knowledge').reason, 'permission');
  assert.match(explain('search_knowledge').message, /^Your KANAP role does not allow this tool/);
}

// P3-10: the 429 says when the next request fits, as a header and in the body.
async function testRateLimitCarriesRetryAfter() {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const limiter = new AiMcpRateLimiter();
    limiter.assertAllowed('tenant-1', 'key-1', 2);
    now += 15_000;
    limiter.assertAllowed('tenant-1', 'key-1', 2);
    now += 30_000;
    let refused: McpRateLimitedException | null = null;
    try {
      limiter.assertAllowed('tenant-1', 'key-1', 2);
    } catch (error) {
      refused = error as McpRateLimitedException;
    }
    assert.ok(refused instanceof McpRateLimitedException);
    // The first request leaves the window 60 s after it was made: 15 s from now.
    assert.equal(refused.retryAfterSeconds, 15);
    assert.equal(refused.getStatus(), 429);
    assert.deepEqual(
      { code: (refused.getResponse() as any).code, wait: (refused.getResponse() as any).retry_after_seconds },
      { code: 'MCP_RATE_LIMITED', wait: 15 },
    );
    // A batch larger than the limit never fits: a full window.
    assert.throws(() => limiter.assertAllowed('tenant-1', 'key-2', 2, 3), (error: any) => error.retryAfterSeconds === 60);

    // The application's exception filter turns it into the header.
    const headers: Record<string, string> = {};
    const res = { headersSent: false, setHeader: (name: string, value: string) => { headers[name] = value; } };
    const original = BaseExceptionFilter.prototype.catch;
    BaseExceptionFilter.prototype.catch = function () { return undefined; } as any;
    try {
      await new ReleaseTenantRunnerFilter().catch(refused, {
        switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/api/ai/mcp' }), getResponse: () => res }),
      } as any);
    } finally {
      BaseExceptionFilter.prototype.catch = original;
    }
    assert.equal(headers['Retry-After'], '15');
  } finally {
    Date.now = realNow;
  }
}

function keysService(records: any[], counters: { saves: number; audits: any[] }) {
  const repo = {
    findOne: async ({ where }: any) => records.find((record) => record.id === where.id) ?? null,
    save: async (record: any) => { counters.saves += 1; return record; },
  };
  const manager = { getRepository: () => repo } as any;
  const service = new AiApiKeysService(
    { manager } as any,
    {} as any,
    new McpApiKeyHashService(),
    {} as any,
    { log: async (params: any) => { counters.audits.push(params); } } as any,
  );
  return { service, manager };
}

// P3-22: revoking a revoked key changes nothing and answers without error.
async function testDoubleRevocationKeepsDateAndReason() {
  const revokedAt = new Date('2026-10-26T17:35:17.000Z');
  const record = {
    id: 'key-1', tenant_id: 'tenant-1', user_id: 'user-1', key_prefix: 'kanap_mcp_ab', label: 'Desktop',
    created_at: new Date('2026-10-01T00:00:00.000Z'), created_by_user_id: 'user-1', expires_at: null, last_used_at: null,
    revoked_at: null as Date | null, revoked_by_user_id: null as string | null, revocation_reason: null as string | null,
  };
  const counters = { saves: 0, audits: [] as any[] };
  const { service, manager } = keysService([record], counters);

  const first = await service.revokeKey('key-1', { manager, userId: 'user-1', revocationReason: 'user_self_service' });
  assert.ok(first?.revoked_at);
  assert.equal(first?.revocation_reason, 'user_self_service');
  assert.equal(counters.saves, 1);
  assert.equal(counters.audits.length, 1);

  record.revoked_at = revokedAt;
  const again = await service.revokeKey('key-1', { manager, userId: 'admin-1', revocationReason: 'admin_revocation' });
  assert.equal(again?.revoked_at, revokedAt.toISOString());
  assert.equal(again?.revocation_reason, 'user_self_service');
  assert.equal(again?.revoked_by_user_id, 'user-1');
  assert.equal(counters.saves, 1);
  assert.equal(counters.audits.length, 1);
}

// P3-9: argument values are kept, cut, and never carry a key, a token or a secret.
function testArgumentPreviewKeepsValuesWithoutSecrets() {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl';
  const preview: any = mcpArgumentPreview({
    entity_type: 'applications',
    filters: { status: ['enabled'], owner: 'Ana Silva' },
    limit: 25,
    query: 'x'.repeat(500),
    note: `see kanap_mcp_abcdefghijklmnopqrstuvwxyz0123 and ${jwt}`,
    api_key: 'kanap_mcp_secretvalue',
    contact: 'ana@example.com',
  });
  assert.equal(preview.entity_type, 'applications');
  assert.deepEqual(preview.filters, { status: ['enabled'], owner: 'Ana Silva' });
  assert.equal(preview.limit, 25);
  assert.equal(preview.query.length, 200);
  assert.match(preview.query, /\.\.\.$/);
  assert.equal(preview.api_key, '[REDACTED]');
  assert.equal(preview.contact, '[REDACTED_EMAIL]');
  const text = JSON.stringify(preview);
  assert.doesNotMatch(text, /kanap_mcp_[a-z0-9]/);
  assert.doesNotMatch(text, /eyJhbGciOiJIUzI1NiJ9/);
  assert.doesNotMatch(text, /secretvalue/);

  // An OAuth refresh token in a value, and secrets under other names, nested in objects and arrays.
  const refreshToken = `kanap_mcprt_0123456789ab_${'n'.repeat(32)}_${'m'.repeat(43)}`;
  const nested: any = mcpArgumentPreview({
    query: `my token is ${refreshToken}`,
    filters: [{ name: 'SAP', passwd: 'hunter2' }, { connection: { private_key: 'pk-value', Credentials: 'cred-value' } }],
    auth: 'auth-value',
    author: 'Ana Silva',
  });
  assert.equal(nested.query, 'my token is [REDACTED]');
  assert.deepEqual(nested.filters, [
    { name: 'SAP', passwd: '[REDACTED]' },
    { connection: { private_key: '[REDACTED]', Credentials: '[REDACTED]' } },
  ]);
  assert.equal(nested.auth, '[REDACTED]');
  assert.equal(nested.author, 'Ana Silva');
  assert.doesNotMatch(JSON.stringify(nested), /kanap_mcprt|hunter2|pk-value|cred-value|auth-value/);

  const huge: any = mcpArgumentPreview({ items: Array.from({ length: 200 }, (_, i) => ({ id: i, text: 'y'.repeat(150) })) });
  assert.equal(huge.truncated, true);
  assert.ok(huge.preview.length <= 2_000, String(huge.preview.length));
}

// P3-9: a known key that is refused leaves one journal line, with its id and never its value; a
// client retrying at once does not flood the journal.
async function testGuardJournalsARefusedKeyWithoutItsValue() {
  const rawKey = 'kanap_mcp_abcdefghijklmnopqrstuvwxyz012345';
  const journal: Array<{ tenantId: string; record: AiMcpCallRecord }> = [];
  const guard = new McpApiKeyAuthGuard(
    {
      authenticatePresentedKey: async () => {
        throw new McpKeyRefusedException('MCP API key has been revoked.', {
          tenantId: 'tenant-1', keyId: 'key-1', userId: 'user-1', reason: 'key_revoked',
        });
      },
    } as any,
    { run: async (_tenantId: string, fn: (manager: any) => Promise<unknown>) => fn({}) } as any,
    {} as any,
    { recordCall: async (ctx: any, record: AiMcpCallRecord) => { journal.push({ tenantId: ctx.tenantId, record }); } } as any,
  );
  const request = () => ({
    method: 'POST',
    headers: { authorization: `Bearer ${rawKey}` },
    tenant: { id: 'tenant-1' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_all', arguments: { query: 'SAP' } } },
  });
  const headers: Record<string, string> = {};
  const http = (req: any) => ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ headersSent: false, setHeader: (name: string, value: string) => { headers[name] = value; } }),
    }),
  }) as any;

  await assert.rejects(() => guard.canActivate(http(request())), (error: unknown) => error instanceof UnauthorizedException);
  assert.ok(headers['WWW-Authenticate']);
  assert.equal(journal.length, 1);
  assert.deepEqual(
    { tenant: journal[0].tenantId, tool: journal[0].record.toolName, reason: journal[0].record.reason, key: journal[0].record.apiKeyId, user: journal[0].record.userId },
    { tenant: 'tenant-1', tool: 'search_all', reason: 'key_revoked', key: 'key-1', user: 'user-1' },
  );
  assert.doesNotMatch(JSON.stringify(journal), /kanap_mcp_/);
  // Like every other refusal, the line carries a duration (R3 of the 27/10 check: it was empty).
  const durationMs = journal[0].record.durationMs;
  assert.ok(typeof durationMs === 'number' && durationMs >= 0, `durationMs ${String(durationMs)}`);

  await assert.rejects(() => guard.canActivate(http(request())), (error: unknown) => error instanceof UnauthorizedException);
  assert.equal(journal.length, 1);
}

// Plaid L6, lot A: the dispatcher redacts every tool output before MCP sends it. It keeps the
// vulnerability reads (distinct CVE, feeds); a Date would come out empty, so the feeds carry text.
function testRedactionKeepsTheVulnerabilityReads() {
  const evidence = new AiEvidenceService({} as any);
  const aggregate = {
    group_by: 'severity',
    groups: [{ key: 'critical', count: 2, distinct_count: 1 }],
    total: 5,
    distinct_total: 4,
    distinct_label: 'cve',
    feeds: [
      { source: 'nvd', name: 'NVD', last_success_at: '2026-10-01T06:00:00.000Z', failing: true },
      { source: 'cve_org', name: 'CVE.org', last_success_at: null, failing: false },
    ],
  };
  assert.deepEqual(evidence.redact(aggregate), aggregate);
  const list = { items: [{ metadata: { estate: false, matching: false } }], total: 5, distinct_total: 4, distinct_label: 'cve', feeds: aggregate.feeds };
  assert.deepEqual(evidence.redact(list), list);
  assert.deepEqual(evidence.redact({ last_success_at: new Date('2026-10-01T06:00:00Z') }), { last_success_at: {} }, 'why the feeds carry text');
}

async function run() {
  testRedactionKeepsTheVulnerabilityReads();
  await testStandardKeyListsTwelveToolsThirteenWithWebSearch();
  await testRefusalExplanationsFromTheRealRegistry();
  await testRateLimitCarriesRetryAfter();
  await testDoubleRevocationKeepsDateAndReason();
  testArgumentPreviewKeepsValuesWithoutSecrets();
  await testGuardJournalsARefusedKeyWithoutItsValue();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
