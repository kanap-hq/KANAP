import * as assert from 'node:assert/strict';
import { AiApiKeysService } from '../ai-api-keys.service';
import { McpApiKeyHashService } from '../auth/mcp-api-key-hash.service';

function createService(options?: {
  maxLifetimeDays?: number | null;
}) {
  const records: any[] = [];
  const repoImpl = {
    createQueryBuilder() {
      return {
        addSelect() { return this; },
        where() { return this; },
        andWhere() { return this; },
        async getMany() { return records; },
      };
    },
    async save(record: any) {
      records.push(record);
      return record;
    },
    async find() { return records; },
    async findOne({ where }: any) {
      return records.find((r) => r.id === where.id) ?? null;
    },
    create(payload: any) {
      return { id: `key-${records.length + 1}`, created_at: new Date(), ...payload };
    },
  };

  return new AiApiKeysService(
    {
      manager: {
        getRepository: () => repoImpl,
        // The owners' names of the administration list.
        async query(_sql: string, params: any[]) {
          const owners: Record<string, string> = { 'user-1': 'Ada Lovelace', 'user-2': 'Alan Turing' };
          return (params[1] as string[]).filter((id) => owners[id]).map((id) => ({ id, name: owners[id] }));
        },
      },
    } as any,
    {
      findById: async () => ({
        id: 'user-1',
        email: 'user@example.com',
        status: 'enabled',
        role: { role_name: 'Member', is_system: false },
      }),
    } as any,
    new McpApiKeyHashService(),
    {
      find: async () => options?.maxLifetimeDays != null
        ? { mcp_key_max_lifetime_days: options.maxLifetimeDays }
        : null,
    } as any,
  );
}

async function testKeyLifetimeEnforcement() {
  const service = createService({ maxLifetimeDays: 30 });
  const result = await service.createKey({
    tenantId: 'tenant-1',
    userId: 'user-1',
    label: 'Test key',
    expiresAt: null,
    createdByUserId: 'user-1',
  });

  assert.ok(result.record.expires_at, 'Key should have an expiry date when max lifetime is set');

  const expiresAt = new Date(result.record.expires_at);
  const maxExpiry = new Date(Date.now() + 30 * 86400000);
  assert.ok(
    expiresAt.getTime() <= maxExpiry.getTime() + 1000,
    'Key expiry should not exceed max lifetime',
  );
}

async function testKeyLifetimeCapping() {
  const service = createService({ maxLifetimeDays: 30 });
  const farFuture = new Date(Date.now() + 365 * 86400000);

  const result = await service.createKey({
    tenantId: 'tenant-1',
    userId: 'user-1',
    label: 'Long key',
    expiresAt: farFuture,
    createdByUserId: 'user-1',
  });

  const expiresAt = new Date(result.record.expires_at!);
  const maxExpiry = new Date(Date.now() + 30 * 86400000);
  assert.ok(
    expiresAt.getTime() <= maxExpiry.getTime() + 1000,
    'Key expiry should be capped by max lifetime',
  );
}

async function testNoLifetimeEnforcement() {
  const service = createService({ maxLifetimeDays: null });
  const result = await service.createKey({
    tenantId: 'tenant-1',
    userId: 'user-1',
    label: 'No expiry key',
    expiresAt: null,
    createdByUserId: 'user-1',
  });

  assert.equal(result.record.expires_at, null, 'Key should have no expiry when no max lifetime');
}

async function testDefaultMcpKeyScopesAreReadOnlyAndExplicit() {
  const service = createService();
  const result = await service.createKey({
    tenantId: 'tenant-1',
    userId: 'user-1',
    label: 'Scoped key',
    expiresAt: null,
    createdByUserId: 'user-1',
  });

  assert.deepEqual(result.record.mcp_scopes, ['mcp:tools:list', 'mcp:tools:execute']);
  assert.deepEqual(result.record.mcp_allowed_capabilities, ['kanap.read.core']);
  assert.deepEqual(result.record.mcp_denied_capabilities, []);
  assert.equal(result.record.mcp_max_effect, 'read');
  assert.equal(result.record.mcp_rate_limit_per_minute, 60);
}

async function testCustomMcpKeyScopesAndAllowlists() {
  const service = createService();
  const result = await service.createKey({
    tenantId: 'tenant-1',
    userId: 'user-1',
    label: 'Audit key',
    expiresAt: null,
    createdByUserId: 'user-1',
    mcpScopes: ['mcp:audit:read'],
    mcpAllowedCapabilities: ['query_entities'],
    mcpDeniedCapabilities: ['web_search'],
    mcpRateLimitPerMinute: 5,
  });

  assert.deepEqual(result.record.mcp_scopes, ['mcp:audit:read']);
  assert.deepEqual(result.record.mcp_allowed_capabilities, ['query_entities']);
  assert.deepEqual(result.record.mcp_denied_capabilities, ['web_search']);
  assert.equal(result.record.mcp_rate_limit_per_minute, 5);
}

async function testWildcardMcpCapabilityGrantIsRejected() {
  const service = createService();
  await assert.rejects(
    () => service.createKey({
      tenantId: 'tenant-1',
      userId: 'user-1',
      label: 'Wildcard key',
      expiresAt: null,
      createdByUserId: 'user-1',
      mcpAllowedCapabilities: ['*'],
    }),
    /wildcard grants/,
  );
}

async function testListForTenant() {
  const service = createService();
  await service.createKey({
    tenantId: 'tenant-1',
    userId: 'user-1',
    label: 'Key 1',
    createdByUserId: 'user-1',
  });
  await service.createKey({
    tenantId: 'tenant-1',
    userId: 'user-2',
    label: 'Key 2',
    createdByUserId: 'user-2',
  });

  const items = await service.listForTenant('tenant-1');
  assert.equal(items.length, 2, 'Should list all tenant keys');
  assert.deepEqual(
    items.map((item) => item.user_name).sort(),
    ['Ada Lovelace', 'Alan Turing'],
    'Each key names the person who owns it',
  );
}

async function run() {
  await testKeyLifetimeEnforcement();
  await testKeyLifetimeCapping();
  await testNoLifetimeEnforcement();
  await testDefaultMcpKeyScopesAreReadOnlyAndExplicit();
  await testCustomMcpKeyScopesAndAllowlists();
  await testWildcardMcpCapabilityGrantIsRejected();
  await testListForTenant();
}

void run();
