/**
 * Key separation for the non-access families.
 *
 * A family with its own key uses ONLY that key: no retry with `JWT_SECRET` after a failed
 * verification, so each family stays verifiable with its own key alone. A family
 * without its own key derives one from `JWT_SECRET` through a distinct, versioned HMAC label.
 */
import * as assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { createHmac } from 'crypto';
import {
  TOKEN_SECRET_LABEL,
  TOKEN_SECRET_LABEL_PREFIX,
  deriveSecret,
  describeSecretPolicy,
  getEntraStateSecret,
  getPasswordResetSecret,
  getProvisioningSecret,
  resolveFamilySecret,
} from '../token-secret.util';
import {
  ENTRA_LOGIN_HANDOFF_TYPE,
  ENTRA_STATE_PURPOSE,
  PROVISIONING_PURPOSE,
  PASSWORD_RESET_PURPOSE,
  MCP_ACCESS_PURPOSE,
  MCP_OAUTH_CODE_PURPOSE,
} from '../access-token.util';

const JWT_SECRET = 'token-secret-spec-jwt-secret';

function cleanEnv(): NodeJS.ProcessEnv {
  return {
    JWT_SECRET,
    PASSWORD_RESET_SECRET: '',
    PROVISIONING_TOKEN_SECRET: '',
    ENTRA_STATE_SECRET: '',
    MCP_OAUTH_CODE_SECRET: '',
    MCP_ACCESS_TOKEN_SECRET: '',
    CREATION_TOKEN_SECRET: '',
  } as NodeJS.ProcessEnv;
}

function testLabelsAreStableAndVersioned() {
  const expected = {
    'password-reset': 'kanap:v1:password-reset',
    'entra-state': 'kanap:v1:entra-state',
    'mcp-oauth-code': 'kanap:v1:mcp-oauth-code',
    'mcp-access': 'kanap:v1:mcp-access',
    creation: 'kanap:v1:creation',
  };
  assert.deepEqual({ ...TOKEN_SECRET_LABEL }, expected);
  for (const label of Object.values(TOKEN_SECRET_LABEL)) {
    assert.ok(label.startsWith(TOKEN_SECRET_LABEL_PREFIX), `label ${label} must be versioned`);
  }
  // The markers are frozen contract: changing one invalidates every token of that family, and the
  // provisioning issuer lives outside this repository, so its marker cannot move with a label.
  assert.equal(PASSWORD_RESET_PURPOSE, 'kanap:v1:password-reset');
  assert.equal(ENTRA_STATE_PURPOSE, 'kanap:v1:entra-state');
  assert.equal(PROVISIONING_PURPOSE, 'provision');
  assert.equal(MCP_OAUTH_CODE_PURPOSE, 'kanap:v1:mcp-oauth-code');
  assert.equal(MCP_ACCESS_PURPOSE, 'kanap:v1:mcp-access');
}

function testDerivedKeysAreDistinctAndNeverTheBaseSecret() {
  const reset = deriveSecret(JWT_SECRET, 'password-reset');
  const state = deriveSecret(JWT_SECRET, 'entra-state');
  const code = deriveSecret(JWT_SECRET, 'mcp-oauth-code');
  const access = deriveSecret(JWT_SECRET, 'mcp-access');
  const creation = deriveSecret(JWT_SECRET, 'creation');

  assert.notEqual(reset, probe(JWT_SECRET, 'password-reset'));
  for (const [name, key] of [['reset', reset], ['state', state], ['code', code], ['access', access], ['creation', creation]] as const) {
    assert.notEqual(key, JWT_SECRET, `${name} key must not be the access-token secret`);
    assert.match(key, /^[0-9a-f]{64}$/, `${name} key must be the HMAC digest`);
  }
  assert.equal(new Set([reset, state, code, access, creation]).size, 5, 'families must derive distinct keys');
}

function testProvisioningKeepsTheHistoricalKeyUntilToldOtherwise() {
  // The provisioning tokens are minted outside this repository: defaulting to a derived key would
  // break every exchange until that issuer learns the derivation. `JWT_SECRET` stays the default.
  const fallback = resolveFamilySecret('provisioning', cleanEnv());
  assert.equal(fallback.source, 'jwt-secret');
  assert.equal(fallback.secret, JWT_SECRET);
  assert.equal(fallback.envVar, 'PROVISIONING_TOKEN_SECRET');

  // The dedicated key takes over as soon as it is configured — and then it is the only one.
  const env = cleanEnv();
  env.PROVISIONING_TOKEN_SECRET = 'dedicated-provisioning-key';
  const dedicated = resolveFamilySecret('provisioning', env);
  assert.equal(dedicated.source, 'dedicated-key');
  assert.equal(dedicated.secret, 'dedicated-provisioning-key');
  assert.notEqual(dedicated.secret, JWT_SECRET);
}

function probe(secret: string, label: string) {
  return createHmac('sha256', secret).update(label, 'utf8').digest('hex');
}

function testDerivationIsDeterministicAndLabelSensitive() {
  assert.equal(deriveSecret(JWT_SECRET, 'password-reset'), deriveSecret(JWT_SECRET, 'password-reset'));
  assert.notEqual(deriveSecret(JWT_SECRET, 'password-reset'), deriveSecret('another-jwt-secret', 'password-reset'));
  // A version bump must rotate the material.
  const v2 = createHmac('sha256', JWT_SECRET).update('kanap:v2:password-reset', 'utf8').digest('hex');
  assert.notEqual(deriveSecret(JWT_SECRET, 'password-reset'), v2);
}

function testDedicatedKeyWinsAndIsTheOnlyKeyTried() {
  const env = cleanEnv();
  env.PASSWORD_RESET_SECRET = 'dedicated-reset-key';
  const resolved = resolveFamilySecret('password-reset', env);
  assert.equal(resolved.source, 'dedicated-key');
  assert.equal(resolved.secret, 'dedicated-reset-key');
  assert.equal(resolved.envVar, 'PASSWORD_RESET_SECRET');
  assert.notEqual(resolved.secret, deriveSecret(JWT_SECRET, 'password-reset'));

  // No fallback: a token of that family signed with the other candidate key must not verify.
  const token = jwt.sign({ purpose: PASSWORD_RESET_PURPOSE }, deriveSecret(JWT_SECRET, 'password-reset'));
  assert.throws(() => jwt.verify(token, resolved.secret), /invalid signature/);
}

function testEachFamilyReadsItsOwnVariable() {
  const env = cleanEnv();
  assert.equal(resolveFamilySecret('password-reset', env).envVar, 'PASSWORD_RESET_SECRET');
  assert.equal(resolveFamilySecret('provisioning', env).envVar, 'PROVISIONING_TOKEN_SECRET');
  assert.equal(resolveFamilySecret('entra-state', env).envVar, 'ENTRA_STATE_SECRET');

  env.PROVISIONING_TOKEN_SECRET = 'dedicated-provisioning-key';
  env.ENTRA_STATE_SECRET = 'dedicated-state-key';
  assert.equal(getProvisioningSecret(env), 'dedicated-provisioning-key');
  assert.equal(getEntraStateSecret(env), 'dedicated-state-key');
  // Setting another family's variable must not change this family's key.
  assert.equal(getPasswordResetSecret(env), deriveSecret(JWT_SECRET, 'password-reset'));
}

function testDerivedSecretsCannotVerifyAsAccessTokens() {
  // A family that derives its own key is not signed with the access-token secret at all.
  for (const family of ['password-reset', 'entra-state', 'mcp-oauth-code', 'mcp-access', 'creation'] as const) {
    const token = jwt.sign({ purpose: TOKEN_SECRET_LABEL[family], sub: 'user-1' }, deriveSecret(JWT_SECRET, family));
    assert.throws(() => jwt.verify(token, JWT_SECRET), /invalid signature/, `${family} must not verify with JWT_SECRET`);
  }
  const handoff = jwt.sign({ type: ENTRA_LOGIN_HANDOFF_TYPE, userId: 'user-1' }, deriveSecret(JWT_SECRET, 'entra-state'));
  assert.throws(() => jwt.verify(handoff, JWT_SECRET), /invalid signature/);

  // Provisioning shares `JWT_SECRET` by default, so it verifies — the purpose claim is the only
  // thing that stops it being used as an access credential (see the guard spec).
  const provisioning = jwt.sign({ purpose: PROVISIONING_PURPOSE, sub: 'user-1' }, JWT_SECRET);
  assert.doesNotThrow(() => jwt.verify(provisioning, JWT_SECRET));
  assert.equal((jwt.verify(provisioning, JWT_SECRET) as any).purpose, PROVISIONING_PURPOSE);
}

function testSecretPolicyReportsSourcesWithoutValues() {
  const env = cleanEnv();
  env.ENTRA_STATE_SECRET = 'dedicated-state-key';
  const policy = describeSecretPolicy(env);
  assert.deepEqual(policy, [
    { family: 'password-reset', envVar: 'PASSWORD_RESET_SECRET', source: 'derived-key' },
    { family: 'provisioning', envVar: 'PROVISIONING_TOKEN_SECRET', source: 'jwt-secret' },
    { family: 'entra-state', envVar: 'ENTRA_STATE_SECRET', source: 'dedicated-key' },
    { family: 'mcp-oauth-code', envVar: 'MCP_OAUTH_CODE_SECRET', source: 'derived-key' },
    { family: 'mcp-access', envVar: 'MCP_ACCESS_TOKEN_SECRET', source: 'derived-key' },
    { family: 'creation', envVar: 'CREATION_TOKEN_SECRET', source: 'derived-key' },
  ]);
  // Nothing that could leak a secret value.
  const serialized = JSON.stringify(policy);
  for (const value of [JWT_SECRET, 'dedicated-state-key', deriveSecret(JWT_SECRET, 'password-reset')]) {
    assert.ok(!serialized.includes(value), 'policy report must not contain key material');
  }
}

function testMissingJwtSecretIsAnExplicitFailure() {
  assert.throws(
    () => deriveSecret('', 'password-reset'),
    /cannot derive a token family key without JWT_SECRET/,
  );
}

function run() {
  testLabelsAreStableAndVersioned();
  testDerivedKeysAreDistinctAndNeverTheBaseSecret();
  testProvisioningKeepsTheHistoricalKeyUntilToldOtherwise();
  testDerivationIsDeterministicAndLabelSensitive();
  testDedicatedKeyWinsAndIsTheOnlyKeyTried();
  testEachFamilyReadsItsOwnVariable();
  testDerivedSecretsCannotVerifyAsAccessTokens();
  testSecretPolicyReportsSourcesWithoutValues();
  testMissingJwtSecretIsAnExplicitFailure();
  // eslint-disable-next-line no-console
  console.log('token-secret.util.spec: OK (9 cases)');
}

run();
