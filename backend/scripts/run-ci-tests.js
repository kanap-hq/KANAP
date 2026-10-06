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
 * parallel. `--jobs N` (default: one per CPU) is the number of specs running
 * at once. There are three kinds of specs:
 *   - unit specs never open the database (DB_PATTERN does not match): they run
 *     in parallel on every free slot;
 *   - database specs run on database lanes. With `--db-lanes N` (default 1),
 *     each lane has a database of its own, a copy of the migrated database:
 *     `<db>_1` ... `<db>_N`, where `<db>` is the database of DATABASE_URL.
 *     A lane runs its specs one after the other and reuses its database, as
 *     specs always shared `appdb`; the lanes pull from one queue, largest file
 *     first (a cheap stand-in for the slowest spec first). The runner creates
 *     the lane databases when CI_ADMIN_DATABASE_URL names a role allowed to
 *     create databases (`CREATE DATABASE <db>_n TEMPLATE <db>`, dropped and
 *     made again on every run), or uses `<db>_1..N` when they all exist
 *     (CI makes them in the workflow). Otherwise it says so in one line and
 *     runs every database spec in series on `<db>`, as before;
 *   - exclusive database specs touch state the whole PostgreSQL server
 *     shares, so they run alone: first, one after the other, on lane 1,
 *     while no other lane runs a database spec (unit specs keep running).
 *     A database spec is exclusive when its source, or a test helper it
 *     imports from a `__tests__` folder, matches EXCLUSIVE_PATTERNS:
 *       . roles and databases (CREATE/ALTER/DROP ROLE, USER, GROUP, DATABASE,
 *         TABLESPACE): they are global objects, and a database copy cannot
 *         be made while its template has a connection;
 *       . server settings (ALTER SYSTEM, pg_reload_conf) and CHECKPOINT:
 *         they change or load every database at once;
 *       . other sessions (pg_terminate_backend, pg_cancel_backend): they can
 *         hit a session of another lane;
 *       . statistics resets (pg_stat_reset*): they reset the counters other
 *         specs read;
 *       . a read of pg_stat_activity or pg_locks that is narrowed neither to
 *         a backend (`pid =`) nor to the current database (`datname =
 *         current_database()`, `database =`): it sees the sessions and locks
 *         of every lane;
 *       . an explicit `// @exclusive-db-spec: <reason>` marker, for what a
 *         pattern cannot see (an assertion that holds only when nothing else
 *         runs on the server, a code path in the application itself).
 *     Advisory locks are fine on a copy: PostgreSQL keys them by database.
 *     Specs are checked to run exactly once (unit + database + exclusive =
 *     discovered).
 * A spec can still be run alone from its source: `npx ts-node <spec>.ts`.
 *
 * The race specs (`*-race.integration.spec.ts`) refuse a developer's `appdb`
 * (race-harness.ts). They run on the lane databases, which are throwaway
 * copies; on a single lane against `appdb` outside GitHub Actions they are
 * left out of the run, with one line saying how to run them on a dedicated
 * database.
 *
 * Usage: node scripts/run-ci-tests.js [--jobs N] [--db-lanes N] [--no-compile | --compile-only]
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
const DB_PATTERN = /NestFactory\.create|createTestingModule|TypeOrmModule|\.initialize\(\)|data-source|@database-spec\b|@exclusive-db-spec\b|race-harness/;

// A database spec that matches one of these runs alone (see the header for
// why each one is exclusive). A false match only costs time; a miss lets the
// spec disturb the other lanes, so the statements match in any case.
const EXCLUSIVE_PATTERNS = [
  /\b(create|alter|drop)\s+(role|user|group|database|tablespace)\b/i,
  /\balter\s+system\b/i,
  /\bpg_reload_conf\b/i,
  /\bcheckpoint\s*[;`'"]/i,
  /\bpg_(terminate|cancel)_backend\b/i,
  /\bpg_stat_reset/i,
  // Up to the end of the SQL template literal: no narrowing to a backend or to this database.
  /\bpg_stat_activity\b(?![^`]*\b(pid\s*=|datname\s*=\s*current_database\(\)))/i,
  /\bpg_locks\b(?![^`]*\b(pid\s*=|database\s*=))/i,
  /@exclusive-db-spec\b/,
];

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
function racesRefused(url = process.env.DATABASE_URL) {
  return databaseName(url) === 'appdb' && process.env.GITHUB_ACTIONS !== 'true';
}

/** The URL of lane `n` (1-based): the same server and role, database `<db>_<n>`. */
function laneUrl(url, n) {
  const lane = new URL(url);
  lane.pathname = `/${encodeURIComponent(`${databaseName(url)}_${n}`)}`;
  return lane.toString();
}

/**
 * Why a database spec must run alone, or null. Reads the spec and the test
 * helpers it imports from `__tests__` folders (relative imports, followed
 * through), so a helper's statement counts for every spec that uses it.
 */
function exclusiveReason(file) {
  const spec = path.resolve(root, file);
  const seen = new Set();
  const pending = [spec];
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const source = fs.readFileSync(current, 'utf8');
    for (const pattern of EXCLUSIVE_PATTERNS) {
      const match = pattern.exec(source);
      if (match) {
        const where = current === spec ? '' : ` in ${path.relative(root, current)}`;
        return `${match[0].replace(/\s+/g, ' ').trim()}${where}`;
      }
    }
    for (const [, imported] of source.matchAll(/(?:from\s+|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(current), imported);
      const target = [`${base}.ts`, path.join(base, 'index.ts'), base].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (target && target.split(path.sep).includes('__tests__')) pending.push(target);
    }
  }
  return null;
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

/** Largest file first: the slow specs start early, so the lanes end close together. */
function largestFirst(files) {
  const size = new Map(files.map((f) => [f, fs.statSync(path.join(root, f)).size]));
  return [...files].sort((a, b) => size.get(b) - size.get(a) || a.localeCompare(b));
}

/**
 * The database URL of each lane. One lane: DATABASE_URL itself. Several: the
 * `<db>_<n>` copies, created here with CI_ADMIN_DATABASE_URL, or found in
 * place. When neither works, one lane on DATABASE_URL and the reason.
 */
async function prepareLanes(count) {
  const url = process.env.DATABASE_URL;
  const base = databaseName(url);
  if (count <= 1) return { urls: [url] };
  const single = (reason) => ({ urls: [url], fallback: reason });
  if (!base) return single('DATABASE_URL names no database');
  const names = Array.from({ length: count }, (_, i) => `${base}_${i + 1}`);
  const quote = (name) => `"${name.replace(/"/g, '""')}"`;
  const { Client } = require('pg');
  const admin = process.env.CI_ADMIN_DATABASE_URL;
  try {
    if (admin) {
      const client = new Client({ connectionString: admin });
      await client.connect();
      try {
        const { rows } = await client.query(`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1`, [base]);
        if (!rows.length) return single(`database ${base} does not exist`);
        for (const name of names) {
          await client.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
          await client.query(`CREATE DATABASE ${quote(name)} TEMPLATE ${quote(base)} OWNER ${quote(rows[0].owner)}`);
        }
      } finally {
        await client.end();
      }
      return { urls: names.map((_, i) => laneUrl(url, i + 1)), created: true };
    }
    const client = new Client({ connectionString: url });
    await client.connect();
    let existing;
    try {
      existing = new Set((await client.query(`SELECT datname FROM pg_database WHERE datname = ANY($1)`, [names])).rows.map((r) => r.datname));
    } finally {
      await client.end();
    }
    const missing = names.filter((name) => !existing.has(name));
    if (missing.length) {
      return single(`${missing.join(', ')} missing (create them from ${base} as a template, or set CI_ADMIN_DATABASE_URL)`);
    }
    return { urls: names.map((_, i) => laneUrl(url, i + 1)) };
  } catch (err) {
    return single(`could not prepare them: ${err.message}`);
  }
}

function runSpec(file, { databaseUrl, tag }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    const env = { ...process.env, ...(ENV[file] || {}) };
    if (databaseUrl) env.DATABASE_URL = databaseUrl;
    const child = spawn(process.execPath, ['--enable-source-maps', compiledPath(file)], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('close', (code) => {
      const seconds = (Date.now() - started) / 1000;
      const status = code === 0 ? 'ok' : `FAILED (exit ${code})`;
      process.stdout.write(`\n── ${file} · ${seconds.toFixed(1)}s · ${status} · ${tag}\n${Buffer.concat(chunks)}`);
      resolve({ file, code, seconds, started, ended: Date.now() });
    });
  });
}

/**
 * Runs the three queues on `jobs` slots (at least one per lane). Lane 1 first
 * runs the exclusive specs, one after the other, while the other slots run
 * unit specs; then every lane pulls database specs, and slots without database
 * work take unit specs.
 */
async function schedule({ unit, database, exclusive, urls, jobs }) {
  const queues = { unit: [...unit], database: [...database], exclusive: [...exclusive] };
  const results = [];
  const lanes = urls.map((url, i) => ({ n: i + 1, url, name: databaseName(url), specs: 0, busy: 0, first: null, last: null }));
  let exclusiveFinished = !queues.exclusive.length;
  let exclusiveDone;
  const exclusivePhase = new Promise((resolve) => { exclusiveDone = resolve; });
  const exclusiveTimes = { started: null, ended: null };

  async function run(file, kind, lane) {
    const result = await runSpec(file, lane
      ? { databaseUrl: lane.url, tag: kind === 'exclusive' ? `exclusive, ${lane.name}` : `lane ${lane.n}` }
      : { tag: 'unit' });
    results.push({ ...result, kind, lane: lane?.n ?? null });
    if (kind === 'database') {
      lane.specs += 1;
      lane.busy += result.seconds;
      lane.first ??= result.started;
      lane.last = result.ended;
    }
  }

  async function laneWorker(lane) {
    if (lane.n === 1 && queues.exclusive.length) {
      exclusiveTimes.started = Date.now();
      for (let file = queues.exclusive.shift(); file; file = queues.exclusive.shift()) await run(file, 'exclusive', lane);
      exclusiveTimes.ended = Date.now();
      exclusiveFinished = true;
      exclusiveDone();
    }
    for (;;) {
      if (exclusiveFinished && queues.database.length) await run(queues.database.shift(), 'database', lane);
      else if (queues.unit.length) await run(queues.unit.shift(), 'unit', null);
      else if (!exclusiveFinished) await exclusivePhase;
      else break;
    }
  }

  async function unitWorker() {
    for (let file = queues.unit.shift(); file; file = queues.unit.shift()) await run(file, 'unit', null);
  }

  const unitWorkers = Math.max(0, jobs - lanes.length);
  await Promise.all([...lanes.map(laneWorker), ...Array.from({ length: unitWorkers }, unitWorker)]);
  return { results, lanes, exclusiveTimes };
}

async function main() {
  const arg = (name) => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? Number(process.argv[at + 1]) : undefined;
  };
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const jobs = Math.max(2, arg('--jobs') ?? cpus);
  const askedLanes = Math.max(1, arg('--db-lanes') ?? 1);

  if (!process.argv.includes('--no-compile')) compile();
  if (process.argv.includes('--compile-only')) return;

  let specs = discover();
  const discovered = specs.length;
  const notCompiled = specs.filter((f) => !fs.existsSync(compiledPath(f)));
  if (notCompiled.length) {
    console.log(`${notCompiled.length} specs have no compiled file in ci-dist/ (run without --no-compile):`);
    for (const f of notCompiled) console.log(`  - ${f}`);
    process.exit(1);
  }

  const { urls, fallback, created } = await prepareLanes(askedLanes);
  if (fallback) console.log(`Database lanes: 1 instead of ${askedLanes}, ${fallback}. Database specs run in series on ${databaseName()}.`);
  else if (urls.length > 1) console.log(`Database lanes: ${urls.map((u) => databaseName(u)).join(', ')}${created ? ` (made from ${databaseName()})` : ''}`);

  let leftOut = 0;
  if (urls.some((url) => racesRefused(url))) {
    const races = specs.filter((f) => RACE_SPEC.test(f));
    specs = specs.filter((f) => !RACE_SPEC.test(f));
    leftOut = races.length;
    console.log(
      `${races.length} race specs left out: they never run against appdb. Run them on a dedicated database: `
        + 'DATABASE_URL=postgres://app:app@localhost:5432/appdb_races npm run test:races',
    );
  }
  const db = specs.filter((f) => DB_PATTERN.test(fs.readFileSync(path.join(root, f), 'utf8')));
  const unit = specs.filter((f) => !db.includes(f));
  const reasons = new Map(db.map((f) => [f, exclusiveReason(f)]).filter(([, reason]) => reason));
  const exclusive = db.filter((f) => reasons.has(f));
  const database = largestFirst(db.filter((f) => !reasons.has(f)));
  console.log(
    `${specs.length} specs: ${unit.length} unit, ${database.length} database on ${urls.length} lane${urls.length > 1 ? 's' : ''}, `
      + `${exclusive.length} exclusive database (${jobs} at once)`,
  );

  const started = Date.now();
  const { results, lanes, exclusiveTimes } = await schedule({ unit: largestFirst(unit), database, exclusive, urls, jobs });
  const failed = results.filter((r) => r.code !== 0);
  const at = (ms) => `${((ms - started) / 1000).toFixed(0)}s`;

  console.log('');
  if (exclusive.length) {
    console.log(`Exclusive, on ${databaseName(urls[0])} from ${at(exclusiveTimes.started)} to ${at(exclusiveTimes.ended)}:`);
    for (const f of exclusive) console.log(`  - ${f} (${reasons.get(f)})`);
  }
  for (const lane of lanes) {
    const span = lane.first ? `${at(lane.first)} to ${at(lane.last)}` : 'idle';
    console.log(`Lane ${lane.n} (${lane.name}): ${lane.specs} database specs, ${lane.busy.toFixed(0)}s of specs, ${span}`);
  }
  const unitResults = results.filter((r) => r.kind === 'unit');
  console.log(`Unit: ${unitResults.length} specs, ${unitResults.reduce((t, r) => t + r.seconds, 0).toFixed(0)}s of specs`);

  // Every discovered spec runs exactly once (or is a race spec left out above).
  const count = (kind) => results.filter((r) => r.kind === kind).length;
  const ranOnce = new Set(results.map((r) => r.file)).size === results.length;
  const accounted = count('unit') + count('database') + count('exclusive') + leftOut;
  console.log(
    `Count: ${count('unit')} unit + ${count('database')} database + ${count('exclusive')} exclusive`
      + `${leftOut ? ` + ${leftOut} left out` : ''} = ${accounted} of ${discovered} discovered`,
  );
  const total = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n${results.length - failed.length}/${results.length} specs passed in ${total}s`);
  if (accounted !== discovered || !ranOnce) {
    console.log('Spec count mismatch: every discovered spec must run exactly once.');
    process.exit(1);
  }
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

module.exports = { databaseName, racesRefused, RACE_SPEC, compiledPath, laneUrl, exclusiveReason, prepareLanes, EXCLUSIVE_PATTERNS, DB_PATTERN };
