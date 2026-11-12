import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AiIntegrationsController } from '../ai-integrations.controller';
import { AiSecretCipherService } from '../ai-secret-cipher.service';
import { AiAdapterConfigService } from '../control-plane/providers/adapter-config.service';
import { AiMonitoringIntegrationsService } from '../control-plane/providers/ai-monitoring-integrations.service';
import { AiTenantSecretResolverService } from '../control-plane/providers/tenant-secret-resolver.service';
import { PrtgService } from '../prtg/prtg.service';

// Contract unit spec for the admin monitoring-integrations endpoints
// (Phase 15): encrypted write-only credentials, presence/shape-only reads,
// IANA timezone validation, sanitized connection tests, admin gating.
// Standalone via ts-node like the other __tests__ specs.

process.env.AI_SETTINGS_ENCRYPTION_SECRET = 'ai-integrations-spec-secret';
// The request-time SSRF guard in PrtgService would otherwise DNS-resolve these
// reserved .test hostnames (and fail); the allowlist short-circuits before DNS.
process.env.SSRF_ALLOWED_HOSTS = 'prtg.example.test,prtg-two.example.test,prtg-three.example.test';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SECRET_TOKEN = 'super-secret-prtg-token-42';
const SECRET_PASSHASH = 'super-secret-passhash-1234';

type FakeResponse = { status?: number; json?: unknown; text?: string };
type FakeRoute = (url: URL) => FakeResponse;

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
}

function createHarness(route: FakeRoute = () => ({ status: 500, text: 'no route' })) {
  const rows: any[] = [];
  const repo: any = {
    findOne: async (opts: any) => rows.find((row) => matchesWhere(row, opts?.where ?? {})) ?? null,
    find: async (opts: any) => rows.filter((row) => matchesWhere(row, opts?.where ?? {})),
    create: (input: any) => ({ ...input }),
    save: async (entity: any) => {
      const index = rows.findIndex((row) =>
        row.tenant_id === entity.tenant_id
        && row.provider_kind === entity.provider_kind
        && row.provider_key === entity.provider_key);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...entity };
        return rows[index];
      }
      const saved = { id: `cfg-${rows.length + 1}`, ...entity };
      rows.push(saved);
      return saved;
    },
    // The audit entry a save writes.
    insert: async () => ({ identifiers: [{ id: 'audit-1' }] }),
  };
  const manager = { getRepository: () => repo } as any;
  const context = {
    tenantId: TENANT_ID,
    userId: 'user-1',
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager,
  } as any;

  const requests: URL[] = [];
  const fetchImpl = async (input: string) => {
    const url = new URL(input);
    requests.push(url);
    const result = route(url);
    return new Response(result.text ?? JSON.stringify(result.json ?? {}), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const cipher = new AiSecretCipherService();
  const resolver = new AiTenantSecretResolverService(cipher);
  const service = new AiMonitoringIntegrationsService(
    new AiAdapterConfigService(repo),
    resolver,
    cipher,
    new PrtgService(fetchImpl as any),
  );
  return { rows, repo, manager, context, requests, cipher, resolver, service };
}

async function testPutStoresEncryptedAndNeverEchoesMaterial() {
  const harness = createHarness();
  const saved = await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test/',
    enabled: true,
    environment: 'production',
    server_timezone: 'Europe/Paris',
    api_token: SECRET_TOKEN,
  });
  assert.deepEqual(saved, { ok: true });

  const row = harness.rows[0];
  assert.equal(row.provider_kind, 'monitoring');
  assert.equal(row.provider_key, 'prtg');
  assert.equal(row.implementation, 'prtg');
  assert.equal(row.tenant_id, TENANT_ID);
  // Trailing slash stripped, timezone in metadata.
  assert.equal(row.base_url, 'https://prtg.example.test');
  assert.equal(row.metadata_json?.server_timezone, 'Europe/Paris');
  // Credential stored as an AES-256-GCM envelope, never the raw token.
  assert.equal(row.credential_ref_json?.kind, 'encrypted');
  assert.equal(row.credential_ref_json?.material_shape, 'api_token');
  assert.notEqual(row.credential_ref_json?.ciphertext, SECRET_TOKEN);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(SECRET_TOKEN));

  // Round trip: the tenant secret resolver decrypts back to the material.
  const resolved = harness.resolver.resolve(harness.context, row.credential_ref_json);
  assert.equal(resolved.hasSecret(), true);
  assert.equal(resolved.reveal(), SECRET_TOKEN);
  assert.equal(resolved.descriptor.kind, 'encrypted');
  assert.equal(resolved.descriptor.source, 'encrypted');
  // The descriptor (what gets serialized) never carries material.
  assert.doesNotMatch(JSON.stringify(resolved), new RegExp(SECRET_TOKEN));

  // GET exposes presence/shape only — no token, no ciphertext.
  const listed = await harness.service.listMonitoringIntegrations(harness.context);
  assert.equal(listed.integrations.length, 1);
  const view = listed.integrations[0];
  assert.equal(view.provider_key, 'prtg');
  assert.equal(view.implementation, 'prtg');
  assert.equal(view.enabled, true);
  assert.equal(view.environment, 'production');
  assert.equal(view.base_url, 'https://prtg.example.test');
  assert.equal(view.server_timezone, 'Europe/Paris');
  assert.deepEqual(view.credential, { present: true, shape: 'api_token' });
  const serialized = JSON.stringify(listed);
  assert.doesNotMatch(serialized, new RegExp(SECRET_TOKEN));
  assert.equal(serialized.includes('ciphertext'), false);
}

async function testWriteOnlyKeepOnOmitIncludingSecretRef() {
  const harness = createHarness();
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    server_timezone: 'Europe/Paris',
    api_token: SECRET_TOKEN,
  });
  const initialCiphertext = harness.rows[0].credential_ref_json.ciphertext;

  // On the same address, omitted and empty api_token both keep the stored
  // credential; a missing server_timezone key keeps the stored zone.
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test/',
    enabled: false,
  });
  assert.equal(harness.rows[0].base_url, 'https://prtg.example.test');
  assert.equal(harness.rows[0].enabled, false);
  assert.equal(harness.rows[0].credential_ref_json.ciphertext, initialCiphertext);
  assert.equal(harness.rows[0].metadata_json?.server_timezone, 'Europe/Paris');

  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    api_token: '   ',
  });
  assert.equal(harness.rows[0].credential_ref_json.ciphertext, initialCiphertext);

  // An operator-managed secret_ref row survives a save on the same address.
  harness.rows[0].credential_ref_json = { kind: 'secret_ref', ref: `tenant/${TENANT_ID}/prtg-token` };
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
  });
  assert.deepEqual(harness.rows[0].credential_ref_json, {
    kind: 'secret_ref',
    ref: `tenant/${TENANT_ID}/prtg-token`,
  });
  // A new address empties it like any stored credential.
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg-three.example.test',
    enabled: true,
  });
  assert.equal(harness.rows[0].base_url, 'https://prtg-three.example.test');
  assert.equal(harness.rows[0].credential_ref_json, null);
}

async function testGetPresenceShapeMatrix() {
  const harness = createHarness();
  const base = {
    tenant_id: TENANT_ID,
    provider_kind: 'monitoring',
    implementation: 'prtg',
    environment: 'production',
    enabled: true,
    base_url: 'https://prtg.example.test',
    metadata_json: null,
    updated_at: new Date('2026-07-06T08:00:00.000Z'),
  };
  const cipher = harness.cipher;
  harness.rows.push(
    { ...base, provider_key: 'a-none', credential_ref_json: null },
    { ...base, provider_key: 'b-token', credential_ref_json: { kind: 'encrypted', ciphertext: cipher.encrypt('tok'), material_shape: 'api_token' } },
    { ...base, provider_key: 'c-pair', credential_ref_json: { kind: 'encrypted', ciphertext: cipher.encrypt('{"username":"u","passhash":"p"}'), material_shape: 'username_passhash' } },
    { ...base, provider_key: 'd-ref', credential_ref_json: { kind: 'secret_ref', ref: `tenant/${TENANT_ID}/prtg` } },
    { ...base, provider_key: 'e-env', credential_ref_json: { kind: 'environment', ref: 'KANAP_X', tenant_id: TENANT_ID } },
    // Other tenant / other kind rows never appear.
    { ...base, tenant_id: 'other-tenant', provider_key: 'z-other', credential_ref_json: null },
    { ...base, provider_kind: 'ticketing', provider_key: 'glpi', credential_ref_json: null },
  );
  const listed = await harness.service.listMonitoringIntegrations(harness.context);
  assert.deepEqual(
    listed.integrations.map((view) => [view.provider_key, view.credential.present, view.credential.shape]),
    [
      ['a-none', false, 'none'],
      ['b-token', true, 'api_token'],
      ['c-pair', true, 'username_passhash'],
      ['d-ref', true, 'secret_ref'],
      ['e-env', true, 'secret_ref'],
    ],
  );
  assert.equal(listed.integrations[0].updated_at, '2026-07-06T08:00:00.000Z');
}

async function testUsernamePasshashPairEncryptsParseableBlob() {
  const harness = createHarness();
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    username: 'kanap-ro',
    passhash: SECRET_PASSHASH,
  });
  const row = harness.rows[0];
  assert.equal(row.credential_ref_json.kind, 'encrypted');
  assert.equal(row.credential_ref_json.material_shape, 'username_passhash');
  assert.doesNotMatch(JSON.stringify(row), new RegExp(SECRET_PASSHASH));
  // Material matches the JSON shape prtg.service.ts already parses.
  const material = harness.resolver.resolve(harness.context, row.credential_ref_json).reveal();
  assert.deepEqual(JSON.parse(material), { username: 'kanap-ro', passhash: SECRET_PASSHASH });

  // Half a pair is a hard validation error, not a silent keep.
  await assert.rejects(
    () => harness.service.savePrtgIntegration(harness.context, {
      base_url: 'https://prtg.example.test',
      enabled: true,
      username: 'kanap-ro',
    }),
    BadRequestException,
  );
}

async function testValidationRejectsJunk() {
  const harness = createHarness();
  // Timezone junk: unknown IANA names and non-zone strings.
  for (const timezone of ['Mars/Olympus_Mons', 'GMT+2 stuff', 'Europe;Paris', 'a'.repeat(80)]) {
    await assert.rejects(
      () => harness.service.savePrtgIntegration(harness.context, {
        base_url: 'https://prtg.example.test',
        enabled: true,
        server_timezone: timezone,
      }),
      BadRequestException,
      `timezone "${timezone}" should be rejected`,
    );
  }
  assert.equal(harness.rows.length, 0);

  // Valid zones pass; explicit empty string clears back to UTC default.
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    server_timezone: 'UTC',
  });
  assert.equal(harness.rows[0].metadata_json?.server_timezone, 'UTC');
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    server_timezone: '',
  });
  assert.equal(harness.rows[0].metadata_json, null);

  // Base URL and enabled validation.
  for (const badBody of [
    { base_url: 'not-a-url', enabled: true },
    { base_url: 'ftp://prtg.example.test', enabled: true },
    { base_url: 'https://prtg.example.test/?apitoken=x', enabled: true },
    { base_url: 'https://user:pass@prtg.example.test', enabled: true },
    { base_url: '', enabled: true },
    { base_url: 'https://prtg.example.test', enabled: 'yes' },
  ]) {
    await assert.rejects(
      () => harness.service.savePrtgIntegration(harness.context, badBody as any),
      BadRequestException,
      `body ${JSON.stringify(badBody)} should be rejected`,
    );
  }
  await assert.rejects(
    () => harness.service.savePrtgIntegration(harness.context, {
      base_url: 'https://prtg.example.test',
      enabled: true,
      environment: 'lab',
    }),
    BadRequestException,
  );
}

async function testTestEndpointUsesStoredCredentialAndSanitizesFailures() {
  // Success path against the saved config: stored encrypted token rides the
  // query string; version + sensor count come back plain-language.
  const okHarness = createHarness(() => ({
    json: { 'prtg-version': '24.1.90.1299', treesize: 321, sensors: [{ objid: 1 }] },
  }));
  await okHarness.service.savePrtgIntegration(okHarness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    api_token: SECRET_TOKEN,
  });
  const okResult = await okHarness.service.testPrtgIntegration(okHarness.context, {});
  assert.equal(okResult.ok, true);
  assert.equal(okResult.prtg_version, '24.1.90.1299');
  assert.equal(okResult.sensor_count, 321);
  assert.match(okResult.message, /24\.1\.90\.1299/);
  assert.equal(okHarness.requests[0].searchParams.get('apitoken'), SECRET_TOKEN);
  assert.equal(okHarness.requests[0].searchParams.get('count'), '1');
  assert.doesNotMatch(JSON.stringify(okResult), new RegExp(SECRET_TOKEN));

  // Body overrides are transient: they hit the wire but are never stored.
  await okHarness.service.testPrtgIntegration(okHarness.context, { api_token: 'transient-token' });
  assert.equal(okHarness.requests[1].searchParams.get('apitoken'), 'transient-token');
  assert.doesNotMatch(JSON.stringify(okHarness.rows), /transient-token/);

  // Failure path: message stays plain-language, no token, no URL query.
  const failHarness = createHarness(() => ({ status: 401, text: 'unauthorized' }));
  await failHarness.service.savePrtgIntegration(failHarness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    api_token: SECRET_TOKEN,
  });
  const failResult = await failHarness.service.testPrtgIntegration(failHarness.context, {});
  assert.equal(failResult.ok, false);
  assert.match(failResult.message, /unauthorized/i);
  const failSerialized = JSON.stringify(failResult);
  assert.doesNotMatch(failSerialized, new RegExp(SECRET_TOKEN));
  assert.doesNotMatch(failSerialized, /apitoken=/);
  assert.doesNotMatch(failSerialized, /\?/);

  // Transport errors that embed the full URL (query string carries the token)
  // must come back sanitized too.
  const transportHarness = createHarness();
  await transportHarness.service.savePrtgIntegration(transportHarness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    api_token: SECRET_TOKEN,
  });
  (transportHarness.service as any).prtg = new PrtgService((async (url: string) => {
    throw new TypeError(`fetch failed for ${url}`);
  }) as any);
  const transportResult = await transportHarness.service.testPrtgIntegration(transportHarness.context, {});
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(JSON.stringify(transportResult), new RegExp(SECRET_TOKEN));

  // Nothing saved and nothing provided: structured plain-language misses.
  const emptyHarness = createHarness();
  const noBaseUrl = await emptyHarness.service.testPrtgIntegration(emptyHarness.context, {});
  assert.equal(noBaseUrl.ok, false);
  assert.match(noBaseUrl.message, /server address/i);
  const noCredential = await emptyHarness.service.testPrtgIntegration(emptyHarness.context, {
    base_url: 'https://prtg.example.test',
  });
  assert.equal(noCredential.ok, false);
  assert.match(noCredential.message, /token/i);
}

async function testEncryptedResolutionFailsClosedLikeUnsetEnv() {
  const harness = createHarness();
  await harness.service.savePrtgIntegration(harness.context, {
    base_url: 'https://prtg.example.test',
    enabled: true,
    api_token: SECRET_TOKEN,
  });
  const ref = harness.rows[0].credential_ref_json;

  // No cipher bound (lightweight instantiation) ⇒ structured Forbidden, same
  // family as an unset environment reference — never a throw with material.
  const bareResolver = new AiTenantSecretResolverService();
  assert.throws(() => bareResolver.resolve(harness.context, ref), ForbiddenException);

  // Tampered ciphertext ⇒ Forbidden, message free of material and ciphertext.
  const tampered = { ...ref, ciphertext: `${ref.ciphertext.slice(0, -4)}AAAA` };
  try {
    harness.resolver.resolve(harness.context, tampered);
    assert.fail('tampered ciphertext must not resolve');
  } catch (error: any) {
    assert.equal(error instanceof ForbiddenException, true);
    assert.doesNotMatch(String(error?.message ?? ''), new RegExp(SECRET_TOKEN));
    assert.doesNotMatch(String(error?.message ?? ''), /ciphertext|v1:/);
  }
}

async function testControllerAdminGate() {
  const harness = createHarness(() => ({ json: { 'prtg-version': '24', treesize: 0, sensors: [] } }));
  const executor = {
    run: async (_tenantId: string, fn: (manager: any) => Promise<unknown>) => fn(harness.manager),
  } as any;
  const policyCalls: string[] = [];

  const denyingPolicy = {
    assertSettingsAccess: async () => {
      policyCalls.push('denied');
      throw new ForbiddenException('Missing required permission ai_settings:admin.');
    },
  } as any;
  const deniedController = new AiIntegrationsController(executor, denyingPolicy, harness.service);
  const request = { tenant: { id: TENANT_ID }, user: { sub: 'user-1' }, id: 'req-1' };
  await assert.rejects(() => deniedController.listMonitoring(request), ForbiddenException);
  await assert.rejects(
    () => deniedController.savePrtg({ base_url: 'https://prtg.example.test', enabled: true, api_token: SECRET_TOKEN }, request),
    ForbiddenException,
  );
  await assert.rejects(() => deniedController.testPrtg({}, request), ForbiddenException);
  assert.equal(policyCalls.length, 3);
  // The denied writes never reached storage.
  assert.equal(harness.rows.length, 0);

  const allowingPolicy = {
    assertSettingsAccess: async () => {
      policyCalls.push('allowed');
    },
  } as any;
  const controller = new AiIntegrationsController(executor, allowingPolicy, harness.service);
  const putResult = await controller.savePrtg(
    { base_url: 'https://prtg.example.test', enabled: true, api_token: SECRET_TOKEN },
    request,
  );
  assert.deepEqual(putResult, { ok: true });
  const getResult: any = await controller.listMonitoring(request);
  assert.equal(getResult.integrations.length, 1);
  assert.doesNotMatch(JSON.stringify(getResult), new RegExp(SECRET_TOKEN));
  const testResult: any = await controller.testPrtg({}, request);
  assert.equal(testResult.ok, true);

  // Missing/invalid tenant context is rejected before any policy or storage.
  await assert.rejects(() => controller.listMonitoring({} as any), UnauthorizedException);
  await assert.rejects(() => controller.listMonitoring({ tenant: { id: 'not-a-uuid' } } as any), UnauthorizedException);
}

async function run() {
  await testPutStoresEncryptedAndNeverEchoesMaterial();
  await testWriteOnlyKeepOnOmitIncludingSecretRef();
  await testGetPresenceShapeMatrix();
  await testUsernamePasshashPairEncryptsParseableBlob();
  await testValidationRejectsJunk();
  await testTestEndpointUsesStoredCredentialAndSanitizesFailures();
  await testEncryptedResolutionFailsClosedLikeUnsetEnv();
  await testControllerAdminGate();
}

void run();
