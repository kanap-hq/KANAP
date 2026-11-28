import * as assert from 'node:assert/strict';
import { AiSecretCipherService } from '../ai-secret-cipher.service';
import { AiSettings } from '../ai-settings.entity';
import { AiSettingsService } from '../ai-settings.service';
import { AiAdapterConfigService } from '../control-plane/providers/adapter-config.service';
import { readLastConnectionTest } from '../control-plane/providers/adapter-connection-test';
import { AiMonitoringIntegrationsService } from '../control-plane/providers/ai-monitoring-integrations.service';
import { AiTenantSecretResolverService } from '../control-plane/providers/tenant-secret-resolver.service';
import { GlpiService } from '../glpi/glpi.service';
import { PrtgService } from '../prtg/prtg.service';

// What the connection cards read from the server: a failed test names its cause with a code the
// card translates; a test of the saved values is kept as the last test, a test of typed values is
// not; a secret replaced at the same address says so in the audit entry, never the secret.

process.env.SETTINGS_ENCRYPTION_SECRET = 'integration-connection-cards-spec';
delete process.env.AI_SETTINGS_ENCRYPTION_SECRET;
// Cloud mode: the address guard applies, except to these test hosts.
delete process.env.DEPLOYMENT_MODE;
process.env.SSRF_ALLOWED_HOSTS = ['glpi.internal', 'glpi-other.internal', 'prtg.example.test', 'prtg-other.example.test'].join(',');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

// ---------------------------------------------------------------- GLPI test

type GlpiStored = Pick<AiSettings, 'id' | 'tenant_id' | 'glpi_url' | 'glpi_user_token_encrypted' | 'glpi_app_token_encrypted'>;

function glpiService(stored: Partial<GlpiStored> | null) {
  const recorded: Array<{ settings: GlpiStored; result: Record<string, unknown> }> = [];
  const row = stored ? {
    id: 'settings-1',
    tenant_id: TENANT_ID,
    glpi_url: 'https://glpi.internal/helpdesk',
    glpi_user_token_encrypted: 'enc:stored-user-token',
    glpi_app_token_encrypted: null,
    ...stored,
  } : null;
  const service = new GlpiService(
    {
      find: async () => row,
      recordGlpiTest: async (_manager: unknown, settings: GlpiStored, result: Record<string, unknown>) => {
        recorded.push({ settings, result });
        return true;
      },
    } as any,
    { decrypt: (value: string) => value.replace(/^enc:/, '') } as any,
  );
  return { service, recorded };
}

async function withFetch(handler: (url: string) => Response | Promise<Response>, fn: () => Promise<void>) {
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

const glpiOk = (url: string) => {
  if (url.endsWith('/initSession')) return json({ session_token: 'session-1' });
  if (url.endsWith('/getFullSession')) return json({ session: { glpiID: 7 } });
  return json(true);
};

async function testGlpiFailuresCarryACode() {
  const cases: Array<[string, Partial<GlpiStored> | null, Record<string, string>, (url: string) => Response | Promise<Response>, string]> = [
    ['no address', { glpi_url: null, glpi_user_token_encrypted: null }, {}, glpiOk, 'glpi_url_missing'],
    ['an address that is not one', null, { glpi_url: 'glpi internal' }, glpiOk, 'glpi_url_invalid'],
    ['no user token', { glpi_user_token_encrypted: null }, {}, glpiOk, 'glpi_user_token_missing'],
    ['an address typed, nothing saved', null, { glpi_url: 'https://glpi-other.internal' }, glpiOk, 'glpi_user_token_missing'],
    ['another address, tokens stored for the first', {}, { glpi_url: 'https://glpi-other.internal' }, glpiOk, 'glpi_token_needed_for_address'],
    ['a private address in the cloud', {}, { glpi_url: 'http://10.20.30.40/', glpi_user_token: 'typed' }, glpiOk, 'address_private_host'],
    ['a refused user token', {}, {}, () => json(['ERROR_GLPI_LOGIN_USER_TOKEN', 'parameter user_token seems invalid'], 401), 'glpi_user_token_invalid'],
    ['a refused app token', {}, {}, () => json(['ERROR_WRONG_APP_TOKEN_PARAMETER', 'parameter app_token seems wrong'], 400), 'glpi_app_token_invalid'],
    ['a caller outside the API client range', {}, {}, () => json(['ERROR_NOT_ALLOWED_IP', 'There is no active API client matching your IP address'], 400), 'glpi_ip_not_allowed'],
    ['an HTML page', {}, {}, () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'glpi_invalid_response'],
    ['no answer', {}, {}, () => { throw new TypeError('fetch failed'); }, 'glpi_unreachable'],
    ['a redirect', {}, {}, () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }), 'glpi_redirect'],
  ];
  for (const [name, stored, overrides, handler, code] of cases) {
    // `null` stands for "nothing saved": the address of the case is typed.
    const { service } = glpiService(stored === null ? null : stored);
    await withFetch(handler, async () => {
      const result = await service.testConnection(TENANT_ID, overrides, {} as any);
      assert.equal(result.ok, false, name);
      assert.equal(result.code, code, `${name}: ${result.message}`);
      assert.ok(result.message.trim(), `${name}: an English sentence stays as the fallback`);
      assert.doesNotMatch(JSON.stringify(result), /stored-user-token|typed/, name);
    });
  }
}

async function testGlpiKeepsOnlyATestOfTheSavedValues() {
  for (const [name, overrides, kept] of [
    ['the saved values', {}, true],
    ['the saved address spelled otherwise', { glpi_url: 'https://GLPI.internal/helpdesk/apirest.php' }, true],
    ['a typed user token', { glpi_user_token: 'typed-token' }, false],
    ['a typed app token', { glpi_app_token: 'typed-app-token' }, false],
    ['another address with its token', { glpi_url: 'https://glpi-other.internal', glpi_user_token: 'typed-token' }, false],
  ] as Array<[string, Record<string, string>, boolean]>) {
    const { service, recorded } = glpiService({});
    await withFetch(glpiOk, async () => {
      const result = await service.testConnection(TENANT_ID, overrides, {} as any);
      assert.equal(result.ok, true, `${name}: ${result.message}`);
      assert.ok(!Number.isNaN(Date.parse(result.tested_at)), name);
      assert.equal(result.persisted, kept, name);
      assert.equal(recorded.length, kept ? 1 : 0, name);
      if (kept) {
        // The values the test ran on: the conditional write compares them with the row.
        assert.equal(recorded[0].settings.glpi_url, 'https://glpi.internal/helpdesk');
        assert.equal(recorded[0].settings.glpi_user_token_encrypted, 'enc:stored-user-token');
        // What the card says after a reload: the response time of a passed test.
        assert.deepEqual(recorded[0].result, { ok: true, tested_at: result.tested_at, latency_ms: result.latency_ms });
        assert.equal(typeof result.latency_ms, 'number');
      }
    });
  }
  // A failure on the saved values is kept too: "Last test failed".
  const { service, recorded } = glpiService({});
  await withFetch(() => json(['ERROR_GLPI_LOGIN_USER_TOKEN', 'invalid'], 401), async () => {
    const result = await service.testConnection(TENANT_ID, {}, {} as any);
    assert.equal(result.ok, false);
    assert.equal(result.persisted, true);
    // The cause is kept as its code, which the card translates; the message of GLPI is not.
    assert.equal(recorded[0].result.ok, false);
    assert.equal(recorded[0].result.code, 'glpi_user_token_invalid');
    assert.equal('message' in recorded[0].result, false);
  });
}

async function testGlpiReadsTheDetailOfTheKeptTest() {
  const { service, queries } = settingsService(settingsRow({
    glpi_last_test: { ok: false, tested_at: '2026-11-26T10:42:00.000Z', code: 'glpi_app_token_invalid', message: 'parameter app_token seems wrong' } as any,
  }));
  const view = await service.toView(await service.find(TENANT_ID) as AiSettings);
  assert.deepEqual(view.glpi_last_test, { ok: false, tested_at: '2026-11-26T10:42:00.000Z', code: 'glpi_app_token_invalid' });
  // The write keeps the same detail, and nothing else.
  await service.recordGlpiTest({ query: async (sql: string, params: unknown[]) => { queries.push({ sql, params }); return [{ n: 1 }]; } } as any,
    settingsRow(), { ok: true, tested_at: '2026-11-27T08:00:00.000Z', latency_ms: 41, message: 'GLPI connection succeeded.' } as any);
  assert.deepEqual(JSON.parse(String(queries.at(-1)!.params[0])), { ok: true, tested_at: '2026-11-27T08:00:00.000Z', latency_ms: 41 });
}

// ---------------------------------------------------------------- GLPI save

function settingsRow(overrides?: Partial<AiSettings>): AiSettings {
  return {
    id: 'settings-1',
    tenant_id: TENANT_ID,
    chat_enabled: false,
    mcp_enabled: false,
    provider_source: 'custom',
    chat_model_config_id: null,
    llm_provider: null,
    llm_api_key_encrypted: null,
    llm_endpoint_url: null,
    llm_model: null,
    mcp_key_max_lifetime_days: null,
    conversation_retention_days: null,
    web_search_enabled: false,
    llm_supports_vision: true,
    glpi_enabled: true,
    glpi_url: 'https://glpi.internal/helpdesk',
    glpi_user_token_encrypted: 'enc:stored-user-token',
    glpi_app_token_encrypted: 'enc:stored-app-token',
    glpi_last_test: { ok: true, tested_at: '2026-11-26T10:42:00.000Z' },
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
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const queryBuilder: any = {
    addSelect: () => queryBuilder,
    where: () => queryBuilder,
    setLock: () => queryBuilder,
    getOne: async () => ({ ...row }),
  };
  const repository = {
    createQueryBuilder: () => queryBuilder,
    save: async (entity: AiSettings) => entity,
    create: (data: any) => ({ ...row, ...data }),
    query: async (sql: string, params: unknown[]) => { queries.push({ sql, params }); return []; },
  };
  const service = new AiSettingsService(
    { manager: { getRepository: () => repository } } as any,
    { validate: () => [], get: () => true } as any,
    { encrypt: (value: string) => `enc:${value}`, canEncrypt: () => true } as any,
    {} as any,
    { readiness: async () => ({ errors: [], errorCode: null, usesBuiltin: false, builtinIdentity: null }) } as any,
    { log: async (entry: any) => { audits.push(entry); } } as any,
  );
  return { service, audits, queries };
}

const clears = (queries: Array<{ sql: string }>) => queries.filter((query) => /SET glpi_last_test = NULL/.test(query.sql)).length;

async function testGlpiSaveMarksAReplacedTokenAndDropsTheTest() {
  {
    const { service, audits, queries } = settingsService(settingsRow());
    const saved = await service.update(TENANT_ID, { glpi_url: 'https://glpi.internal/helpdesk', glpi_user_token: 'rotated-token' });
    const view = await service.toView(saved);
    assert.equal(view.glpi_last_test, null, 'a new token makes the stored test obsolete');
    assert.equal(clears(queries), 1);
    const entry = audits.at(-1);
    // The entry names the token replaced.
    assert.equal(entry.after.glpi_user_token_replaced, true);
    assert.equal(entry.after.glpi_app_token_replaced, undefined);
    assert.equal(entry.after.secret_replaced, undefined);
    assert.equal(entry.before.glpi_user_token_replaced, undefined);
    assert.equal('glpi_last_test' in entry.before || 'glpi_last_test' in entry.after, false, 'a test is never audited');
    assert.doesNotMatch(JSON.stringify(audits), /rotated-token|stored-user-token|enc:/);
  }
  {
    const { service, audits } = settingsService(settingsRow());
    await service.update(TENANT_ID, { glpi_url: 'https://glpi.internal/helpdesk', glpi_app_token: 'rotated-app-token' });
    assert.equal(audits.at(-1).after.glpi_app_token_replaced, true);
    assert.equal(audits.at(-1).after.glpi_user_token_replaced, undefined);
    assert.doesNotMatch(JSON.stringify(audits), /rotated-app-token|stored-app-token|enc:/);
  }
  {
    // A new address with its token: the address changes in the entry, nothing to mark.
    const { service, audits } = settingsService(settingsRow());
    await service.update(TENANT_ID, { glpi_url: 'https://glpi-other.internal', glpi_user_token: 'new-token' });
    assert.equal(audits.at(-1).after.glpi_user_token_replaced, undefined);
  }
  {
    // A first token: its presence changes in the entry, nothing to mark.
    const { service, audits } = settingsService(settingsRow({ glpi_enabled: false, glpi_app_token_encrypted: null, glpi_last_test: null }));
    await service.update(TENANT_ID, { glpi_url: 'https://glpi.internal/helpdesk', glpi_app_token: 'first-app-token' });
    assert.equal(audits.at(-1).after.glpi_app_token_replaced, undefined);
    assert.equal(audits.at(-1).after.has_glpi_app_token, true);
  }
  {
    // A change of the switch alone keeps the test.
    const { service, audits, queries } = settingsService(settingsRow());
    const saved = await service.update(TENANT_ID, { glpi_enabled: false });
    assert.deepEqual((await service.toView(saved)).glpi_last_test, { ok: true, tested_at: '2026-11-26T10:42:00.000Z' });
    assert.equal(clears(queries), 0);
    assert.equal(audits.at(-1).after.glpi_user_token_replaced, undefined);
    assert.equal(audits.at(-1).after.glpi_app_token_replaced, undefined);
  }
}

async function testGlpiEmptyAddressRemovesTheConnection() {
  const { service, audits, queries } = settingsService(settingsRow());
  const saved = await service.update(TENANT_ID, { glpi_url: null });
  assert.equal(saved.glpi_url, null);
  assert.equal(saved.glpi_enabled, false, 'a removed connection is off whatever the switch said');
  assert.equal(saved.glpi_user_token_encrypted, null);
  assert.equal(saved.glpi_app_token_encrypted, null);
  assert.equal(clears(queries), 1);
  const entry = audits.at(-1);
  assert.equal(entry.before.glpi_url, 'https://glpi.internal/helpdesk');
  assert.equal(entry.after.glpi_url, null);
  assert.equal(entry.after.glpi_enabled, false);
  assert.equal(entry.after.has_glpi_user_token, false);
}

// ---------------------------------------------------------------- PRTG

function prtgHarness(respond: (url: URL) => Response = () => json({ treesize: 3, 'prtg-version': '24.1', sensors: [] })) {
  const rows: any[] = [];
  const audits: any[] = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const repo: any = {
    findOne: async (opts: any) => rows.find((row) => Object.entries(opts?.where ?? {}).every(([k, v]) => row[k] === v)) ?? null,
    find: async (opts: any) => rows.filter((row) => Object.entries(opts?.where ?? {}).every(([k, v]) => row[k] === v)),
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
  const manager = {
    getRepository: () => repo,
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return /WITH changed/.test(sql) ? [{ n: 1 }] : [];
    },
  } as any;
  const context = { tenantId: TENANT_ID, userId: 'user-1', manager } as any;
  const cipher = new AiSecretCipherService();
  const service = new AiMonitoringIntegrationsService(
    new AiAdapterConfigService(repo),
    new AiTenantSecretResolverService(cipher),
    cipher,
    new PrtgService((async (input: string) => respond(new URL(input))) as any),
  );
  return { rows, audits, queries, context, service };
}

const records = (queries: Array<{ sql: string }>) => queries.filter((query) => /WITH changed/.test(query.sql)).length;
const testClears = (queries: Array<{ sql: string }>) => queries.filter((query) => /- 'last_connection_test'/.test(query.sql)).length;

async function testPrtgFailuresCarryACode() {
  const cases: Array<[string, boolean, Record<string, string>, (url: URL) => Response, string]> = [
    ['nothing saved', false, {}, () => json({}), 'prtg_base_url_missing'],
    ['an address that is not one', false, { base_url: 'prtg internal' }, () => json({}), 'prtg_base_url_invalid'],
    ['no credential', false, { base_url: 'https://prtg.example.test' }, () => json({}), 'prtg_credential_missing'],
    ['another address without its key', true, { base_url: 'https://prtg-other.example.test' }, () => json({}), 'prtg_token_needed_for_address'],
    ['a private address in the cloud', true, { base_url: 'http://10.20.30.40', api_token: 'typed' }, () => json({}), 'address_private_host'],
    ['a refused key', true, {}, () => new Response('unauthorized', { status: 401 }), 'prtg_auth'],
    ['a forbidden account', true, {}, () => new Response('forbidden', { status: 403 }), 'prtg_forbidden'],
    ['an answer that is not PRTG', true, {}, () => json({ nothing: true }), 'prtg_invalid_response'],
    ['a server down', true, {}, () => new Response('down', { status: 503 }), 'prtg_unreachable'],
  ];
  for (const [name, saved, input, respond, code] of cases) {
    const harness = prtgHarness(respond);
    if (saved) {
      await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: 'https://prtg.example.test', api_token: 'stored-prtg-key' });
    }
    const result = await harness.service.testPrtgIntegration(harness.context, input);
    assert.equal(result.ok, false, name);
    assert.equal(result.code, code, `${name}: ${result.message}`);
    assert.ok(result.message.trim(), name);
    assert.doesNotMatch(JSON.stringify(result), /stored-prtg-key|apitoken=/, name);
  }
}

async function testPrtgKeepsOnlyATestOfTheSavedValues() {
  for (const [name, input, kept] of [
    ['the saved values', {}, true],
    ['the saved address typed again', { base_url: 'https://prtg.example.test/' }, true],
    ['a typed key', { api_token: 'typed-key' }, false],
    ['another address with its key', { base_url: 'https://prtg-other.example.test', api_token: 'typed-key' }, false],
  ] as Array<[string, Record<string, string>, boolean]>) {
    const harness = prtgHarness();
    await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: 'https://prtg.example.test', api_token: 'stored-prtg-key' });
    const result = await harness.service.testPrtgIntegration(harness.context, input);
    assert.equal(result.ok, true, `${name}: ${result.message}`);
    assert.equal(result.persisted, kept, name);
    assert.equal(records(harness.queries), kept ? 1 : 0, name);
    if (kept) {
      const params = harness.queries.find((query) => /WITH changed/.test(query.sql))!.params;
      // What the card says after a reload: the version and the sensors seen.
      assert.deepEqual(JSON.parse(String(params[0])), {
        ok: true, tested_at: result.tested_at, version: result.prtg_version, sensor_count: result.sensor_count,
      });
      assert.equal(result.prtg_version, '24.1');
      // The values the test ran on: the conditional write compares them with the row.
      assert.equal(params[3], 'https://prtg.example.test');
      assert.deepEqual(JSON.parse(String(params[4])), harness.rows[0].credential_ref_json);
    }
  }
}

async function testPrtgKeepsTheCauseOfAFailureAsItsCode() {
  const harness = prtgHarness(() => new Response('unauthorized apitoken=stored-prtg-key', { status: 401 }));
  await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: 'https://prtg.example.test', api_token: 'stored-prtg-key' });
  const result = await harness.service.testPrtgIntegration(harness.context, {});
  assert.equal(result.code, 'prtg_auth');
  const params = harness.queries.find((query) => /WITH changed/.test(query.sql))!.params;
  assert.deepEqual(JSON.parse(String(params[0])), { ok: false, tested_at: result.tested_at, code: 'prtg_auth' });
  // Read back: the detail a card may show, never free text.
  const tested_at = '2026-11-26T10:42:00.000Z';
  assert.deepEqual(
    readLastConnectionTest({ last_connection_test: { ok: true, tested_at, version: '24.1.92', sensor_count: 321, message: 'Connected' } }),
    { ok: true, tested_at, version: '24.1.92', sensor_count: 321 },
  );
  assert.deepEqual(
    readLastConnectionTest({ last_connection_test: { ok: false, tested_at, code: 'Server said <b>no</b>', version: '1' } }),
    { ok: false, tested_at },
  );
  assert.deepEqual(
    readLastConnectionTest({ last_connection_test: { ok: true, tested_at, version: 'v'.repeat(80), sensor_count: -1 } }),
    { ok: true, tested_at },
  );
}

async function testPrtgSaveMarksAReplacedKeyAndDropsTheTest() {
  const LAST_TEST = { ok: true, tested_at: '2026-11-26T10:42:00.000Z' };
  const seeded = async () => {
    const harness = prtgHarness();
    await harness.service.savePrtgIntegration(harness.context, {
      enabled: true, base_url: 'https://prtg.example.test', api_token: 'stored-prtg-key', server_timezone: 'Europe/Paris',
    });
    harness.rows[0].metadata_json = { ...harness.rows[0].metadata_json, last_connection_test: LAST_TEST };
    return harness;
  };
  {
    const harness = await seeded();
    const view = (await harness.service.listMonitoringIntegrations(harness.context)).integrations[0];
    assert.deepEqual(view.last_test, LAST_TEST, 'the card reads the last test after a reload');
    await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: 'https://prtg.example.test', api_token: 'rotated-key' });
    assert.equal(testClears(harness.queries), 1, 'a new key makes the stored test obsolete');
    const entry = harness.audits.at(-1);
    assert.equal(entry.after_json.secret_replaced, true);
    assert.equal(entry.before_json.secret_replaced, undefined);
    assert.equal('last_test' in entry.before_json || 'last_test' in entry.after_json, false, 'a test is never audited');
    assert.doesNotMatch(JSON.stringify(harness.audits), /rotated-key|stored-prtg-key|ciphertext/);
  }
  {
    const harness = await seeded();
    await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: 'https://prtg-other.example.test', api_token: 'new-key' });
    assert.equal(testClears(harness.queries), 1, 'a new address makes the stored test obsolete');
    assert.equal(harness.audits.at(-1).after_json.secret_replaced, undefined);
  }
  {
    const harness = await seeded();
    await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: 'https://prtg.example.test', server_timezone: 'UTC' });
    assert.equal(testClears(harness.queries), 0, 'another setting keeps the test');
    assert.equal(harness.audits.at(-1).after_json.secret_replaced, undefined);
  }
  {
    const harness = await seeded();
    await harness.service.savePrtgIntegration(harness.context, { enabled: true, base_url: '' });
    assert.equal(harness.rows[0].metadata_json?.last_connection_test, undefined, 'the removed server takes its test along');
    assert.equal(harness.rows[0].metadata_json?.server_timezone, 'Europe/Paris');
  }
}

async function run() {
  const tests: Array<[string, () => Promise<void>]> = [
    ['GLPI: a failed test names its cause with a code', testGlpiFailuresCarryACode],
    ['GLPI: only a test of the saved values is kept', testGlpiKeepsOnlyATestOfTheSavedValues],
    ['GLPI: the kept test carries its detail, never a message', testGlpiReadsTheDetailOfTheKeptTest],
    ['GLPI: a replaced token is marked in the audit entry and drops the test', testGlpiSaveMarksAReplacedTokenAndDropsTheTest],
    ['GLPI: an empty address removes the connection', testGlpiEmptyAddressRemovesTheConnection],
    ['PRTG: a failed test names its cause with a code', testPrtgFailuresCarryACode],
    ['PRTG: only a test of the saved values is kept', testPrtgKeepsOnlyATestOfTheSavedValues],
    ['PRTG: a failure is kept with its code, the detail is read back without free text', testPrtgKeepsTheCauseOfAFailureAsItsCode],
    ['PRTG: a replaced key is marked in the audit entry and drops the test', testPrtgSaveMarksAReplacedKeyAndDropsTheTest],
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
