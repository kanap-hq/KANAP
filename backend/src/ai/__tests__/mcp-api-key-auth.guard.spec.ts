import * as assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { McpApiKeyHashService } from '../auth/mcp-api-key-hash.service';
import { McpApiKeyAuthGuard } from '../auth/mcp-api-key-auth.guard';

async function testHashServiceRoundTrip() {
  const hashService = new McpApiKeyHashService();
  const generated = hashService.generate();

  assert.equal(hashService.extractPrefix(generated.rawKey), generated.keyPrefix);
  assert.equal(hashService.matches(generated.rawKey, generated.keyHash), true);
  assert.equal(hashService.matches(`${generated.rawKey}x`, generated.keyHash), false);
}

// ai_api_keys is under FORCE RLS: the guard must look the key up inside the request's tenant.
const tenantExecutor = {
  run: async (tenantId: string, fn: (manager: any) => Promise<unknown>) => fn({ tenantId }),
} as any;

async function testGuardPopulatesTenantAndUser() {
  const guard = new McpApiKeyAuthGuard(
    {
      authenticatePresentedKey: async () => ({
        apiKey: {
          id: 'key-1',
          tenant_id: 'tenant-1',
          user_id: 'user-1',
          label: 'Desktop',
          key_prefix: 'prefix',
          created_at: new Date('2026-03-16T10:00:00.000Z'),
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
          created_by_user_id: 'user-1',
        },
        user: {
          id: 'user-1',
          email: 'user@example.com',
        },
      }),
      toView: (record: any) => ({ id: record.id, tenant_id: record.tenant_id, user_id: record.user_id }),
    } as any,
    tenantExecutor,
  );

  const req: any = {
    headers: {
      authorization: 'Bearer kanap_mcp_prefix_secret',
    },
    tenant: { id: 'tenant-1', slug: 'alpha', name: 'Alpha' },
  };

  const allowed = await guard.canActivate({
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as any);

  assert.equal(allowed, true);
  assert.equal(req.tenant.id, 'tenant-1');
  assert.equal(req.user.sub, 'user-1');
  assert.equal(req.user.authType, 'mcp');
  assert.equal(req.aiApiKey.id, 'key-1');
}

async function testGuardRejectsTenantMismatch() {
  const guard = new McpApiKeyAuthGuard(
    {
      authenticatePresentedKey: async () => ({
        apiKey: {
          id: 'key-1',
          tenant_id: 'tenant-2',
          user_id: 'user-1',
          label: 'Desktop',
          key_prefix: 'prefix',
          created_at: new Date('2026-03-16T10:00:00.000Z'),
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
          created_by_user_id: 'user-1',
        },
        user: {
          id: 'user-1',
          email: 'user@example.com',
        },
      }),
      toView: () => ({ id: 'key-1' }),
    } as any,
    tenantExecutor,
  );

  await assert.rejects(
    () => guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            authorization: 'Bearer kanap_mcp_prefix_secret',
          },
          tenant: { id: 'tenant-1' },
        }),
      }),
    } as any),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      return true;
    },
  );
}

async function testGuardRequiresTenantAddress() {
  let lookedUp = false;
  const guard = new McpApiKeyAuthGuard(
    {
      authenticatePresentedKey: async () => {
        lookedUp = true;
        throw new Error('must not be called');
      },
    } as any,
    tenantExecutor,
  );

  await assert.rejects(
    () => guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer kanap_mcp_prefix_secret' } }),
      }),
    } as any),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      return true;
    },
  );
  assert.equal(lookedUp, false);
}

async function testGuardLooksUpKeyInsideRequestTenant() {
  let seen: any = null;
  const guard = new McpApiKeyAuthGuard(
    {
      authenticatePresentedKey: async (_raw: string, opts: any) => {
        seen = opts;
        return {
          apiKey: { id: 'key-1', tenant_id: 'tenant-1', user_id: 'user-1' },
          user: { id: 'user-1', email: 'user@example.com' },
        };
      },
      toView: (record: any) => ({ id: record.id }),
    } as any,
    tenantExecutor,
  );

  await guard.canActivate({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-api-key': 'kanap_mcp_prefix_secret' },
        tenant: { id: 'tenant-1' },
      }),
    }),
  } as any);
  assert.equal(seen.tenantId, 'tenant-1');
  assert.deepEqual(seen.manager, { tenantId: 'tenant-1' });
}

async function run() {
  await testHashServiceRoundTrip();
  await testGuardPopulatesTenantAndUser();
  await testGuardRequiresTenantAddress();
  await testGuardLooksUpKeyInsideRequestTenant();
  await testGuardRejectsTenantMismatch();
}

void run();
