#!/usr/bin/env node
/*
 * Runs every backend spec the way CI does, in parallel.
 *
 * Specs are discovered on disk: every `src/** /__tests__/*.spec.ts` plus the
 * database scripts listed in EXTRA. A new spec file is therefore run by CI
 * from its first commit, without touching package.json or this file. The
 * `test:*` scripts in package.json remain available for local, targeted runs.
 *
 * The specs run from JavaScript compiled once: the script first empties
 * `ci-dist/` and runs `tsc -p tsconfig.ci.json`, which type-checks the sources,
 * the specs and the EXTRA scripts and emits them (with source maps) under
 * `ci-dist/backend/` (`rootDir` is the repository root, because one spec
 * imports a frontend module). A type error stops the run before any spec.
 * `--no-compile` skips that step when it already ran (CI runs it as its own
 * step); `--compile-only` runs only that step.
 *
 * Each spec then runs in its own `node` process; only the scheduling is
 * parallel:
 *   - specs that never open the database run in parallel (one lane per CPU),
 *   - specs that connect to PostgreSQL share one serial lane, because they all
 *     work on the same `appdb`.
 * A spec can still be run alone from its source: `npx ts-node <spec>.ts`.
 *
 * The race specs (`*-race.integration.spec.ts`) refuse a developer's `appdb`
 * (race-harness.ts): against `appdb` outside GitHub Actions they are left out
 * of the run, with one line saying how to run them on a dedicated database.
 *
 * Usage: node scripts/run-ci-tests.js [--jobs N] [--no-compile | --compile-only]
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

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
  // Known races, plan planning/perf-scale step 3: a spec that fails until its
  // lot lands is listed here; each fix PR removes its spec from this list (a
  // file mixing lots is split). Run them with `npm run test:races` on a
  // dedicated database (they refuse appdb outside GitHub Actions). Lot 3B
  // fixed the last ones listed.
]);

// Specs that exercise the on-premise code paths.
const ENV = {
  'src/ai/__tests__/ai-chat-orchestrator.service.spec.ts': { DEPLOYMENT_MODE: 'single-tenant' },
  'src/ai/__tests__/glpi.service.spec.ts': { DEPLOYMENT_MODE: 'single-tenant' },
};

// A spec that matches one of these opens a real database connection. A spec
// that opens it only through a shared helper (`runSpecs`, `runRaceSpecs`)
// carries an explicit `// @database-spec` marker, rather than relying on a
// word its comments happen to contain; the race specs also match through
// their shared harness.
const DB_PATTERN = /NestFactory\.create|createTestingModule|TypeOrmModule|\.initialize\(\)|data-source|@database-spec\b|race-harness/;

const root = path.resolve(__dirname, '..');

// Where `tsc -p tsconfig.ci.json` emits (its `outDir`). Its `rootDir` is the
// repository root, so `src/a.spec.ts` lands in `ci-dist/backend/src/a.spec.js`.
const OUT_DIR = path.join(root, 'ci-dist');

/** The compiled JavaScript of a backend source file (`src/...ts` or `scripts/...ts`). */
function compiledPath(file) {
  return path.join(OUT_DIR, path.basename(root), file.replace(/\.ts$/, '.js'));
}

/** Empties ci-dist, then type-checks and emits everything once. Exits on a type error. */
function compile() {
  const started = Date.now();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const tsc = spawnSync(path.join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.ci.json'], { cwd: root, stdio: 'inherit' });
  if (tsc.status !== 0) {
    console.log(`tsc -p tsconfig.ci.json failed (exit ${tsc.status ?? tsc.signal}): no spec was run.`);
    process.exit(tsc.status || 1);
  }
  // Like dist/, the compiled tree sits next to a package.json (config.controller.ts reads the version from it).
  fs.copyFileSync(path.join(root, 'package.json'), path.join(OUT_DIR, path.basename(root), 'package.json'));
  console.log(`Compiled to ci-dist/ in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const RACE_SPEC = /-race\.integration\.spec\.ts$/;

/** The database name of DATABASE_URL, or null (same reading as race-harness.ts). */
function databaseName(url = process.env.DATABASE_URL) {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

/** The race specs refuse a developer's appdb; GitHub Actions' appdb is a throwaway service container. */
function racesRefused() {
  return databaseName() === 'appdb' && process.env.GITHUB_ACTIONS !== 'true';
}

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
    const child = spawn(process.execPath, ['--enable-source-maps', compiledPath(file)], {
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

  if (!process.argv.includes('--no-compile')) compile();
  if (process.argv.includes('--compile-only')) return;

  let specs = discover();
  const notCompiled = specs.filter((f) => !fs.existsSync(compiledPath(f)));
  if (notCompiled.length) {
    console.log(`${notCompiled.length} specs have no compiled file in ci-dist/ (run without --no-compile):`);
    for (const f of notCompiled) console.log(`  - ${f}`);
    process.exit(1);
  }
  if (racesRefused()) {
    const races = specs.filter((f) => RACE_SPEC.test(f));
    specs = specs.filter((f) => !RACE_SPEC.test(f));
    console.log(
      `${races.length} race specs left out: they never run against appdb. Run them on a dedicated database: `
        + 'DATABASE_URL=postgres://app:app@localhost:5432/appdb_races npm run test:races',
    );
  }
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { databaseName, racesRefused, RACE_SPEC, compiledPath };
