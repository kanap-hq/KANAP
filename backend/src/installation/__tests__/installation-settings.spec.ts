import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { validateStartupEnv } from '../../common/env';
import { AiSecretCipherService } from '../../ai/ai-secret-cipher.service';
import { BraveSearchService, WEB_SEARCH_UNAVAILABLE } from '../../ai/web-search/brave-search.service';
import { AI_INSTALLATION_DOMAIN } from '../ai-installation-settings.domain';
import {
  domainState,
  InstallationDomain,
  InstallationSettingWriteError,
  resolveDomain,
  validateWrite,
} from '../installation-settings';
import { installationSettingsSnapshot, InstallationSettingsSnapshot } from '../installation-settings.snapshot';
import { settingsEncryptionSecret } from '../settings-encryption-secret';

// The rule of the installation settings, without a database:
// - the file, else the database, else the default; an empty value or spaces count as absent; an
//   unreadable file value counts as absent and is said; no row is a database without values;
// - the state never carries a secret; a write is refused for an unknown or locked setting, a value
//   out of its type or bounds, and a secret without an encryption key;
// - a default may depend on the mode or on another setting (a declaration, not a new service);
// - the switches of Features are rewritten only when their resolved value changes;
// - the intended change: a web search key made of spaces no longer counts as configured;
// - the encryption key: the new name, the former name, both with the same value; different values
//   refuse the start and name both variables.

const ENV = (values: Record<string, string>) => ({ DEPLOYMENT_MODE: 'multi-tenant', ...values }) as NodeJS.ProcessEnv;
const ROW = { web_search_api_key: 'database-key', chat_max_tokens: 777, ticket_max_images: 2, ticket_max_image_bytes: 4321 };

function testResolution() {
  // File and database: the file wins and locks.
  const both = resolveDomain(AI_INSTALLATION_DOMAIN, ROW, ENV({ AI_CHAT_MAX_TOKENS: '9000', BRAVE_SEARCH_API_KEY: 'file-key' }));
  assert.deepEqual(
    [both.get('chat_max_tokens')!.value, both.get('chat_max_tokens')!.source, both.get('chat_max_tokens')!.locked],
    [9000, 'file', true],
  );
  assert.deepEqual([both.get('web_search_api_key')!.value, both.get('web_search_api_key')!.source], ['file-key', 'file']);
  // Database only.
  const database = resolveDomain(AI_INSTALLATION_DOMAIN, ROW, ENV({}));
  for (const [key, value] of Object.entries(ROW)) {
    assert.deepEqual([database.get(key)!.value, database.get(key)!.source, database.get(key)!.locked], [value, 'database', false], key);
  }
  // Neither, with a row of nulls or without a row.
  for (const row of [{ web_search_api_key: null, chat_max_tokens: null, ticket_max_images: null, ticket_max_image_bytes: null }, null]) {
    const none = resolveDomain(AI_INSTALLATION_DOMAIN, row, ENV({}));
    assert.deepEqual(
      [...none.values()].map((setting) => [setting.declaration.key, setting.value, setting.source]),
      [
        ['web_search_api_key', null, 'default'],
        ['chat_max_tokens', 16384, 'default'],
        ['ticket_max_images', 5, 'default'],
        ['ticket_max_image_bytes', 20971520, 'default'],
      ],
    );
  }
  // Empty or spaces: absent. Unreadable: absent, and said.
  for (const raw of ['', '   ']) {
    const blank = resolveDomain(AI_INSTALLATION_DOMAIN, ROW, ENV({ AI_CHAT_MAX_TOKENS: raw, BRAVE_SEARCH_API_KEY: raw }));
    assert.deepEqual([blank.get('chat_max_tokens')!.source, blank.get('chat_max_tokens')!.fileUnreadable], ['database', false]);
    assert.equal(blank.get('web_search_api_key')!.value, 'database-key');
  }
  for (const raw of ['0', '-5', 'abc']) {
    const unreadable = resolveDomain(AI_INSTALLATION_DOMAIN, ROW, ENV({ AI_CHAT_MAX_TOKENS: raw }));
    assert.deepEqual(
      [unreadable.get('chat_max_tokens')!.value, unreadable.get('chat_max_tokens')!.source, unreadable.get('chat_max_tokens')!.fileUnreadable],
      [777, 'database', true],
      raw,
    );
  }
  // Today's reading of the file: '11' images is 10, '12abc' is 12.
  assert.equal(resolveDomain(AI_INSTALLATION_DOMAIN, null, ENV({ AI_AGENT_VISION_MAX_IMAGES: '11' })).get('ticket_max_images')!.value, 10);
  assert.equal(resolveDomain(AI_INSTALLATION_DOMAIN, null, ENV({ AI_CHAT_MAX_TOKENS: '12abc' })).get('chat_max_tokens')!.value, 12);
}

function testStateHoldsNoSecret() {
  const state = domainState(resolveDomain(AI_INSTALLATION_DOMAIN, ROW, ENV({})));
  assert.deepEqual(state.web_search_api_key, { has_value: true, stored_unreadable: false, source: 'database', locked: false, file_unreadable: false });
  assert.ok(!JSON.stringify(state).includes('database-key'));
  const fromFile = domainState(resolveDomain(AI_INSTALLATION_DOMAIN, null, ENV({ BRAVE_SEARCH_API_KEY: 'file-key' })));
  assert.deepEqual(fromFile.web_search_api_key, { has_value: true, stored_unreadable: false, source: 'file', locked: true, file_unreadable: false });
  assert.ok(!JSON.stringify(fromFile).includes('file-key'));
  assert.deepEqual(state.ticket_max_images, { value: 2, default: 5, source: 'database', locked: false, file_unreadable: false, min: 1, max: 10 });
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof InstallationSettingWriteError, String(error));
    return error.code;
  }
  assert.fail('expected a refusal');
}

function testWrites() {
  const resolved = resolveDomain(AI_INSTALLATION_DOMAIN, null, ENV({ AI_AGENT_VISION_MAX_IMAGE_BYTES: '1048576' }));
  const write = (body: unknown, canEncrypt = true) => validateWrite(AI_INSTALLATION_DOMAIN, body, resolved, { canEncrypt });
  assert.deepEqual([...write({ ticket_max_images: 10, chat_max_tokens: null, web_search_api_key: '  key  ' })], [
    ['ticket_max_images', 10], ['chat_max_tokens', null], ['web_search_api_key', 'key'],
  ]);
  assert.deepEqual([...write({ web_search_api_key: '   ' }, false)], [['web_search_api_key', null]], 'a blank key clears, no encryption needed');
  assert.deepEqual([...write({ web_search_api_key: null }, false)], [['web_search_api_key', null]]);
  assert.equal(code(() => write({ web_search_api_key: 'key' }, false)), 'settings_encryption_unavailable');
  for (const value of [0, -1, 11, 2.5, '3', true]) assert.equal(code(() => write({ ticket_max_images: value })), 'installation_setting_invalid', String(value));
  assert.equal(code(() => write({ chat_max_tokens: 2_147_483_648 })), 'installation_setting_invalid');
  assert.equal(code(() => write({ web_search_api_key: 12 })), 'installation_setting_invalid');
  assert.equal(code(() => write({ ticket_max_image_bytes: 2048 })), 'installation_setting_locked');
  assert.equal(code(() => write({ llm_model: 'x' })), 'installation_setting_unknown');
  for (const body of [null, [], 'x']) assert.equal(code(() => write(body)), 'installation_setting_invalid');
}

/** A domain of the shape S5 and I2 declare: a string, a switch whose default follows the mode and another setting. */
function testDeclarationDefaults() {
  const domain: InstallationDomain = {
    name: 'spec',
    table: 'installation_spec_settings',
    settings: [
      { key: 'feed_url', column: 'feed_url', env: 'SPEC_FEED_URL', aliases: ['SPEC_OLD_FEED_URL'], type: 'string', maxLength: 20, default: null },
      { key: 'feed_enabled', column: 'feed_enabled', env: 'SPEC_FEED_ENABLED', type: 'boolean', default: ({ singleTenant }) => !singleTenant },
      { key: 'list_enabled', column: 'list_enabled', env: 'SPEC_LIST_ENABLED', type: 'boolean', default: ({ value }) => value('feed_enabled') === true },
    ],
  };
  const values = (env: Record<string, string>, row: Record<string, unknown> | null = null) =>
    [...resolveDomain(domain, row, env as NodeJS.ProcessEnv).values()].map((setting) => setting.value);
  assert.deepEqual(values({ DEPLOYMENT_MODE: 'multi-tenant' }), [null, true, true]);
  assert.deepEqual(values({ DEPLOYMENT_MODE: 'single-tenant' }), [null, false, false]);
  assert.deepEqual(values({ DEPLOYMENT_MODE: 'single-tenant' }, { feed_enabled: true }), [null, true, true], 'the stored switch carries the next default');
  assert.deepEqual(values({ SPEC_FEED_ENABLED: 'no', SPEC_OLD_FEED_URL: 'https://a.test' }, { feed_enabled: true }), ['https://a.test', false, false]);
  const resolved = resolveDomain(domain, null, {} as NodeJS.ProcessEnv);
  assert.equal(code(() => validateWrite(domain, { feed_url: 'x'.repeat(21) }, resolved, { canEncrypt: true })), 'installation_setting_invalid');
  assert.deepEqual([...validateWrite(domain, { feed_url: '  https://b.test ', feed_enabled: false }, resolved, { canEncrypt: true })], [
    ['feed_url', 'https://b.test'], ['feed_enabled', false],
  ]);
}

function testFeaturesFollowOnlyChanges() {
  const previousKey = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  const target: Record<string, unknown> = { AI_WEB_SEARCH_READY: 'set by a spec' };
  const snapshot = new InstallationSettingsSnapshot();
  try {
    snapshot.featuresAtLoad();
    assert.deepEqual(snapshot.applyFeatures(AI_INSTALLATION_DOMAIN, target), [], 'unchanged: not written');
    assert.equal(target.AI_WEB_SEARCH_READY, 'set by a spec');
    snapshot.setRow('ai', { web_search_api_key: 'database-key' });
    assert.deepEqual(snapshot.applyFeatures(AI_INSTALLATION_DOMAIN, target), ['AI_WEB_SEARCH_READY']);
    assert.equal(target.AI_WEB_SEARCH_READY, true);
    target.AI_WEB_SEARCH_READY = false;
    assert.deepEqual(snapshot.applyFeatures(AI_INSTALLATION_DOMAIN, target), [], 'same resolved value: the spec keeps its own');
    assert.equal(target.AI_WEB_SEARCH_READY, false);
    snapshot.setRow('ai', null);
    snapshot.applyFeatures(AI_INSTALLATION_DOMAIN, target);
    assert.equal(target.AI_WEB_SEARCH_READY, false);
  } finally {
    if (previousKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = previousKey;
  }
}

async function testKeyOfSpacesIsNotConfigured() {
  const previousKey = process.env.BRAVE_SEARCH_API_KEY;
  process.env.BRAVE_SEARCH_API_KEY = '   ';
  try {
    const features = '../../config/features';
    delete require.cache[require.resolve(features)];
    assert.equal(require(features).Features.AI_WEB_SEARCH_READY, false, 'not ready at load');
    assert.equal(installationSettingsSnapshot.value(AI_INSTALLATION_DOMAIN, 'web_search_api_key'), null);
    await assert.rejects(() => new BraveSearchService().search('public question'), (error: Error) => error.message === WEB_SEARCH_UNAVAILABLE);
    const test = await new BraveSearchService().testConnectivity();
    assert.deepEqual(test, { ok: false, message: WEB_SEARCH_UNAVAILABLE, latency_ms: null });
    assert.ok(!WEB_SEARCH_UNAVAILABLE.includes('BRAVE'), 'the message names no variable');
  } finally {
    if (previousKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = previousKey;
  }
  assert.equal(typeof Features.AI_WEB_SEARCH_READY, 'boolean');
}

function testEncryptionKeyNames() {
  assert.equal(settingsEncryptionSecret({ SETTINGS_ENCRYPTION_SECRET: 'new' } as NodeJS.ProcessEnv), 'new');
  assert.equal(settingsEncryptionSecret({ AI_SETTINGS_ENCRYPTION_SECRET: 'old' } as NodeJS.ProcessEnv), 'old');
  assert.equal(settingsEncryptionSecret({ SETTINGS_ENCRYPTION_SECRET: 'same', AI_SETTINGS_ENCRYPTION_SECRET: 'same' } as NodeJS.ProcessEnv), 'same');
  assert.equal(settingsEncryptionSecret({ SETTINGS_ENCRYPTION_SECRET: '  ', AI_SETTINGS_ENCRYPTION_SECRET: 'old' } as NodeJS.ProcessEnv), 'old');
  assert.equal(settingsEncryptionSecret({} as NodeJS.ProcessEnv), null);
  const conflict = { SETTINGS_ENCRYPTION_SECRET: 'new', AI_SETTINGS_ENCRYPTION_SECRET: 'old' } as NodeJS.ProcessEnv;
  const namesBoth = (error: Error) => error.message.includes('SETTINGS_ENCRYPTION_SECRET and AI_SETTINGS_ENCRYPTION_SECRET')
    && !error.message.includes("'new'") && !error.message.includes("'old'");
  assert.throws(() => settingsEncryptionSecret(conflict), namesBoth);
  const startup = { DATABASE_URL: 'postgres://localhost/db', JWT_SECRET: 'x'.repeat(40), APP_ENV: 'development' };
  assert.throws(() => validateStartupEnv({ ...startup, ...conflict }, { singleTenant: true }), namesBoth, 'the start is refused');
  assert.doesNotThrow(() => validateStartupEnv({ ...startup, SETTINGS_ENCRYPTION_SECRET: 'same', AI_SETTINGS_ENCRYPTION_SECRET: 'same' }, { singleTenant: false }));

  // A secret stored under the former name reads under the new one.
  const saved = [process.env.SETTINGS_ENCRYPTION_SECRET, process.env.AI_SETTINGS_ENCRYPTION_SECRET];
  try {
    const cipher = new AiSecretCipherService();
    delete process.env.SETTINGS_ENCRYPTION_SECRET;
    process.env.AI_SETTINGS_ENCRYPTION_SECRET = 'spec-key';
    const stored = cipher.encrypt('provider-key');
    delete process.env.AI_SETTINGS_ENCRYPTION_SECRET;
    assert.equal(cipher.canEncrypt(), false);
    process.env.SETTINGS_ENCRYPTION_SECRET = 'spec-key';
    assert.equal(cipher.decrypt(stored), 'provider-key');
  } finally {
    if (saved[0] === undefined) delete process.env.SETTINGS_ENCRYPTION_SECRET;
    else process.env.SETTINGS_ENCRYPTION_SECRET = saved[0];
    if (saved[1] === undefined) delete process.env.AI_SETTINGS_ENCRYPTION_SECRET;
    else process.env.AI_SETTINGS_ENCRYPTION_SECRET = saved[1];
  }
}

async function run() {
  testResolution();
  testStateHoldsNoSecret();
  testWrites();
  testDeclarationDefaults();
  testFeaturesFollowOnlyChanges();
  await testKeyOfSpacesIsNotConfigured();
  testEncryptionKeyNames();
  console.log('installation-settings.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
