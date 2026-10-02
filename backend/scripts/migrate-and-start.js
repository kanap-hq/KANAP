/*
  Simple entrypoint for QA/Prod:
  - Waits for DB
  - Runs TypeORM migrations programmatically using compiled DataSource
  - Optionally runs integrated-doc repair + verification
  - Starts the NestJS server

  Env toggles:
  - API_WORKERS=N (default 1): N > 1 runs N API processes with the Node cluster module. This
    process becomes the cluster primary once the migrations ran, and forks the workers
    (src/common/cluster/cluster-primary.ts). With 1, the API runs here, as before.
  - SKIP_MIGRATIONS=true to skip running migrations at boot
  - INTEGRATED_DOCS_AUTO_ROLLOUT=if-needed|always|off to control boot-time integrated-doc repair
  - INTEGRATED_DOCS_AUTO_ROLLOUT_STRICT=true to fail startup when integrated-doc repair fails
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

function npmBinary() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function runChildCommand(label, args) {
  console.log(`[entrypoint] ${label}...`);
  await new Promise((resolve, reject) => {
    const child = spawn(npmBinary(), args, {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${label} terminated by signal ${signal}`));
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
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

    try {
      await runChildCommand('Running integrated-doc repair', ['run', 'integrated-docs:backfill']);
      await runChildCommand('Verifying integrated-doc repair', ['run', 'integrated-docs:verify']);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (isIntegratedDocsRolloutStrict()) {
        throw error;
      }
      console.error(`[entrypoint] Integrated-doc auto rollout failed: ${message}`);
      console.error('[entrypoint] Continuing startup because schema migrations already completed. Review repair logs and rerun repair after fixing the data issue.');
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

async function runMigrationsIfNeeded() {
  if ((process.env.SKIP_MIGRATIONS || '').toLowerCase() === 'true') {
    console.log('[entrypoint] SKIP_MIGRATIONS=true → skipping DB migrations');
    return;
  }
  const dsPath = path.resolve(__dirname, '../dist/data-source.js');
  const ds = require(dsPath).default;
  const maxAttempts = Number(process.env.MIGRATION_MAX_ATTEMPTS || 30);
  const delayMs = Number(process.env.MIGRATION_RETRY_DELAY_MS || 2000);

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      console.log(`[entrypoint] Initializing DB (attempt ${attempt}/${maxAttempts}) ...`);
      await ds.initialize();
      console.log('[entrypoint] DB initialized. Running migrations...');
      const migrations = await ds.runMigrations();
      console.log(`[entrypoint] Migrations complete (${migrations.length} executed).`);
      await ds.destroy();
      return;
    } catch (err) {
      if (ds.isInitialized) {
        try {
          await ds.destroy();
        } catch (destroyErr) {
          console.warn('[entrypoint] Failed to reset DB connection after migration error:', destroyErr?.message || destroyErr);
        }
      }
      if (attempt >= maxAttempts) {
        console.error('[entrypoint] Failed to initialize DB after max attempts:', err?.message || err);
        if (process.env.DEBUG_MIGRATIONS) {
          console.error('[entrypoint] Error details:', err);
        }
        process.exit(1);
      }
      const msg = err && err.message ? `: ${err.message}` : '';
      console.warn(`[entrypoint] DB not ready or migration failed (attempt ${attempt})${msg}. Retrying in ${delayMs}ms...`);
      if (attempt === 1 && process.env.DEBUG_MIGRATIONS) {
        console.warn('[entrypoint] First failure details:', err);
      }
      await sleep(delayMs);
    }
  }
}

(async () => {
  // Migrations run once, here, before any API process starts: TypeORM takes no lock, so two
  // processes migrating at once would collide.
  await runMigrationsIfNeeded();
  await runIntegratedDocsRolloutIfNeeded();
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
})();
