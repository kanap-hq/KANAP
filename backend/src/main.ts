import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import { parseBoolean, requireEnv, validateStartupEnv } from './common/env';
import { describeTokenPurposePolicy } from './auth/access-token.util';
import { describeSecretPolicy } from './auth/token-secret.util';
import { PROCESS_STARTED_AT } from './common/process-start';
import { Features } from './config/features';
import { TenantsService } from './tenants/tenants.service';
import { TenantBaselineService } from './tenants/tenant-baseline.service';
import { createSingleTenantOnFirstStart } from './tenants/single-tenant-provisioning';
import { ensureBootstrapAdministrator } from './tenants/bootstrap-admin';
import { jwtSecretWarnings } from './common/startup-secrets';
import { ScheduledTasksService } from './admin/scheduled-tasks/scheduled-tasks.service';
import { assertSafeDatabaseRole } from './common/database-role-safety';
import { SchedulerRegistry } from '@nestjs/schedule';
import { installGracefulShutdown } from './common/graceful-shutdown';
import { waitForBackgroundWork } from './common/background-work';
import { EmailService } from './email/email.service';
import { apiProcessCount, clusterWorkerId, isLeadProcess, processLabel } from './common/cluster/process-role';
import { STARTUP_PROVISIONING_LOCK, withStartupLock } from './common/cluster/startup-lock';
import { checkPoolBudget, poolMaxFloorWarning, readPoolMax } from './common/db-pool-budget';
import { DemoDataService } from './demo-data/demo-data.service';
import { applyHttpMiddleware, applyTenancyAndPipeline } from './http-app';

/**
 * Environment checks (common/env.ts): throws where the API always refused to start, prints the
 * rest as warnings (run mode, application address, browser origins).
 */
function checkStartupEnv() {
  const report = validateStartupEnv(process.env, { singleTenant: Features.SINGLE_TENANT });
  // eslint-disable-next-line no-console
  console.log(`[ENV] run mode: ${report.mode}`);
  for (const warning of report.warnings) {
    // eslint-disable-next-line no-console
    console.warn(warning);
  }
}

/**
 * Token families sign with their own key: `PASSWORD_RESET_SECRET` / `ENTRA_STATE_SECRET` when
 * configured, otherwise a key derived from `JWT_SECRET` with a versioned label. Provisioning keeps
 * `JWT_SECRET` until `PROVISIONING_TOKEN_SECRET` is set, because its issuer is outside this
 * repository. Report where each key comes from (never a value) and where the access-token
 * compatibility window stands.
 */
function logTokenSecretPolicy() {
  try {
    const entries = describeSecretPolicy();
    const families = entries.map((entry) => `${entry.family}=${entry.source}`).join(' ');
    // eslint-disable-next-line no-console
    console.log(`[SECRETS] token families: ${families} (environment variables: ${entries.map((e) => e.envVar).join(', ')})`);
    const purpose = describeTokenPurposePolicy(process.env, PROCESS_STARTED_AT, PROCESS_STARTED_AT);
    // eslint-disable-next-line no-console
    (purpose.level === 'warn' ? console.warn : console.log)(`[SECRETS] ${purpose.message}`);
  } catch (err: any) {
    // Never block start-up on this line: the access-token policy itself logs its own warnings.
    // eslint-disable-next-line no-console
    console.warn(`[SECRETS] unable to report token secret policy: ${err?.message || String(err)}`);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  checkStartupEnv();
  logTokenSecretPolicy();
  // Proxy trust, headers, browser origins, body parsers, ops metrics (http-app.ts).
  applyHttpMiddleware(app);

  // Seed admin user (dev-only convenience). Enable explicitly via SEED_ADMIN=true.
  const ds = app.get(DataSource);
  const roleState = await assertSafeDatabaseRole(ds, 'startup');
  // eslint-disable-next-line no-console
  console.log(`[DB] Connected as PostgreSQL role "${roleState.currentUser}" with native RLS enforcement`);
  // `[SECURITY]` lines (startup-secrets.ts): printed once per start, by the lead process.
  const securityWarnings = new Set<string>(jwtSecretWarnings(process.env));
  // Start-up writes (admin seed, single-tenant provisioning) check then insert: with several API
  // processes starting together they take turns under one advisory lock (startup-lock.ts).
  await withStartupLock(ds, STARTUP_PROVISIONING_LOCK, async () => {
    const shouldSeedAdmin = parseBoolean(process.env.SEED_ADMIN);
    if (shouldSeedAdmin) {
      const adminEmail = requireEnv('ADMIN_EMAIL');
      const adminPassword = requireEnv('ADMIN_PASSWORD');
      const defaultTenantSlug = requireEnv('DEFAULT_TENANT_SLUG');
      try {
        const seeded = await ensureBootstrapAdministrator(ds, {
          // Single-tenant: the provisioning below checks the same account's password.
          tenantSlug: defaultTenantSlug, email: adminEmail, password: adminPassword, checkPassword: isLeadProcess() && !Features.SINGLE_TENANT,
        });
        seeded.warnings.forEach((warning) => securityWarnings.add(warning));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Admin seed check failed:', err instanceof Error ? err.message : err);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('Admin seeding disabled (set SEED_ADMIN=true to enable)');
    }

    // Single-tenant auto-provisioning: create tenant + admin + subscription on first boot
    if (Features.SINGLE_TENANT) {
      const slug = (process.env.DEFAULT_TENANT_SLUG || 'default').trim();
      const name = (process.env.DEFAULT_TENANT_NAME || 'My Organization').trim();

      // 1. Create the tenant on the first start only, with the default global chart of accounts
      if (await createSingleTenantOnFirstStart(ds, app.get(TenantsService), app.get(TenantBaselineService), { slug, name })) {
        // eslint-disable-next-line no-console
        console.log(`[on-prem] Created tenant '${slug}'`);
      }

      // 2. Administrator account: created, or restored, only when no active administrator remains (bootstrap-admin.ts)
      const adminEmail = process.env.ADMIN_EMAIL?.trim();
      const adminPassword = process.env.ADMIN_PASSWORD?.trim();
      if (adminEmail && adminPassword) {
        const seeded = await ensureBootstrapAdministrator(ds, {
          tenantSlug: slug, email: adminEmail, password: adminPassword, checkPassword: isLeadProcess(), logPrefix: '[on-prem] ',
        });
        seeded.warnings.forEach((warning) => securityWarnings.add(warning));
      }

      // 3. Bootstrap subscription row
      const tenantRow = await ds.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
      const tenantId = tenantRow[0].id;
      const subRunner = ds.createQueryRunner();
      await subRunner.connect();
      await subRunner.startTransaction();
      try {
        await subRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        const subRows = await subRunner.query('SELECT id FROM subscriptions LIMIT 1');
        if (!subRows?.[0]) {
          await subRunner.query(`
            INSERT INTO subscriptions (tenant_id, plan_name, seat_limit, active_seats, subscription_type, payment_mode, status)
            VALUES ($1, 'On-Prem', NULL, 0, 'annual', 'card', 'active')
          `, [tenantId]);
          // eslint-disable-next-line no-console
          console.log('[on-prem] Created default subscription (On-Prem)');
        } else {
          await subRunner.query(`
            UPDATE subscriptions
            SET plan_name = 'On-Prem',
                seat_limit = NULL,
                subscription_type = 'annual',
                payment_mode = 'card',
                status = 'active'
            WHERE id = $1
          `, [subRows[0].id]);
        }
        await subRunner.commitTransaction();
      } catch (e) {
        await subRunner.rollbackTransaction();
        // eslint-disable-next-line no-console
        console.error('[on-prem] Subscription bootstrap failed:', e);
      } finally {
        await subRunner.release();
      }
    }
  });
  // eslint-disable-next-line no-console
  if (isLeadProcess()) securityWarnings.forEach((warning) => console.warn(warning));

  // Tenant resolution from the Host header, the request pipeline and the finalizer (http-app.ts).
  applyTenancyAndPipeline(app, ds);

  const port = process.env.PORT || 8080;
  await app.listen(port as number);

  // Stop (graceful-shutdown.ts): the cron jobs stop at once, no new connections, the requests in
  // flight finish; then, before the pool closes and within the drain time, the work they left:
  // notification chains, running scheduled tasks (still going at the deadline: recorded as
  // interrupted), the notifications those tasks started, and the email queue.
  const schedulerRegistry = app.get(SchedulerRegistry);
  const scheduledTasks = app.get(ScheduledTasksService);
  const emailService = app.get(EmailService);
  const demoData = app.get(DemoDataService);
  installGracefulShutdown({
    server: app.getHttpServer(),
    label: processLabel(),
    beforeDrain: () => {
      schedulerRegistry.getCronJobs().forEach((job) => job.stop());
      // A sample data load of this process stops; the next start takes it over (reset).
      demoData.stop();
    },
    close: async (deadlineAt) => {
      await waitForBackgroundWork(deadlineAt);
      await scheduledTasks.drain(deadlineAt);
      const left = await waitForBackgroundWork(deadlineAt);
      if (left > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[shutdown] ${processLabel()}: ${left} notification(s) or background job(s) still running, cut by the stop`);
      }
      await emailService.drain(deadlineAt);
      await app.close();
    },
  });

  if (isLeadProcess()) {
    // Once per start, not once per worker: the connection budget of all the processes
    // (warning only, db-pool-budget.ts) and the startup tasks. Only the served API runs the
    // startup tasks, never another AppModule context (scripts, specs).
    try {
      const budget = await checkPoolBudget((sql, params) => ds.query(sql, params), {
        processes: apiProcessCount(),
        poolMax: readPoolMax(),
      });
      // eslint-disable-next-line no-console
      (budget.ok ? console.log : console.warn)(budget.message);
      const floor = poolMaxFloorWarning();
      // eslint-disable-next-line no-console
      if (floor) console.warn(floor);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[DB] pool budget not checked: ${(err as Error)?.message ?? err}`);
    }
    scheduledTasks.runStartupTasks();
    // Sample data loads and resets left by a stopped API process, now and every 2 minutes (demo-data.service.ts).
    void demoData.reconcileOnStartup();
  }
  if (clusterWorkerId() !== null) {
    // eslint-disable-next-line no-console
    console.log(`[cluster] ${processLabel()} (pid ${process.pid}) listening on ${port}`);
  }
}

bootstrap();
