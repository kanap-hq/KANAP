import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AiModelConfig } from '../ai-model-config.entity';
import { AiModelConfigService } from '../ai-model-config.service';
import { AiProviderTestService } from '../ai-provider-test.service';
import { AiSecretCipherService } from '../ai-secret-cipher.service';
import { AiSettings } from '../ai-settings.entity';
import { AiSettingsService } from '../ai-settings.service';
import { AiAdapterConfigService } from '../control-plane/providers/adapter-config.service';
import { AiMonitoringIntegrationsService } from '../control-plane/providers/ai-monitoring-integrations.service';
import { AiTenantSecretResolverService } from '../control-plane/providers/tenant-secret-resolver.service';
import { GlpiService } from '../glpi/glpi.service';
import { PrtgService } from '../prtg/prtg.service';

// A stored secret (token, key) only goes to the address it was entered for. Saving
// another address empties every secret the request does not bring again; a test
// against another address needs its secret in the request. Two spellings of one
// address (host case, trailing slash, default port) are the same address.

process.env.AI_SETTINGS_ENCRYPTION_SECRET = 'integration-secret-address-spec';
process.env.SSRF_ALLOWED_HOSTS = [
  'models.example.test', 'other-models.example.test',
  'prtg.example.test', 'prtg-other.example.test', 'glpi.internal', 'glpi-other.internal',
].join(',');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------- AI settings (GLPI, legacy model key)

function settingsRow(overrides?: Partial<AiSettings>): AiSettings {
  return {
    id: 'settings-1',
    tenant_id: TENANT_ID,
    chat_enabled: false,
    mcp_enabled: false,
    provider_source: 'custom',
    chat_model_config_id: null,
    llm_provider: 'openai',
    llm_api_key_encrypted: 'enc:stored-llm-key',
    llm_endpoint_url: 'https://models.example.test/v1',
    llm_model: 'gpt-4o-mini',
    mcp_key_max_lifetime_days: null,
    conversation_retention_days: null,
    web_search_enabled: false,
    llm_supports_vision: true,
    glpi_enabled: false,
    glpi_url: 'https://glpi.example.com/helpdesk',
    glpi_user_token_encrypted: 'enc:stored-user-token',
    glpi_app_token_encrypted: 'enc:stored-app-token',
    builtin_accepted_key: null,
    builtin_accepted_at: null,
    builtin_accepted_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as AiSettings;
}

function settingsService(row: AiSettings) {
  const audits: any[] = [];
  const queryBuilder: any = {
    addSelect: () => queryBuilder,
    where: () => queryBuilder,
    setLock: () => queryBuilder,
    getOne: async () => row,
  };
  const repo = {
    manager: {
      getRepository: () => ({
        createQueryBuilder: () => queryBuilder,
        save: async (entity: AiSettings) => entity,
        create: (data: any) => ({ ...row, ...data }),
      }),
    },
  };
  const service = new AiSettingsService(
    repo as any,
    { validate: () => [], get: () => true } as any,
    { encrypt: (value: string) => `enc:${value}`, canEncrypt: () => true } as any,
    {} as any,
    { readiness: async () => ({ errors: [], errorCode: null, usesBuiltin: false, builtinIdentity: null }) } as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
  );
  return { service, audits };
}

async function testGlpiNewAddressWithoutTokensEmptiesThem() {
  const { service, audits } = settingsService(settingsRow());
  const saved = await service.update(TENANT_ID, { glpi_url: 'https://glpi-new.example.com/helpdesk' });
  assert.equal(saved.glpi_url, 'https://glpi-new.example.com/helpdesk');
  assert.equal(saved.glpi_user_token_encrypted, null);
  assert.equal(saved.glpi_app_token_encrypted, null);
  // The trace names the address change and the emptied tokens, never a token.
  const entry = audits.at(-1);
  assert.equal(entry.before.glpi_url, 'https://glpi.example.com/helpdesk');
  assert.equal(entry.after.glpi_url, 'https://glpi-new.example.com/helpdesk');
  assert.equal(entry.before.has_glpi_user_token, true);
  assert.equal(entry.after.has_glpi_user_token, false);
  assert.equal(entry.after.has_glpi_app_token, false);
  assert.doesNotMatch(JSON.stringify(entry), /stored-user-token|stored-app-token/);
}

async function testGlpiNewAddressWithNewTokenKeepsTheNewOne() {
  const { service } = settingsService(settingsRow());
  const saved = await service.update(TENANT_ID, {
    glpi_url: 'https://glpi2.example.com',
    glpi_user_token: 'new-user-token',
  });
  assert.equal(saved.glpi_user_token_encrypted, 'enc:new-user-token');
  // The application token was entered for the old address: not brought again, it goes.
  assert.equal(saved.glpi_app_token_encrypted, null);
}

// The GLPI trace says whether each token is stored, on both sides, like the PRTG, Netbox
// and model traces, and never holds a token. A field the save did not change (a token
// typed again at a new address is still present) shows no change in the audit viewer.
async function testGlpiTraceKeepsTokenPresence() {
  const { service, audits } = settingsService(settingsRow());
  await service.update(TENANT_ID, {
    glpi_url: 'https://glpi2.example.com',
    glpi_user_token: 'new-user-token',
    glpi_app_token: 'new-app-token',
  });
  await service.update(TENANT_ID, { glpi_app_token: '' });
  const [moved, appTokenEmptied] = audits;
  for (const side of [moved.before, moved.after]) {
    assert.equal(side.has_glpi_user_token, true);
    assert.equal(side.has_glpi_app_token, true);
  }
  assert.equal(moved.after.glpi_url, 'https://glpi2.example.com/');
  assert.equal(appTokenEmptied.before.has_glpi_app_token, true);
  assert.equal(appTokenEmptied.after.has_glpi_app_token, false);
  assert.equal(appTokenEmptied.after.has_glpi_user_token, true);
  assert.doesNotMatch(JSON.stringify(audits), /new-user-token|new-app-token|stored-user-token|stored-app-token|enc:/);
}

async function testGlpiSameAddressKeepsTokens() {
  for (const input of [
    { glpi_enabled: true },
    { glpi_url: 'https://glpi.example.com/helpdesk' },
    { glpi_url: 'HTTPS://GLPI.Example.com:443/helpdesk/' },
    { glpi_url: 'https://glpi.example.com/helpdesk/apirest.php' },
  ]) {
    const { service } = settingsService(settingsRow());
    const saved = await service.update(TENANT_ID, input);
    assert.equal(saved.glpi_user_token_encrypted, 'enc:stored-user-token', JSON.stringify(input));
    assert.equal(saved.glpi_app_token_encrypted, 'enc:stored-app-token', JSON.stringify(input));
  }
}

async function testGlpiAddressStoredInAnOlderFormKeepsTokens() {
  for (const stored of [
    'https://glpi.example.com/helpdesk/api.php/v1',
    'https://glpi.example.com/helpdesk/apirest.php/initSession',
  ]) {
    const { service } = settingsService(settingsRow({ glpi_url: stored }));
    const saved = await service.update(TENANT_ID, { glpi_url: 'https://glpi.example.com/helpdesk' });
    assert.equal(saved.glpi_url, 'https://glpi.example.com/helpdesk');
    assert.equal(saved.glpi_user_token_encrypted, 'enc:stored-user-token', stored);
    assert.equal(saved.glpi_app_token_encrypted, 'enc:stored-app-token', stored);
  }
}

async function testGlpiEnabledNewAddressAsksForTheToken() {
  const { service } = settingsService(settingsRow({ glpi_enabled: true }));
  await assert.rejects(
    () => service.update(TENANT_ID, { glpi_url: 'https://glpi2.example.com' }),
    (error: unknown) => error instanceof BadRequestException
      && /address changed: enter the user token again/.test(String((error.getResponse() as any).message)),
  );
}

async function testLegacyModelKeyFollowsItsDestination() {
  {
    const { service } = settingsService(settingsRow());
    const saved = await service.update(TENANT_ID, { llm_endpoint_url: 'https://other-models.example.test/v1' });
    assert.equal(saved.llm_api_key_encrypted, null);
  }
  {
    const { service } = settingsService(settingsRow({ llm_endpoint_url: null }));
    const saved = await service.update(TENANT_ID, { llm_provider: 'anthropic' });
    assert.equal(saved.llm_api_key_encrypted, null, 'another provider service is another destination');
  }
  {
    const { service } = settingsService(settingsRow());
    const saved = await service.update(TENANT_ID, {
      llm_endpoint_url: 'https://other-models.example.test/v1',
      llm_api_key: 'new-key',
    });
    assert.equal(saved.llm_api_key_encrypted, 'enc:new-key');
  }
  {
    const { service } = settingsService(settingsRow());
    const saved = await service.update(TENANT_ID, { llm_endpoint_url: 'https://MODELS.example.test/v1/', llm_model: 'x' });
    assert.equal(saved.llm_api_key_encrypted, 'enc:stored-llm-key');
  }
}

// ---------------------------------------------------------------- Model registry entries

function modelConfig(overrides?: Partial<AiModelConfig>): AiModelConfig {
  return {
    id: 'cfg-1',
    tenant_id: TENANT_ID,
    name: 'My model',
    provider: 'custom',
    model: 'gpt-4o-mini',
    endpoint_url: 'https://models.example.test/v1',
    api_key_encrypted: 'enc:stored-model-key',
    supports_vision: true,
    price_input_eur_per_mtok: null,
    price_output_eur_per_mtok: null,
    price_cache_read_eur_per_mtok: null,
    reasoning_effort: null,
    llm_timeout_ms: null,
    status: 'active',
    is_default: false,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as AiModelConfig;
}

function applyModelInput(config: AiModelConfig, input: Record<string, unknown>): AiModelConfig {
  const service = new AiModelConfigService(
    {} as any,
    { get: () => true, validate: () => [] } as any,
    { encrypt: (value: string) => `enc:${value}` } as any,
  );
  (service as any).applyInput(config, input, { isCreate: false });
  return config;
}

async function testModelEntryKeyFollowsItsDestination() {
  // The screen always sends the provider and the address with the other fields.
  const base = { name: 'My model', provider: 'custom', model: 'gpt-4o-mini' };
  assert.equal(
    applyModelInput(modelConfig(), { ...base, endpoint_url: 'https://other-models.example.test/v1' }).api_key_encrypted,
    null,
  );
  assert.equal(
    applyModelInput(modelConfig(), { endpoint_url: 'https://other-models.example.test/v1', api_key: 'new-key' }).api_key_encrypted,
    'enc:new-key',
  );
  for (const endpoint of ['https://models.example.test/v1', 'https://Models.Example.test:443/v1/']) {
    assert.equal(
      applyModelInput(modelConfig(), { ...base, endpoint_url: endpoint }).api_key_encrypted,
      'enc:stored-model-key',
      endpoint,
    );
  }
  // Without an address the key goes to the provider's own service.
  assert.equal(
    applyModelInput(modelConfig({ provider: 'openai', endpoint_url: null }), { provider: 'anthropic' }).api_key_encrypted,
    null,
  );
  assert.equal(
    applyModelInput(modelConfig(), { provider: 'anthropic' }).api_key_encrypted,
    null,
    'a provider that ignores the address calls its own service',
  );
}

// ---------------------------------------------------------------- Settings model test (stored key)

function providerTestService(captured: { apiKey?: string | null; calls: number }) {
  const adapter = {
    descriptor: { id: 'custom', capabilities: { requiresApiKey: true, allowsCustomEndpoint: true } },
    createStream: async function* (params: any) {
      captured.calls += 1;
      captured.apiKey = params.apiKey;
      yield { type: 'done' };
    },
  };
  return new AiProviderTestService(
    { find: async () => settingsRow({ llm_provider: 'custom' }) } as any,
    { decrypt: (value: string) => value.replace(/^enc:/, '') } as any,
    {
      validate: (snapshot: any) => (snapshot.has_llm_api_key ? [] : ['API key is required.']),
      get: () => adapter,
    } as any,
  );
}

async function testProviderTestKeepsTheStoredKeyAtItsAddress() {
  {
    const captured = { calls: 0 } as { apiKey?: string | null; calls: number };
    const result = await providerTestService(captured).testProvider(TENANT_ID, {
      llm_endpoint_url: 'https://other-models.example.test/v1',
    });
    assert.equal(captured.calls, 0, 'nothing is sent to another address with the stored key');
    assert.equal(result.ok, false);
    assert.deepEqual(result.validation_errors, ['API key is required.']);
  }
  {
    const captured = { calls: 0 } as { apiKey?: string | null; calls: number };
    await providerTestService(captured).testProvider(TENANT_ID, {
      llm_endpoint_url: 'https://other-models.example.test/v1',
      llm_api_key: 'typed-key',
    });
    assert.equal(captured.apiKey, 'typed-key');
  }
  {
    const captured = { calls: 0 } as { apiKey?: string | null; calls: number };
    await providerTestService(captured).testProvider(TENANT_ID, {
      llm_endpoint_url: 'https://MODELS.example.test/v1/',
    });
    assert.equal(captured.apiKey, 'stored-llm-key');
  }
}

// ---------------------------------------------------------------- GLPI connection test

async function testGlpiTestKeepsStoredTokensAtTheirAddress() {
  const service = new GlpiService(
    {
      find: async () => ({
        glpi_url: 'https://glpi.internal/helpdesk',
        glpi_user_token_encrypted: 'enc:stored-user-token',
        glpi_app_token_encrypted: 'enc:stored-app-token',
      }),
    } as any,
    { decrypt: (value: string) => value.replace(/^enc:/, '') } as any,
  );
  const originalFetch = global.fetch;
  const requests: { url: string; headers: Headers }[] = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    if (url.endsWith('/initSession')) return Response.json({ session_token: 'session-1' });
    if (url.endsWith('/getFullSession')) return Response.json({ session: { glpiID: 7 } });
    return Response.json(true);
  }) as typeof fetch;
  try {
    const refused = await service.testConnection(TENANT_ID, { glpi_url: 'https://glpi-other.internal/helpdesk' }, {} as any);
    assert.equal(refused.ok, false);
    assert.equal(requests.length, 0, 'no request leaves for another address without its token');

    const typed = await service.testConnection(
      TENANT_ID,
      { glpi_url: 'https://glpi-other.internal/helpdesk', glpi_user_token: 'typed-token' },
      {} as any,
    );
    assert.equal(typed.ok, true, typed.message);
    assert.equal(requests[0].headers.get('authorization'), 'user_token typed-token');
    assert.ok(requests.every((request) => request.headers.get('app-token') == null), 'the stored app token stays');

    requests.length = 0;
    const same = await service.testConnection(TENANT_ID, { glpi_url: 'https://GLPI.internal/helpdesk/' }, {} as any);
    assert.equal(same.ok, true, same.message);
    assert.equal(requests[0].headers.get('authorization'), 'user_token stored-user-token');
    assert.equal(requests[0].headers.get('app-token'), 'stored-app-token');
  } finally {
    global.fetch = originalFetch;
  }
}

// ---------------------------------------------------------------- PRTG

function prtgHarness() {
  const rows: any[] = [];
  const audits: any[] = [];
  const repo: any = {
    findOne: async (opts: any) => rows.find((row) => Object.entries(opts?.where ?? {}).every(([k, v]) => row[k] === v)) ?? null,
    create: (input: any) => ({ ...input }),
    save: async (entity: any) => {
      const index = rows.findIndex((row) => row.provider_key === entity.provider_key);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...entity };
        return rows[index];
      }
      const saved = { id: `cfg-${rows.length + 1}`, ...entity };
      rows.push(saved);
      return saved;
    },
    insert: async (row: any) => {
      audits.push(row);
      return { identifiers: [{ id: `audit-${audits.length}` }] };
    },
  };
  const manager = { getRepository: () => repo, query: async () => [] } as any;
  const context = { tenantId: TENANT_ID, userId: 'user-1', manager } as any;
  const requests: URL[] = [];
  const fetchImpl = async (input: string) => {
    requests.push(new URL(input));
    return new Response(JSON.stringify({ treesize: 3, 'prtg-version': '24.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const cipher = new AiSecretCipherService();
  const service = new AiMonitoringIntegrationsService(
    new AiAdapterConfigService(repo),
    new AiTenantSecretResolverService(cipher),
    cipher,
    new PrtgService(fetchImpl as any),
  );
  return { rows, audits, context, requests, service };
}

async function savePrtg(harness: ReturnType<typeof prtgHarness>, input: Record<string, unknown>) {
  await harness.service.savePrtgIntegration(harness.context, { enabled: true, ...input });
  return harness.rows[0];
}

async function testPrtgCredentialFollowsItsAddress() {
  {
    const harness = prtgHarness();
    await savePrtg(harness, { base_url: 'https://prtg.example.test', api_token: 'stored-prtg-token' });
    const row = await savePrtg(harness, { base_url: 'https://prtg-other.example.test' });
    assert.equal(row.base_url, 'https://prtg-other.example.test');
    assert.equal(row.credential_ref_json, null);
    const entry = harness.audits.at(-1);
    assert.equal(entry.table_name, 'ai_adapter_configs');
    assert.equal(entry.action, 'update');
    assert.equal(entry.before_json.base_url, 'https://prtg.example.test');
    assert.equal(entry.before_json.credential.present, true);
    assert.equal(entry.after_json.base_url, 'https://prtg-other.example.test');
    assert.equal(entry.after_json.credential.present, false);
    assert.doesNotMatch(JSON.stringify(harness.audits), /stored-prtg-token|ciphertext/);
  }
  {
    const harness = prtgHarness();
    await savePrtg(harness, { base_url: 'https://prtg.example.test', api_token: 'stored-prtg-token' });
    const row = await savePrtg(harness, { base_url: 'https://prtg-other.example.test', api_token: 'new-prtg-token' });
    assert.equal(row.credential_ref_json?.kind, 'encrypted');
    assert.equal(new AiSecretCipherService().decrypt(row.credential_ref_json.ciphertext), 'new-prtg-token');
  }
  {
    // A reference managed by the operator goes too: it was set for the old address.
    const harness = prtgHarness();
    await savePrtg(harness, { base_url: 'https://prtg.example.test', api_token: 'stored-prtg-token' });
    harness.rows[0].credential_ref_json = { kind: 'secret_ref', ref: `tenant/${TENANT_ID}/prtg-token` };
    const row = await savePrtg(harness, { base_url: 'https://prtg-other.example.test' });
    assert.equal(row.credential_ref_json, null);
  }
  for (const sameAddress of ['https://prtg.example.test', 'https://PRTG.example.test:443/']) {
    const harness = prtgHarness();
    const first = await savePrtg(harness, { base_url: 'https://prtg.example.test', api_token: 'stored-prtg-token' });
    const ciphertext = first.credential_ref_json.ciphertext;
    const row = await savePrtg(harness, { base_url: sameAddress, server_timezone: 'Europe/Paris' });
    assert.equal(row.credential_ref_json?.ciphertext, ciphertext, sameAddress);
  }
}

async function testPrtgTestKeepsTheStoredCredentialAtItsAddress() {
  const harness = prtgHarness();
  await savePrtg(harness, { base_url: 'https://prtg.example.test', api_token: 'stored-prtg-token' });

  const refused = await harness.service.testPrtgIntegration(harness.context, { base_url: 'https://prtg-other.example.test' });
  assert.equal(refused.ok, false);
  assert.equal(harness.requests.length, 0, 'no request leaves for another address without its token');

  await harness.service.testPrtgIntegration(harness.context, {
    base_url: 'https://prtg-other.example.test',
    api_token: 'typed-token',
  });
  assert.equal(harness.requests.at(-1)?.hostname, 'prtg-other.example.test');
  assert.equal(harness.requests.at(-1)?.searchParams.get('apitoken'), 'typed-token');

  await harness.service.testPrtgIntegration(harness.context, { base_url: 'https://PRTG.example.test/' });
  assert.equal(harness.requests.at(-1)?.hostname, 'prtg.example.test');
  assert.equal(harness.requests.at(-1)?.searchParams.get('apitoken'), 'stored-prtg-token');
}

async function testPrtgEmptyAddressRemovesTheConnection() {
  const harness = prtgHarness();
  await savePrtg(harness, {
    base_url: 'https://prtg.example.test',
    api_token: 'stored-prtg-token',
    server_timezone: 'Europe/Paris',
  });
  await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: '  ' });
  const row = harness.rows[0];
  assert.equal(harness.rows.length, 1, 'the row stays, with its other settings');
  assert.equal(row.base_url, null);
  assert.equal(row.credential_ref_json, null);
  assert.equal(row.enabled, false, 'a removed connection is off whatever the switch said');
  assert.equal(row.metadata_json?.server_timezone, 'Europe/Paris');
  const entry = harness.audits.at(-1);
  assert.equal(entry.action, 'update');
  assert.equal(entry.before_json.base_url, 'https://prtg.example.test');
  assert.equal(entry.before_json.credential.present, true);
  assert.equal(entry.after_json.base_url, null);
  assert.equal(entry.after_json.credential.present, false);
  assert.equal(entry.after_json.enabled, false);
  assert.doesNotMatch(JSON.stringify(harness.audits), /stored-prtg-token|ciphertext/);

  // Once removed, an empty address is refused again, as with nothing saved: a token
  // typed with it would otherwise be dropped while the screen reports a save.
  const count = harness.audits.length;
  await assert.rejects(
    () => harness.service.savePrtgIntegration(harness.context, { enabled: false, base_url: '', api_token: 'typed-after-removal' }),
    (error: any) => error instanceof BadRequestException,
  );
  assert.equal(harness.audits.length, count, 'no entry without a change');
  assert.equal(harness.rows[0].credential_ref_json, null);

  // With nothing saved, an empty address is still refused.
  const empty = prtgHarness();
  await assert.rejects(
    () => empty.service.savePrtgIntegration(empty.context, { enabled: false, base_url: '' }),
    (error: any) => error instanceof BadRequestException,
  );
  assert.equal(empty.rows.length, 0);
}

async function run() {
  const tests: Array<[string, () => Promise<void>]> = [
    ['GLPI: a new address without tokens empties them, with a trace', testGlpiNewAddressWithoutTokensEmptiesThem],
    ['GLPI: a new address with a new token keeps the new one', testGlpiNewAddressWithNewTokenKeepsTheNewOne],
    ['GLPI: the trace keeps the presence of each token, never a token', testGlpiTraceKeepsTokenPresence],
    ['GLPI: the same address, however spelled, keeps the tokens', testGlpiSameAddressKeepsTokens],
    ['GLPI: an address stored in an older form keeps the tokens', testGlpiAddressStoredInAnOlderFormKeepsTokens],
    ['GLPI: an enabled connection moved without its token is refused', testGlpiEnabledNewAddressAsksForTheToken],
    ['Settings model key follows its destination', testLegacyModelKeyFollowsItsDestination],
    ['Model entry key follows its destination', testModelEntryKeyFollowsItsDestination],
    ['Model test sends the stored key only to its address', testProviderTestKeepsTheStoredKeyAtItsAddress],
    ['GLPI test sends the stored tokens only to their address', testGlpiTestKeepsStoredTokensAtTheirAddress],
    ['PRTG: the stored credential follows its address, with a trace', testPrtgCredentialFollowsItsAddress],
    ['PRTG test sends the stored credential only to its address', testPrtgTestKeepsTheStoredCredentialAtItsAddress],
    ['PRTG: an empty address removes the connection, with a trace', testPrtgEmptyAddressRemovesTheConnection],
  ];
  let failed = 0;
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error);
    }
  }
  if (failed > 0) process.exit(1);
}

void run();
