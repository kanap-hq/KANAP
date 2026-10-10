/*
  Simple entrypoint for QA/Prod:
  - Waits for DB (the connection is retried while the database is not ready or goes away)
  - Runs TypeORM migrations programmatically using compiled DataSource; a migration that fails
    on its own exits at once with its message (never retried)
  - Optionally runs integrated-doc repair + verification
  - Starts the NestJS server

  Env toggles:
  - API_WORKERS=N (default 1): N > 1 runs N API processes with the Node cluster module. This
    process becomes the cluster primary once the migrations ran, and forks the workers
    (src/common/cluster/cluster-primary.ts). With 1, the API runs here, as before.
  - SKIP_MIGRATIONS=true to skip running migrations at boot
  - INTEGRATED_DOCS_AUTO_ROLLOUT=if-needed|always|off to control boot-time integrated-doc repair
  - INTEGRATED_DOCS_AUTO_ROLLOUT_STRICT=true to fail startup when integrated-doc repair fails

  The integrated-doc repair and its verification are compiled with the API
  (dist/knowledge/scripts/) and run here with node: the image needs no TypeScript tooling. When
  one of them fails, the API starts anyway (unless strict) and one error line names the step.
*/

const path = require('path');
const { spawn } = require('child_process');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const INTEGRATED_DOCS_ROLLOUT_LOCK_KEY = 'kanap:integrated-docs:auto-rollout';

function readIntegratedDocsRolloutMode() {
  const raw = String(process.env.INTEGRATED_DOCS_AUTO_ROLLOUT || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') {
    return 'off';
  }
  if (raw === 'always') {
    return 'always';
  }
  return 'if-needed';
}

function isIntegratedDocsRolloutStrict() {
  const raw = String(process.env.INTEGRATED_DOCS_AUTO_ROLLOUT_STRICT || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'strict';
}

/** The steps of the integrated-doc rollout, in order: compiled scripts run with node. */
function integratedDocsRolloutSteps(backendDir = path.resolve(__dirname, '..')) {
  return [
    {
      label: 'integrated-doc repair',
      script: path.join(backendDir, 'dist', 'knowledge', 'scripts', 'backfill-integrated-docs.js'),
    },
    {
      label: 'integrated-doc verification',
      script: path.join(backendDir, 'dist', 'knowledge', 'scripts', 'verify-integrated-docs.js'),
    },
  ];
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

/** The single error line printed when a rollout step fails and startup goes on. */
function integratedDocsFailureLine(label, error) {
  return `[entrypoint] Integrated-doc rollout: the ${label} step failed (${errorMessage(error)}). `
    + 'The API starts anyway: fix the cause, then run "npm run integrated-docs:backfill" and '
    + '"npm run integrated-docs:verify" in the API container.';
}

/** Runs one compiled script with the node binary of this process; rejects when it does not exit 0. */
function runNodeScript(step, { cwd = path.resolve(__dirname, '..'), env = process.env } = {}) {
  console.log(`[entrypoint] Running the ${step.label}...`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [step.script], { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `terminated by signal ${signal}` : `exit code ${code}`));
    });
  });
}

/**
 * Runs the steps in order and stops at the first failure. Strict: the failure is thrown.
 * Otherwise one error line names the failed step and the result is false.
 */
async function runIntegratedDocsSteps(steps, { strict = false, runStep = runNodeScript, logError = console.error } = {}) {
  for (const step of steps) {
    try {
      await runStep(step);
    } catch (error) {
      if (strict) {
        throw new Error(`the ${step.label} step failed (${errorMessage(error)})`);
      }
      logError(integratedDocsFailureLine(step.label, error));
      return false;
    }
  }
  return true;
}

async function listActiveTenants(runner) {
  return runner.query(`
    SELECT id::text AS id,
           COALESCE(slug, '')::text AS slug
    FROM tenants
    WHERE deleted_at IS NULL
      AND status = 'active'
    ORDER BY slug, id
  `);
}

async function integratedDocsTablesPresent(runner) {
  const rows = await runner.query(`
    SELECT to_regclass('public.integrated_document_bindings')::text AS bindings_table,
           to_regclass('public.integrated_document_slot_settings')::text AS settings_table
  `);
  return !!rows[0]?.bindings_table && !!rows[0]?.settings_table;
}

async function tenantNeedsIntegratedDocsRollout(runner, tenantId) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
  const rows = await runner.query(`
    SELECT
      (SELECT COUNT(*)::int FROM portfolio_requests WHERE tenant_id = app_current_tenant()) AS request_count,
      (SELECT COUNT(*)::int FROM portfolio_projects WHERE tenant_id = app_current_tenant()) AS project_count,
      (
        SELECT COUNT(*)::int
        FROM integrated_document_bindings
        WHERE tenant_id = app_current_tenant()
          AND source_entity_type = 'requests'
          AND slot_key = 'purpose'
      ) AS request_purpose_binding_count,
      (
        SELECT COUNT(*)::int
        FROM integrated_document_bindings
        WHERE tenant_id = app_current_tenant()
          AND source_entity_type = 'requests'
          AND slot_key = 'risks_mitigations'
      ) AS request_risks_binding_count,
      (
        SELECT COUNT(*)::int
        FROM integrated_document_bindings
        WHERE tenant_id = app_current_tenant()
          AND source_entity_type = 'projects'
          AND slot_key = 'purpose'
      ) AS project_purpose_binding_count
  `);
  const counts = rows[0] || {};
  return (
    Number(counts.request_count || 0) !== Number(counts.request_purpose_binding_count || 0)
    || Number(counts.request_count || 0) !== Number(counts.request_risks_binding_count || 0)
    || Number(counts.project_count || 0) !== Number(counts.project_purpose_binding_count || 0)
  );
}

async function detectIntegratedDocsRolloutNeed(ds) {
  const runner = ds.createQueryRunner();
  await runner.connect();
  try {
    if (!await integratedDocsTablesPresent(runner)) {
      console.log('[entrypoint] Integrated-doc tables not present yet. Skipping auto rollout.');
      return false;
    }

    const tenants = await listActiveTenants(runner);
    if (!tenants.length) {
      console.log('[entrypoint] No active tenants found for integrated-doc auto rollout.');
      return false;
    }

    for (const tenant of tenants) {
      if (await tenantNeedsIntegratedDocsRollout(runner, tenant.id)) {
        console.log(`[entrypoint] Integrated-doc rollout needed for tenant ${tenant.slug || tenant.id}.`);
        return true;
      }
    }

    console.log('[entrypoint] Integrated-doc bindings already match request/project counts. Skipping auto rollout.');
    return false;
  } finally {
    await runner.release();
  }
}

async function runIntegratedDocsRolloutIfNeeded() {
  const rolloutMode = readIntegratedDocsRolloutMode();
  if (rolloutMode === 'off') {
    return;
  }

  const dsPath = path.resolve(__dirname, '../dist/data-source.js');
  const ds = require(dsPath).default;
  await ds.initialize();

  const lockRunner = ds.createQueryRunner();
  await lockRunner.connect();

  try {
    console.log('[entrypoint] Waiting for integrated-doc auto-rollout lock...');
    await lockRunner.query(`SELECT pg_advisory_lock(hashtext($1))`, [INTEGRATED_DOCS_ROLLOUT_LOCK_KEY]);

    const shouldRun = rolloutMode === 'always'
      ? true
      : await detectIntegratedDocsRolloutNeed(ds);

    if (!shouldRun) {
      return;
    }

    const done = await runIntegratedDocsSteps(integratedDocsRolloutSteps(), { strict: isIntegratedDocsRolloutStrict() });
    if (done) {
      console.log('[entrypoint] Integrated-doc rollout complete.');
    }
  } finally {
    try {
      await lockRunner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [INTEGRATED_DOCS_ROLLOUT_LOCK_KEY]);
    } catch (error) {
      console.warn('[entrypoint] Failed to release integrated-doc auto-rollout lock:', error?.message || error);
    }
    await lockRunner.release();
    await ds.destroy();
  }
}

/** The first characters of the statement a failed migration ran, on one line (never its parameters). */
function failedStatement(err) {
  const query = err && typeof err.query === 'string' ? err.query.replace(/\s+/g, ' ').trim() : '';
  return query ? (query.length > 300 ? `${query.slice(0, 300)}...` : query) : '';
}

/**
 * PostgreSQL codes of a lost or refused connection: 57P01 (admin shutdown), 57P03 (cannot connect
 * now), and the connection exception class 08; Node's ECONNRESET and ECONNREFUSED.
 */
const CONNECTION_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', '57P01', '57P03']);

/**
 * Whether an error is the database going away or not answering, never a migration's own failure:
 * one of the codes above (on the error or on the driver error TypeORM wraps), or node-postgres'
 * "Connection terminated unexpectedly", which carries no code.
 */
function isConnectionError(err) {
  const codes = [err?.code, err?.driverError?.code].filter((code) => code != null).map(String);
  if (codes.some((code) => CONNECTION_ERROR_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code))) return true;
  return /Connection terminated unexpectedly/i.test(String(err?.message || ''));
}

/** Closes a data source an attempt left open; a failure to close is only a warning. */
async function closeQuietly(ds, warn) {
  if (!ds.isInitialized) return;
  try {
    await ds.destroy();
  } catch (destroyErr) {
    warn('[entrypoint] Failed to reset the DB connection:', destroyErr?.message || destroyErr);
  }
}

/**
 * Runs the pending migrations once the database answers. Only the connection is retried, while
 * the database is not ready or goes away (`isConnectionError`): `MIGRATION_MAX_ATTEMPTS` tries in
 * all (30), `MIGRATION_RETRY_DELAY_MS` apart (2 s). A migration that fails on its own exits at once
 * (code 1) with its message, since running it again would fail the same way and keep the API down
 * for every retry (plan planning/budget-unifie.md, G.13). The pending migrations run in one
 * transaction (TypeORM's default): a failure leaves the database as it was before this start, and
 * the container's restart policy decides what comes next.
 */
async function runMigrationsIfNeeded({
  env = process.env,
  loadDataSource = () => require(path.resolve(__dirname, '../dist/data-source.js')).default,
  exit = (code) => process.exit(code),
  sleepFn = sleep,
  log = console.log,
  warn = console.warn,
  error = console.error,
} = {}) {
  if ((env.SKIP_MIGRATIONS || '').toLowerCase() === 'true') {
    log('[entrypoint] SKIP_MIGRATIONS=true → skipping DB migrations');
    return;
  }
  const ds = loadDataSource();
  const maxAttempts = Number(env.MIGRATION_MAX_ATTEMPTS || 30);
  const delayMs = Number(env.MIGRATION_RETRY_DELAY_MS || 2000);

  for (let attempt = 1; ; attempt += 1) {
    let step = 'connect';
    try {
      log(`[entrypoint] Initializing DB (attempt ${attempt}/${maxAttempts}) ...`);
      await ds.initialize();
      log('[entrypoint] DB initialized. Running migrations...');
      step = 'migrate';
      const migrations = await ds.runMigrations();
      log(`[entrypoint] Migrations complete (${migrations.length} executed).`);
      await ds.destroy();
      return;
    } catch (err) {
      await closeQuietly(ds, warn);
      if (step === 'migrate' && !isConnectionError(err)) {
        error(`[entrypoint] A migration failed, not retried: ${err?.message || err}`);
        const statement = failedStatement(err);
        if (statement) error(`[entrypoint] Failed statement: ${statement}`);
        error('[entrypoint] The pending migrations ran in one transaction and were rolled back: the database is as before this start. Fix the cause or deploy the previous version.');
        if (env.DEBUG_MIGRATIONS) error('[entrypoint] Error details:', err);
        exit(1);
        return;
      }
      const what = step === 'connect' ? 'DB not ready' : 'DB connection lost during the migrations (rolled back, nothing applied)';
      if (attempt >= maxAttempts) {
        error(`[entrypoint] ${what} after ${maxAttempts} attempts: ${err?.message || err}`);
        if (env.DEBUG_MIGRATIONS) error('[entrypoint] Error details:', err);
        exit(1);
        return;
      }
      const msg = err && err.message ? `: ${err.message}` : '';
      warn(`[entrypoint] ${what} (attempt ${attempt})${msg}. Retrying in ${delayMs}ms...`);
      if (attempt === 1 && env.DEBUG_MIGRATIONS) warn('[entrypoint] First failure details:', err);
      await sleepFn(delayMs);
    }
  }
}

async function main() {
  // Migrations run once, here, before any API process starts: TypeORM takes no lock, so two
  // processes migrating at once would collide.
  await runMigrationsIfNeeded();
  try {
    await runIntegratedDocsRolloutIfNeeded();
  } catch (error) {
    // The rollout check itself failed (lock, counts). Migrations are done: the API starts.
    if (isIntegratedDocsRolloutStrict()) {
      throw error;
    }
    console.error(integratedDocsFailureLine('rollout check', error));
  }
  const mainScript = path.resolve(__dirname, '../dist/main.js');
  const { parseApiWorkers } = require(path.resolve(__dirname, '../dist/common/cluster/process-role.js'));
  const workers = parseApiWorkers(process.env.API_WORKERS);
  if (workers > 1) {
    const { runClusterPrimary } = require(path.resolve(__dirname, '../dist/common/cluster/cluster-primary.js'));
    runClusterPrimary({ workers, exec: mainScript });
    return;
  }
  // Start the API (compiled output) in this process. The image starts this script with the
  // exec form of CMD, so node gets SIGTERM itself; main.ts drains on it (graceful-shutdown.ts).
  require(mainScript);
}

if (require.main === module) {
  main();
}

module.exports = {
  integratedDocsFailureLine,
  isConnectionError,
  integratedDocsRolloutSteps,
  readIntegratedDocsRolloutMode,
  runIntegratedDocsSteps,
  runMigrationsIfNeeded,
  runNodeScript,
};
