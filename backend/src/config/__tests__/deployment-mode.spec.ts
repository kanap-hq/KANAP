import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { parseDeploymentMode } from '../../common/deployment-mode';
import { validateStartupEnv } from '../../common/env';
import { BACKEND_ROOT } from '../../common/__tests__/backend-root';

// DEPLOYMENT_MODE: single-tenant, multi-tenant, or unset (multi-tenant). Anything else refuses
// to start. features.ts reads it once, at load, through parseDeploymentMode.

const BASE_ENV = { DATABASE_URL: 'postgres://example.test/db', JWT_SECRET: 'deployment-mode-spec' };

function messageFor(raw: string): string {
  try {
    parseDeploymentMode(raw);
  } catch (err) {
    assert.ok(err instanceof Error, String(err));
    return err.message;
  }
  assert.fail(`expected ${JSON.stringify(raw)} to be refused`);
}

function testAcceptedValues() {
  assert.equal(parseDeploymentMode(undefined), 'multi-tenant');
  assert.equal(parseDeploymentMode(''), 'multi-tenant');
  assert.equal(parseDeploymentMode('   '), 'multi-tenant');
  assert.equal(parseDeploymentMode('multi-tenant'), 'multi-tenant');
  assert.equal(parseDeploymentMode('MULTI-TENANT'), 'multi-tenant');
  assert.equal(parseDeploymentMode(' multi-tenant '), 'multi-tenant');
  assert.equal(parseDeploymentMode('single-tenant'), 'single-tenant');
  assert.equal(parseDeploymentMode('Single-Tenant'), 'single-tenant');
  assert.equal(parseDeploymentMode(' single-tenant '), 'single-tenant');
}

function testRefusedValues() {
  for (const raw of ['single_tenant', 'singletenant', 'on-prem', 'cloud']) {
    const message = messageFor(raw);
    assert.match(message, /FATAL: DEPLOYMENT_MODE is "/, raw);
    assert.ok(message.includes(raw), message);
    assert.match(message, /single-tenant, multi-tenant, or unset/, raw);
  }
  const spaced = messageFor('  single_tenant  ');
  assert.ok(spaced.includes('"single_tenant"'), spaced);
}

function testStartupValidator() {
  assert.throws(
    () => validateStartupEnv({ ...BASE_ENV, DEPLOYMENT_MODE: 'single_tenant' }, { singleTenant: false }),
    /Accepted values are single-tenant, multi-tenant, or unset/,
  );
  assert.doesNotThrow(() => validateStartupEnv(
    { ...BASE_ENV, APP_ENV: 'development', DEPLOYMENT_MODE: 'single-tenant' },
    { singleTenant: true },
  ));
  assert.doesNotThrow(() => validateStartupEnv(
    { ...BASE_ENV, APP_ENV: 'development', DEPLOYMENT_MODE: 'multi-tenant' },
    { singleTenant: false },
  ));
  assert.doesNotThrow(() => validateStartupEnv(
    { ...BASE_ENV, APP_ENV: 'development' },
    { singleTenant: false },
  ));
}

/** Load features.ts in a fresh process: the mode is fixed at import. */
function loadFeatures(mode: string | undefined): { status: number | null; stderr: string; stdout: string } {
  const env = { ...process.env };
  if (mode === undefined) delete env.DEPLOYMENT_MODE;
  else env.DEPLOYMENT_MODE = mode;
  const featuresPath = path.join(__dirname, '..', 'features');
  const args = __filename.endsWith('.ts') ? ['-r', 'ts-node/register/transpile-only'] : [];
  args.push('-e', `const { Features } = require(${JSON.stringify(featuresPath)}); process.stdout.write(Features.DEPLOYMENT_MODE + '\\n' + String(Features.SINGLE_TENANT));`);
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', cwd: BACKEND_ROOT });
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

function testFeaturesLoad() {
  const unset = loadFeatures(undefined);
  assert.equal(unset.status, 0, unset.stderr);
  assert.equal(unset.stdout, 'multi-tenant\nfalse');

  const single = loadFeatures('Single-Tenant');
  assert.equal(single.status, 0, single.stderr);
  assert.equal(single.stdout, 'single-tenant\ntrue');

  const multi = loadFeatures('multi-tenant');
  assert.equal(multi.status, 0, multi.stderr);
  assert.equal(multi.stdout, 'multi-tenant\nfalse');

  const typo = loadFeatures('single_tenant');
  assert.notEqual(typo.status, 0, typo.stdout);
  assert.match(typo.stderr, /FATAL: DEPLOYMENT_MODE is "single_tenant"/);
  assert.match(typo.stderr, /Accepted values are single-tenant, multi-tenant, or unset/);
}

testAcceptedValues();
testRefusedValues();
testStartupValidator();
testFeaturesLoad();
console.log('deployment-mode.spec: ok');
