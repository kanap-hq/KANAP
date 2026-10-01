#!/usr/bin/env node
/*
 * Runs every backend spec the way CI does, in parallel.
 *
 * Specs are discovered on disk: every `src/** /__tests__/*.spec.ts` plus the
 * database scripts listed in EXTRA. A new spec file is therefore run by CI
 * from its first commit, without touching package.json or this file. The
 * `test:*` scripts in package.json remain available for local, targeted runs.
 *
 * Each spec keeps running in its own ts-node process; only the scheduling is
 * parallel:
 *   - specs that never open the database run in parallel (one lane per CPU),
 *   - specs that connect to PostgreSQL share one serial lane, because they all
 *     work on the same `appdb`.
 *
 * Type-checking is done once by `npm run typecheck:ci` before this script, so
 * CI sets TS_NODE_TRANSPILE_ONLY=1 to skip the per-process type-check.
 *
 * Usage: node scripts/run-ci-tests.js [--jobs N]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Database scripts that are part of the hardening checks.
const EXTRA = ['scripts/tenant-isolation-audit.ts', 'scripts/rls-self-test.ts'];

// Specs that need a dedicated, isolated database (`kanap_classification_v1_test`)
// and refuse to run against `appdb`. Run them by hand with
// `npm run test:application-classification:integration` / `:http`.
const EXCLUDE = new Set([
  'src/applications/__tests__/application-classification.integration.spec.ts',
  'src/applications/__tests__/application-classification-concurrency.integration.spec.ts',
  'src/applications/__tests__/application-classification-http-permissions.integration.spec.ts',
  'src/it-ops-settings/__tests__/it-ops-settings.integration.spec.ts',
  // Known races, plan planning/perf-scale step 3 (and 1D): each spec fails
  // until its lot lands; each fix PR removes its spec from this list. Run them
  // with `npm run test:races` on a dedicated database (they refuse appdb
  // outside GitHub Actions).
  'src/capex/__tests__/capex-item-update-race.integration.spec.ts', // 3B
  'src/common/__tests__/request-lock-timeout-race.integration.spec.ts', // 1D
  'src/spend/__tests__/allocation-rules-race.integration.spec.ts', // 3A
  'src/spend/__tests__/budget-operations-deadlock-race.integration.spec.ts', // 3F
  'src/spend/__tests__/item-applications-race.integration.spec.ts', // 3A
  'src/spend/__tests__/spend-allocations-race.integration.spec.ts', // 3E (+ 3A index)
  'src/spend/__tests__/spend-item-contacts-race.integration.spec.ts', // 3A
  'src/spend/__tests__/spend-item-delete-race.integration.spec.ts', // 3B
  'src/spend/__tests__/spend-item-update-race.integration.spec.ts', // 3B
  'src/spend/__tests__/spend-items-csv-race.integration.spec.ts', // 3F + 3B
  'src/spend/__tests__/spend-versions-race.integration.spec.ts', // 3A (version create) + 3B (version update)
]);

// Specs that exercise the on-premise code paths.
const ENV = {
  'src/ai/__tests__/ai-chat-orchestrator.service.spec.ts': { DEPLOYMENT_MODE: 'single-tenant' },
  'src/ai/__tests__/glpi.service.spec.ts': { DEPLOYMENT_MODE: 'single-tenant' },
};

// A spec that matches one of these opens a real database connection. A spec
// that opens it only through a shared helper (`runSpecs`, `runRaceSpecs`)
// carries an explicit `// @database-spec` marker, rather than relying on a
// word its comments happen to contain.
const DB_PATTERN = /NestFactory\.create|createTestingModule|TypeOrmModule|\.initialize\(\)|data-source|@database-spec\b/;

const root = path.resolve(__dirname, '..');

function discover() {
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.spec.ts') && path.basename(dir) === '__tests__') {
        found.push(path.relative(root, full));
      }
    }
  })(path.join(root, 'src'));
  return [...EXTRA, ...found.sort()].filter((file) => !EXCLUDE.has(file));
}

function runSpec(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    const child = spawn(path.join(root, 'node_modules', '.bin', 'ts-node'), [file], {
      cwd: root,
      env: { ...process.env, ...(ENV[file] || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('close', (code) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const status = code === 0 ? 'ok' : `FAILED (exit ${code})`;
      process.stdout.write(`\n── ${file} · ${seconds}s · ${status}\n${Buffer.concat(chunks)}`);
      resolve({ file, code });
    });
  });
}

async function runLane(queue, workers) {
  const results = [];
  async function worker() {
    for (let file = queue.shift(); file; file = queue.shift()) results.push(await runSpec(file));
  }
  await Promise.all(Array.from({ length: Math.min(workers, queue.length) || 1 }, worker));
  return results;
}

async function main() {
  const jobsArg = process.argv.indexOf('--jobs');
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const jobs = Math.max(2, jobsArg >= 0 ? Number(process.argv[jobsArg + 1]) : cpus);

  const specs = discover();
  const db = specs.filter((f) => DB_PATTERN.test(fs.readFileSync(path.join(root, f), 'utf8')));
  const unit = specs.filter((f) => !db.includes(f));
  console.log(`${specs.length} specs: ${unit.length} in parallel (${jobs - 1} lanes), ${db.length} database specs in series`);

  const started = Date.now();
  const results = (await Promise.all([runLane([...db], 1), runLane([...unit], jobs - 1)])).flat();
  const failed = results.filter((r) => r.code !== 0);
  const total = ((Date.now() - started) / 1000).toFixed(0);

  console.log(`\n${results.length - failed.length}/${results.length} specs passed in ${total}s`);
  if (failed.length) {
    console.log('Failed:');
    for (const r of failed) console.log(`  - ${r.file}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
