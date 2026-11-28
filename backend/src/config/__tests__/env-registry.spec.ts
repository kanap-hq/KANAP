import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ENV_EXAMPLE_SECTIONS,
  ENV_EXAMPLE_SECTION_IDS,
  ENV_LABELS,
  ENV_LANGUAGES,
  ENV_REGISTRY,
  envNamePattern,
  findEnvVariable,
} from '../env-registry';
import {
  MANUAL_BLOCK_END,
  MANUAL_BLOCK_START,
  ONPREM_EXAMPLE_FILE,
  manualConfigurationFile,
  renderEnvReferenceFiles,
  renderManualBlock,
  renderOnPremExample,
  sectionVariables,
} from '../env-registry-render';
import { backendPath } from '../../common/__tests__/backend-root';

// The registry of environment variables (config/env-registry.ts) against the code that reads
// them and the files it produces. No database.

const REPO_ROOT = path.dirname(backendPath());
const readRepo = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

/**
 * Path 4: reads with a variable name (`process.env[name]`, `env[key]`, `process.env as ...`).
 * Each file that holds one is declared with the names it reads. `builtFrom` is the literal the
 * file builds its names from, when they are not written whole anywhere.
 */
const DYNAMIC_READERS: Record<string, { names: readonly string[]; builtFrom?: string; why?: string }> = {
  'src/common/env.ts': { names: ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DEFAULT_TENANT_SLUG', 'JWT_SECRET', 'DATABASE_URL', 'ENTRA_CLIENT_SECRET', 'ENTRA_AUTHORITY', 'ENTRA_REDIRECT_URI'] },
  'src/common/url.ts': { names: ['APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL'] },
  'src/common/request-db-timeouts.ts': { names: ['DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS'] },
  'src/auth/token-secret.util.ts': {
    names: ['PASSWORD_RESET_SECRET', 'PROVISIONING_TOKEN_SECRET', 'MCP_OAUTH_CODE_SECRET', 'MCP_ACCESS_TOKEN_SECRET', 'CREATION_TOKEN_SECRET', 'ENTRA_STATE_SECRET'],
  },
  'src/auth/access-token.util.ts': { names: ['JWT_LEGACY_ACCESS_TOKEN_DEADLINE'] },
  'src/email/email-config.ts': {
    names: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PASS', 'SMTP_FROM', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
  },
  'src/email/email.service.ts': {
    names: ['EMAIL_QUEUE_MIN_INTERVAL_MS', 'EMAIL_RATE_LIMIT_MAX_RETRIES', 'EMAIL_RATE_LIMIT_RETRY_BASE_MS', 'EMAIL_RATE_LIMIT_RETRY_MAX_MS', 'EMAIL_RATE_LIMIT_RETRY_JITTER_MS'],
  },
  'src/vulnerabilities/cve-list-feed.service.ts': { names: ['CVE_LIST_RELEASES_URL', 'CVE_LIST_DOWNLOAD_URL', 'CVE_LIST_EXPORT_URL'] },
  'src/vulnerabilities/vulnerability-signals.service.ts': { names: ['KEV_FEED_URL', 'EPSS_FEED_URL', 'EUVD_BASE_URL'] },
  // The callers pass `timeoutEnvName` and `maxTokensEnvName`.
  'src/ai/control-plane/agent-control/ai-agent-llm-client.ts': {
    names: [
      'AI_AGENT_NEED_BUILDER_MAX_TOKENS', 'AI_AGENT_KNOWLEDGE_PLANNER_MAX_TOKENS', 'AI_AGENT_KNOWLEDGE_INTERPRETER_MAX_TOKENS',
      'AI_AGENT_ACTION_PLANNER_MAX_TOKENS', 'AI_AGENT_SYNTHESIS_MAX_TOKENS', 'AI_AGENT_DIAGNOSTIC_BRIEF_MAX_TOKENS', 'AI_AGENT_VISION_EXTRACTION_MAX_TOKENS',
      'AI_AGENT_ACTION_PLANNER_TIMEOUT_MS', 'AI_AGENT_DIAGNOSTIC_BRIEF_TIMEOUT_MS', 'AI_AGENT_KNOWLEDGE_LLM_TIMEOUT_MS',
      'AI_AGENT_REPLY_SYNTHESIS_TIMEOUT_MS', 'AI_AGENT_VISION_EXTRACTION_TIMEOUT_MS',
    ],
  },
  'src/ai/control-plane/agent-control/ai-agent-action-planner.service.ts': { names: ['AI_AGENT_ADMINISTRATIVE_REPLY_MAX_TOKENS'] },
  'src/ai/control-plane/agent-control/ai-reply-synthesis.service.ts': { names: ['AI_AGENT_TECHNICIAN_BRIEF_MAX_TOKENS'] },
  'src/billing/plans.config.ts': { names: ['STRIPE_PRICE_MAX_MONTHLY', 'STRIPE_PRICE_MAX_ANNUAL'], builtFrom: 'STRIPE_PRICE_' },
  'src/billing/stripe/stripe.config.ts': { names: ['STRIPE_PRICE_MAX_MONTHLY', 'STRIPE_PRICE_MAX_ANNUAL'], builtFrom: 'STRIPE_PRICE_' },
  'src/ai/control-plane/providers/tenant-secret-resolver.service.ts': { names: ['KANAP_TENANT_*', 'KANAP_SECRET_REF_*'] },
  'src/ai/control-plane/live-readiness/ai-live-contract-harness.service.ts': {
    names: [
      'KANAP_LIVE_TENANT_SLUG', 'KANAP_TICKETING_LIVE_READ', 'KANAP_GLPI_LIVE_READ', 'KANAP_MONITORING_LIVE_READ', 'KANAP_PRTG_LIVE_READ',
      'KANAP_NUTANIX_LIVE_READ', 'KANAP_AD_LIVE_READ', 'KANAP_AWX_LIVE_DRY_RUN', 'KANAP_TICKETING_LIVE_SANDBOX_WRITE', 'KANAP_GLPI_LIVE_SANDBOX_WRITE',
    ],
  },
  'src/common/converter-env.ts': { names: [], why: 'copies the system variables (PATH, HOME, LANG, ...) into the environment of the converter it starts' },
  'src/demo-data/demo-data.service.ts': { names: [], why: 'writes the KANAP_DEMO_* variables of the loader it starts' },
};

/** The scripts of backend/scripts that read the environment, other than the entrypoint: tooling, declared by file. */
const TOOLING_SCRIPTS = [
  'scripts/ai-live-contract-harness.ts',
  'scripts/ai-mcp-eval.mjs',
  'scripts/csv-import-smoke.ts',
  'scripts/document-export-inline-images-check.js',
  'scripts/document-export-security-e2e.js',
  'scripts/glpi-adapter-config-readiness.ts',
  'scripts/glpi-adapter-config-upsert.ts',
  'scripts/glpi-import-preview-backfill.ts',
  'scripts/glpi-targeting-status-backfill.ts',
  'scripts/glpi-triage-discriminator-backfill.ts',
  'scripts/glpi-triage-rename-readiness.ts',
  'scripts/knowledge-bench/bench.mjs',
  'scripts/migrate-content-dryrun.ts',
  'scripts/migrate-content-execute.ts',
  'scripts/perf/vulnerability-reach-counts-perf.ts',
  'scripts/prtg-adapter-config-upsert.ts',
  'scripts/rls-self-test.ts',
  'scripts/run-ci-tests.js',
  'scripts/run-race-specs.js',
  'scripts/search-index-parity.ts',
  'scripts/tenant-isolation-audit.ts',
  'scripts/verify-analytics-axes.ts',
  'scripts/verify-inline-base64-images.ts',
  'scripts/verify-rich-text-markdown.ts',
  'scripts/verify-version-totals.ts',
];

/** The 17 active lines of the on-premise example, unchanged since before the registry. */
const ACTIVE_EXAMPLE_LINES = [
  'DEPLOYMENT_MODE=single-tenant',
  'DEFAULT_TENANT_SLUG=default',
  'DEFAULT_TENANT_NAME=My Organization',
  'DEFAULT_TENANT_LANGUAGE=en',
  'ADMIN_EMAIL=admin@company.com',
  'ADMIN_PASSWORD=ChangeThisPassword123!',
  'JWT_SECRET=',
  'APP_BASE_URL=https://kadratis.your-domain.com',
  'CORS_ORIGINS=https://kadratis.your-domain.com',
  'RATE_LIMIT_TRUST_PROXY=true',
  'DATABASE_URL=postgres://kanap:password@your-postgres:5432/kanap?sslmode=require',
  'S3_ENDPOINT=https://s3.amazonaws.com',
  'S3_BUCKET=kanap-files',
  'S3_REGION=us-east-1',
  'AWS_ACCESS_KEY_ID=',
  'AWS_SECRET_ACCESS_KEY=',
  'S3_FORCE_PATH_STYLE=false',
];

/** Values a secret may carry in the example: obvious placeholders. */
const SECRET_PLACEHOLDERS = new Set(['', 'ChangeThisPassword123!', 're_xxxxx']);

const RUN_MODE_SENTENCE = 'Set APP_ENV=production as soon as users reach Kadratis over HTTPS.';

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === '__tests__' || item.name === 'node_modules') continue;
      walk(full, accept, out);
    } else if (accept(full)) {
      out.push(full);
    }
  }
  return out;
}

const isSource = (file: string) => /\.(ts|js|mjs|cjs)$/.test(file) && !/\.(spec|test)\.(ts|js|mjs|cjs)$/.test(file);

/** The code of the API: backend/src without its tests, and the entrypoint. Paths from backend/. */
function apiCode(): { file: string; text: string }[] {
  const files = walk(backendPath('src'), isSource).map((full) => path.relative(backendPath(), full));
  files.push('scripts/migrate-and-start.js');
  return files.sort().map((file) => ({ file, text: fs.readFileSync(backendPath(file), 'utf8') }));
}

const PATH_1 = [/process\.env\??\.([A-Z][A-Z0-9_]*)\b/g, /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g];
const PATH_2 = [/(?<![\w.$])env\??\.([A-Z][A-Z0-9_]*)\b/g, /(?<![\w.$])env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g, /\brequireEnv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g];
const PATH_3 = [/\.get(?:<[^>]*>)?\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g];
const DYNAMIC = [
  /process\.env\s*\[\s*(?!['"][A-Z0-9_]+['"]\s*\])/,
  /(?<![\w.$])env\s*\[\s*(?!['"][A-Z0-9_]+['"]\s*\])/,
  /process\.env\s+as\b/,
];

function matches(text: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));
}

/** Every name the API reads, with the files that read it. */
function namesReadByTheApi(): Map<string, Set<string>> {
  const read = new Map<string, Set<string>>();
  const add = (name: string, file: string) => (read.get(name) ?? read.set(name, new Set()).get(name)!).add(file);
  for (const { file, text } of apiCode()) {
    const paths = [...PATH_1, ...PATH_2, ...(/\bConfigService\b/.test(text) ? PATH_3 : [])];
    for (const name of matches(text, paths)) add(name, file);
  }
  for (const [file, reader] of Object.entries(DYNAMIC_READERS)) for (const name of reader.names) add(name, file);
  return read;
}

function assignedNames(text: string): string[] {
  return text.split('\n').map((line) => /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1]).filter((name): name is string => !!name);
}

function exampleNamesOf(file: string): string[] {
  return assignedNames(readRepo(file));
}

/** The names of the generated block of a page of the manual. */
function blockNamesOf(file: string): string[] {
  const page = readRepo(file);
  const start = page.indexOf(MANUAL_BLOCK_START);
  const end = page.indexOf(MANUAL_BLOCK_END);
  assert.ok(start >= 0 && end > start, `${file} has the generated block`);
  return assignedNames(page.slice(start, end));
}

function testCoverage() {
  const code = apiCode();

  // Path 4: every read with a variable name sits in a declared file, and every declared file has one.
  const dynamicFiles = code.filter(({ text }) => DYNAMIC.some((pattern) => pattern.test(text))).map(({ file }) => file);
  for (const file of dynamicFiles) assert.ok(DYNAMIC_READERS[file], `${file} reads a variable by a computed name: declare it in DYNAMIC_READERS with the names it reads`);
  for (const file of Object.keys(DYNAMIC_READERS)) assert.ok(dynamicFiles.includes(file), `${file} no longer reads a variable by a computed name: remove it from DYNAMIC_READERS`);
  const allCode = code.map(({ text }) => text).join('\n');
  for (const [file, reader] of Object.entries(DYNAMIC_READERS)) {
    if (reader.builtFrom) assert.ok(readRepo(path.join('backend', file)).includes(reader.builtFrom), `${file} builds its names from ${reader.builtFrom}`);
    for (const name of reader.names.filter((entry) => !entry.includes('*'))) {
      assert.ok(reader.builtFrom || new RegExp(`['"\`]${name}['"\`]`).test(allCode), `${name}, declared for ${file}, is written in the code`);
    }
    if (reader.names.length === 0) assert.ok(reader.why, `${file}: say why it reads no setting`);
  }

  // Every name read by the API has its entry.
  const read = namesReadByTheApi();
  assert.ok(read.size > 150, `the scan finds the names (${read.size})`);
  assert.ok(read.has('SSRF_ALLOWED_HOSTS') && read.has('SKIP_MIGRATIONS') && read.has('ENTRA_AUTHORITY'), 'paths 1 to 3 are read');
  const missing = [...read.keys()].filter((name) => !findEnvVariable(name)).map((name) => `${name} (${[...read.get(name)!].join(', ')})`);
  assert.deepEqual(missing, [], 'every variable the API reads has its entry in config/env-registry.ts');

  // The other scripts of backend/scripts that read the environment are tooling, declared by file.
  const scripts = walk(backendPath('scripts'), isSource)
    .map((full) => path.relative(backendPath(), full))
    .filter((file) => file !== 'scripts/migrate-and-start.js' && fs.readFileSync(backendPath(file), 'utf8').includes('process.env'))
    .sort();
  assert.deepEqual(scripts, [...TOOLING_SCRIPTS].sort(), 'the scripts that read the environment are declared in TOOLING_SCRIPTS');

  // Every name of backend/.env.example has its entry.
  const devExample = exampleNamesOf('backend/.env.example');
  assert.ok(devExample.length > 50);
  assert.deepEqual(devExample.filter((name) => !findEnvVariable(name)), [], 'every name of backend/.env.example is in the registry');

  // The other way: each entry is read in the code, infra/, a Dockerfile, or by the place it names.
  const generated = new Set([path.join(REPO_ROOT, ONPREM_EXAMPLE_FILE)]);
  const corpus = [
    allCode,
    ...walk(path.join(REPO_ROOT, 'infra'), (file) => !generated.has(file)).map((file) => fs.readFileSync(file, 'utf8')),
    ...['backend/Dockerfile', 'frontend/Dockerfile', 'frontend/Dockerfile.dev', 'marketing/Dockerfile'].map(readRepo),
  ].join('\n');
  const declared = new Set(Object.values(DYNAMIC_READERS).flatMap((reader) => reader.names));
  for (const variable of ENV_REGISTRY) {
    if (variable.readBy && /\//.test(variable.readBy)) {
      assert.ok(readRepo(variable.readBy).includes(variable.name), `${variable.name} is read by ${variable.readBy}`);
    } else if (variable.family) {
      const pattern = new RegExp(envNamePattern(variable.name).source.slice(1, -1), 'g');
      assert.ok(declared.has(variable.name) || pattern.test(allCode), `the family ${variable.name} is read by the code`);
    } else {
      assert.ok(new RegExp(`\\b${variable.name}\\b`).test(corpus), `${variable.name} is read in the code, infra/ or a Dockerfile: remove its entry, or name the place that reads it (readBy)`);
    }
  }
}

function testRegistryShape() {
  const names = ENV_REGISTRY.map((variable) => variable.name);
  assert.equal(new Set(names).size, names.length, 'one entry per name');
  for (const variable of ENV_REGISTRY) {
    const label = variable.name;
    assert.match(label, /^[A-Z][A-Z0-9_]*(\*[A-Z0-9_]*)*$/, label);
    assert.equal(variable.family, label.includes('*'), label);
    assert.ok(variable.modes.length > 0, `${label}: modes`);
    assert.equal(variable.screen, null, `${label}: no screen yet`);
    if (!variable.family) {
      const families = ENV_REGISTRY.filter((other) => other.family && envNamePattern(other.name).test(label)).map((other) => other.name);
      assert.deepEqual(families, [], `${label} is not also a member of a family`);
    }
    if (variable.kind === 'build') assert.ok(variable.readBy && variable.reason === 'outside-node', `${label}: a build variable names the place that reads it`);
    if (variable.kind === 'internal') assert.ok(variable.reason === null && variable.takesEffect === null, `${label}: an internal variable is no setting`);
    if (variable.kind === 'tooling' || variable.kind === 'deprecated') assert.equal(variable.reason, 'tooling', label);
    if (variable.kind !== 'operator' && variable.kind !== 'build') assert.equal(variable.example.state, 'absent', `${label}: only settings of an installation are in the example`);
    if (variable.example.state !== 'absent') {
      assert.ok(variable.modes.includes('onprem'), `${label}: the on-premise example holds on-premise variables only`);
      if (variable.secret) assert.ok(SECRET_PLACEHOLDERS.has(variable.example.value), `${label}: a secret has no value in the example`);
      assert.ok(!/\s#/.test(variable.example.value), `${label}: no comment at the end of a value line`);
    } else if (variable.kind === 'operator' && variable.modes.includes('onprem') && !variable.family) {
      assert.ok(variable.example.why, `${label}: an on-premise setting is in the example, or says why not`);
    }
  }
  // Older names: each deprecated entry is the alias of exactly one entry, and the reverse.
  const aliases = ENV_REGISTRY.flatMap((variable) => variable.aliases.map((alias) => ({ alias, of: variable.name })));
  for (const { alias, of } of aliases) assert.equal(findEnvVariable(alias)?.kind, 'deprecated', `${alias}, alias of ${of}, is a deprecated entry`);
  for (const variable of ENV_REGISTRY.filter((entry) => entry.kind === 'deprecated')) {
    assert.equal(aliases.filter(({ alias }) => alias === variable.name).length, 1, `${variable.name} is the alias of one entry`);
  }
  // Sections: each declared once, each with variables.
  assert.deepEqual(ENV_EXAMPLE_SECTIONS.map((section) => section.id), [...ENV_EXAMPLE_SECTION_IDS]);
  for (const section of ENV_EXAMPLE_SECTIONS) assert.ok(sectionVariables(section).length > 0, `section ${section.id} has variables`);
}

function testProducedFiles() {
  for (const { file, content } of renderEnvReferenceFiles(readRepo)) {
    assert.equal(readRepo(file), content, `${file} is the output of the registry: run "npm run env:generate" in backend/`);
  }

  const example = renderOnPremExample();
  const lines = example.split('\n');
  assert.deepEqual(lines.filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line)), ACTIVE_EXAMPLE_LINES, 'the active lines of the example');
  const assigned = exampleNamesOf(ONPREM_EXAMPLE_FILE);
  assert.equal(new Set(assigned).size, assigned.length, 'each variable once in the example');
  for (const name of assigned) {
    const variable = findEnvVariable(name);
    assert.ok(variable, `${name} is in the registry`);
    assert.ok(variable.modes.includes('onprem'), `${name}: no cloud variable in the on-premise example`);
  }
  for (const name of ['STRIPE_SECRET_KEY', 'PLATFORM_ADMIN_EMAILS', 'TURNSTILE_SECRET_KEY', 'TENANT_BASE_DOMAINS', 'DISCOVERY_CALL_URL']) {
    assert.ok(!assigned.includes(name), `${name} is not in the on-premise example`);
  }
  for (const name of ['SSRF_ALLOWED_HOSTS', 'BRAVE_SEARCH_API_KEY', 'CVE_LIST_FEED_ENABLED', 'NODE_EXTRA_CA_CERTS']) assert.ok(assigned.includes(name), `${name} is in the example`);

  // Run mode: the example and the manual say the same thing.
  assert.ok(lines.includes(`# ${RUN_MODE_SENTENCE}`) && lines.includes('# APP_ENV=production'), 'run mode in the example');
  const block = renderManualBlock('en').split('\n');
  assert.ok(block.includes(`# ${RUN_MODE_SENTENCE}`) && block.includes('# APP_ENV=production'), 'run mode in the manual');
  assert.ok(!block.includes('APP_ENV=production'), 'APP_ENV stays commented in the manual');
  assert.ok(example.includes('citext, pgcrypto, uuid-ossp, pg_trgm and unaccent'), 'the five extensions');

  // The blocks hold the variables of the example, in each language.
  for (const language of ENV_LANGUAGES) {
    assert.deepEqual(blockNamesOf(manualConfigurationFile(language)), assigned, `${language}: the block holds the variables of the example`);
  }
}

const FORBIDDEN: [RegExp, string][] = [
  [/Plaid/, 'Plaid (the assistant is Kad)'],
  [/\bKANAP\b/, 'KANAP outside an identifier (the product is Kadratis)'],
  [/Admin\s*>/, 'Admin > (say the page of the administration)'],
  [/[—–]/, 'a long dash'],
];

function assertCleanText(text: string, where: string) {
  for (const [pattern, what] of FORBIDDEN) assert.ok(!pattern.test(text), `${where}: ${what}: ${text.split('\n').find((line) => pattern.test(line))}`);
}

function testTexts() {
  const missing: string[] = [];
  const need = (text: Partial<Record<string, string>> | undefined, what: string) => {
    for (const language of ENV_LANGUAGES) if (!(text?.[language] ?? '').trim()) missing.push(`${what} (${language})`);
  };
  for (const variable of ENV_REGISTRY) {
    need(ENV_LABELS.entries[variable.name], variable.name);
    if (variable.example.state !== 'absent') assertCleanText((variable.example.comment ?? []).join('\n'), variable.name);
    assertCleanText(variable.default ?? '', `${variable.name} default`);
  }
  assert.deepEqual(Object.keys(ENV_LABELS.entries).filter((name) => !ENV_REGISTRY.some((variable) => variable.name === name)), [], 'no description without its entry');
  assert.deepEqual(Object.keys(ENV_LABELS.sections).sort(), [...ENV_EXAMPLE_SECTION_IDS].sort(), 'one label per section');
  need(ENV_LABELS.block.header, 'block header');
  for (const section of ENV_EXAMPLE_SECTIONS) {
    const labels = ENV_LABELS.sections[section.id];
    need(labels.title, `${section.id} title`);
    if (labels.note) need(labels.note, `${section.id} note`);
  }
  for (const section of ENV_EXAMPLE_SECTIONS) assertCleanText(section.comment.join('\n'), `section ${section.id}`);
  assertCleanText(JSON.stringify(ENV_LABELS), 'env-registry.labels.json');
  assertCleanText(renderOnPremExample(), ONPREM_EXAMPLE_FILE);
  for (const language of ENV_LANGUAGES) assertCleanText(renderManualBlock(language), `block ${language}`);
  assertCleanText(readRepo('backend/.env.example'), 'backend/.env.example');
  // Last, so that the checks above run while translations are pending.
  assert.equal(missing.length, 0, `${missing.length} texts of env-registry.labels.json lack a language, first: ${missing.slice(0, 5).join(', ')}`);
}

function run(): void {
  const failures: string[] = [];
  for (const test of [testCoverage, testRegistryShape, testProducedFiles, testTexts]) {
    try {
      test();
    } catch (error) {
      failures.push(`${test.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) {
    console.error(failures.join('\n\n'));
    throw new Error(`env-registry.spec: ${failures.length} failing`);
  }
  console.log('env-registry.spec: ok');
}

run();

