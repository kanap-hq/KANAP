import * as assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { Features } from '../../config/features';
import { validateStartupEnv } from '../env';
import { JWT_SECRET_MIN_LENGTH, JWT_SECRET_WARNING, jwtSecretWarnings } from '../startup-secrets';
import { backendPath } from './backend-root';

// JWT_SECRET at start-up: a value shorter than 32 characters (leading and trailing spaces not
// counted) gives one [SECURITY] warning line in every run mode and deployment mode. The start-up
// is never refused for it, and the line carries neither the value nor its length.

const MODES: Array<{ label: string; env: Record<string, string> }> = [
  { label: 'production', env: { APP_ENV: 'production', APP_BASE_URL: 'https://kanap.example.com', CORS_ORIGINS: 'https://kanap.example.com' } },
  { label: 'development', env: { APP_ENV: 'development' } },
  { label: 'unspecified', env: {} },
];

const DEPLOYMENTS: Array<{ label: string; singleTenant: boolean }> = [
  { label: 'single-tenant', singleTenant: true },
  { label: 'multi-tenant', singleTenant: false },
];

function secretOfLength(length: number): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

function envFor(mode: Record<string, string>, singleTenant: boolean, jwtSecret: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://app:app@localhost:5432/appdb',
    DEPLOYMENT_MODE: singleTenant ? 'single-tenant' : 'multi-tenant',
    ...mode,
    JWT_SECRET: jwtSecret,
  };
}

function withSingleTenant<T>(singleTenant: boolean, fn: () => T): T {
  const previous = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    return fn();
  } finally {
    (Features as any).SINGLE_TENANT = previous;
  }
}

function testLengthMatrix() {
  const cases: Array<{ label: string; secret: string; warns: boolean }> = [
    { label: '31 characters', secret: secretOfLength(31), warns: true },
    { label: '32 characters', secret: secretOfLength(32), warns: false },
    { label: '64 characters', secret: secretOfLength(64), warns: false },
    { label: '31 characters inside spaces', secret: `  ${secretOfLength(31)}\t `, warns: true },
    { label: '32 characters inside spaces', secret: ` ${secretOfLength(32)}  `, warns: false },
    { label: '1 character', secret: 'x', warns: true },
  ];
  for (const mode of MODES) {
    for (const deployment of DEPLOYMENTS) {
      withSingleTenant(deployment.singleTenant, () => {
        for (const testCase of cases) {
          const label = `${testCase.label}, ${mode.label}, ${deployment.label}`;
          const env = envFor(mode.env, deployment.singleTenant, testCase.secret);
          // The start-up goes on: the environment checks do not refuse a short secret.
          assert.doesNotThrow(() => validateStartupEnv(env, { singleTenant: deployment.singleTenant }), label);
          const warnings = jwtSecretWarnings(env);
          assert.deepEqual(warnings, testCase.warns ? [JWT_SECRET_WARNING] : [], label);
        }
      });
    }
  }
}

function testMessageCarriesNoSecret() {
  const secret = secretOfLength(31);
  const [line] = jwtSecretWarnings({ JWT_SECRET: secret });
  assert.ok(line.startsWith('[SECURITY] '), 'a [SECURITY] line');
  assert.ok(line.includes('JWT_SECRET'), 'names the setting');
  assert.ok(!line.includes(secret), 'not the value');
  for (let start = 0; start + 8 <= secret.length; start += 1) {
    assert.ok(!line.includes(secret.slice(start, start + 8)), 'no part of the value');
  }
  assert.ok(!/\b31\b/.test(line), 'not its length');
  assert.ok(line.includes(String(JWT_SECRET_MIN_LENGTH)), 'gives the expected minimum');
}

function testMissingSecretIsLeftToTheEnvironmentCheck() {
  assert.deepEqual(jwtSecretWarnings({}), []);
  assert.deepEqual(jwtSecretWarnings({ JWT_SECRET: '   ' }), []);
  assert.throws(
    () => validateStartupEnv({ DATABASE_URL: 'postgres://localhost/db', JWT_SECRET: '' }, { singleTenant: true }),
    /JWT_SECRET environment variable is required/,
  );
}

function testMainPrintsSecurityLinesInTheLeadProcessOnly() {
  const main = fs.readFileSync(backendPath('src', 'main.ts'), 'utf8');
  assert.match(main, /new Set<string>\(jwtSecretWarnings\(process\.env\)\)/, 'main.ts collects the JWT_SECRET line');
  assert.match(main, /if \(isLeadProcess\(\)\) securityWarnings\.forEach\(/, 'the lead process prints the [SECURITY] lines');
  assert.match(main, /checkPassword: isLeadProcess\(\)/, 'the lead process checks the administrator password');
}

function run() {
  testLengthMatrix();
  testMessageCarriesNoSecret();
  testMissingSecretIsLeftToTheEnvironmentCheck();
  testMainPrintsSecurityLinesInTheLeadProcessOnly();
  console.log('startup-secrets.spec: ok');
}

run();
