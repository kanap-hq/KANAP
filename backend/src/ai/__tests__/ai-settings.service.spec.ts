import * as assert from 'node:assert/strict';
import { AiSettingsService } from '../ai-settings.service';
import { AiSettings } from '../ai-settings.entity';
import { Features } from '../../config/features';

function createMockSettings(overrides?: Partial<AiSettings>): AiSettings {
  return {
    id: 'settings-1',
    tenant_id: 'tenant-1',
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
    glpi_enabled: false,
    glpi_url: null,
    glpi_user_token_encrypted: null,
    glpi_app_token_encrypted: null,
    builtin_accepted_key: null,
    builtin_accepted_at: null,
    builtin_accepted_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function createService(settings: AiSettings) {
  const queryBuilder = {
    addSelect: () => queryBuilder,
    where: () => ({
      getOne: async () => settings,
    }),
  };
  const repo = {
    manager: {
      getRepository: () => ({
        createQueryBuilder: () => queryBuilder,
        save: async (entity: AiSettings) => entity,
        create: (data: any) => ({ ...settings, ...data }),
      }),
    },
  };

  const providerRegistry = {
    validate: () => [],
    get: () => true,
  };

  const cipher = {
    encrypt: (v: string) => `enc:${v}`,
    canEncrypt: () => true,
  };

  const platformAiConfig = {
    isConfigured: async () => true,
  };

  const modelResolver = {
    readiness: async () => ({ errors: [], errorCode: null, usesBuiltin: false, builtinIdentity: null }),
  };

  return new AiSettingsService(repo as any, providerRegistry as any, cipher as any, platformAiConfig as any, modelResolver as any);
}

async function testRejectsWebSearchWhenEnvVarAbsent() {
  const original = Features.AI_WEB_SEARCH_READY;
  try {
    (Features as any).AI_WEB_SEARCH_READY = false;
    const service = createService(createMockSettings());

    await assert.rejects(
      () => service.update('tenant-1', { web_search_enabled: true }),
      (error: any) => error.message?.includes('BRAVE_SEARCH_API_KEY') || error.response?.message?.includes('BRAVE_SEARCH_API_KEY'),
    );
  } finally {
    (Features as any).AI_WEB_SEARCH_READY = original;
  }
}

async function testAcceptsWebSearchWhenEnvVarPresent() {
  const original = Features.AI_WEB_SEARCH_READY;
  try {
    (Features as any).AI_WEB_SEARCH_READY = true;
    const service = createService(createMockSettings());

    const result = await service.update('tenant-1', { web_search_enabled: true });
    assert.equal(result.web_search_enabled, true);
  } finally {
    (Features as any).AI_WEB_SEARCH_READY = original;
  }
}

async function testUnrelatedSaveDoesNotBlockWhenEnvVarRemoved() {
  const original = Features.AI_WEB_SEARCH_READY;
  try {
    // Simulate env var removed after web_search was already enabled
    (Features as any).AI_WEB_SEARCH_READY = false;
    const service = createService(createMockSettings({
      web_search_enabled: true,
    }));

    // Changing an unrelated field should not fail
    const result = await service.update('tenant-1', { llm_model: 'gpt-4o-mini' });
    assert.equal(result.llm_model, 'gpt-4o-mini');
    // web_search_enabled remains true from the original settings
    assert.equal(result.web_search_enabled, true);
  } finally {
    (Features as any).AI_WEB_SEARCH_READY = original;
  }
}

async function testEnablingGlpiRequiresUrlAndToken() {
  const service = createService(createMockSettings());

  await assert.rejects(
    () => service.update('tenant-1', { glpi_enabled: true }),
    (error: any) => {
      const msg = error.message || error.response?.message || '';
      return msg.includes('glpi_url');
    },
  );

  await assert.rejects(
    () => service.update('tenant-1', {
      glpi_url: 'https://glpi.internal',
      glpi_enabled: true,
    }),
    (error: any) => {
      const msg = error.message || error.response?.message || '';
      return msg.includes('glpi_user_token');
    },
  );
}

async function testGlpiSecretsAreStoredEncryptedAndHiddenInView() {
  const service = createService(createMockSettings());

  const updated = await service.update('tenant-1', {
    glpi_enabled: true,
    glpi_url: 'https://glpi.internal/helpdesk',
    glpi_user_token: 'user-secret',
    glpi_app_token: 'app-secret',
  });
  const view = await service.toView(updated);

  assert.equal(updated.glpi_enabled, true);
  assert.equal(updated.glpi_url, 'https://glpi.internal/helpdesk');
  assert.equal(updated.glpi_user_token_encrypted, 'enc:user-secret');
  assert.equal(updated.glpi_app_token_encrypted, 'enc:app-secret');
  assert.equal(view.glpi_enabled, true);
  assert.equal(view.glpi_url, 'https://glpi.internal/helpdesk');
  assert.equal(view.has_glpi_user_token, true);
  assert.equal(view.has_glpi_app_token, true);
}

async function testGlpiUrlNormalizesApiEndpointToBaseUrl() {
  const service = createService(createMockSettings());

  const updated = await service.update('tenant-1', {
    glpi_url: 'https://glpi.internal/helpdesk/apirest.php',
  });

  assert.equal(updated.glpi_url, 'https://glpi.internal/helpdesk');
}

async function testGlpiUrlNormalizesCopiedApiRoutes() {
  for (const root of ['https://glpi.internal', 'https://glpi.internal/HelpDesk']) {
    for (const suffix of ['', '/', '/apirest.php/', '/apirest.php/initsession', '/apirest.php/initSession/', '/apirest.php/Ticket/42', '/api.php/v1', '/api.php/v1/initSession/']) {
      const service = createService(createMockSettings());
      const updated = await service.update('tenant-1', {
        glpi_url: `${root}${suffix}?get_full_session=true#documentation`,
      });
      assert.equal(updated.glpi_url, new URL(root).toString(), `${root}${suffix}`);
    }
  }
  // Only complete legacy API path segments are stripped.
  for (const path of ['/my-apirest.php', '/apirest.php-backup', '/api.php/v10', '/api.php/v2']) {
    const service = createService(createMockSettings());
    const url = `https://glpi.internal${path}`;
    const updated = await service.update('tenant-1', { glpi_url: url });
    assert.equal(updated.glpi_url, url);
  }
}

// F1 SSRF: in multi-tenant (default here), saving an internal-IP outbound URL is rejected.
async function testRejectsInternalGlpiUrlInCloud() {
  const service = createService(createMockSettings());
  await assert.rejects(
    () => service.update('tenant-1', { glpi_url: 'http://10.0.0.5' }),
    (err: any) => /private or internal/i.test(String(err?.message)),
  );
}

async function testRejectsInternalLlmEndpointInCloud() {
  const service = createService(createMockSettings());
  await assert.rejects(
    () => service.update('tenant-1', { llm_endpoint_url: 'http://127.0.0.1:11434' }),
    (err: any) => /private or internal/i.test(String(err?.message)),
  );
  // A public bare DNS name is still accepted (sync guard does no DNS).
  const ok = await service.update('tenant-1', { llm_endpoint_url: 'https://api.deepseek.com/v1' });
  assert.equal(ok.llm_endpoint_url, 'https://api.deepseek.com/v1');
}

async function run() {
  await testRejectsWebSearchWhenEnvVarAbsent();
  await testAcceptsWebSearchWhenEnvVarPresent();
  await testUnrelatedSaveDoesNotBlockWhenEnvVarRemoved();
  await testEnablingGlpiRequiresUrlAndToken();
  await testGlpiSecretsAreStoredEncryptedAndHiddenInView();
  await testGlpiUrlNormalizesApiEndpointToBaseUrl();
  await testGlpiUrlNormalizesCopiedApiRoutes();
  await testRejectsInternalGlpiUrlInCloud();
  await testRejectsInternalLlmEndpointInCloud();
}

void run();
