import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import helmet from 'helmet';
import * as cors from 'cors';
import * as express from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { User } from './users/user.entity';
import { Role } from './roles/role.entity';
import { UserRole } from './users/user-role.entity';
import { RolePermission } from './permissions/role-permission.entity';
import { RESOURCES } from './permissions/permissions.service';
import * as argon2 from 'argon2';
import { Request, Response, NextFunction } from 'express';
import { TenantInterceptor } from './common/tenant.interceptor';
import { TenantInitGuard } from './common/tenant-init.guard';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { ReleaseTenantRunnerFilter } from './common/filters/release-tenant-runner.filter';
import { isProductionEnv, parseBoolean, parseCorsPatterns, matchesCorsOrigin, requireAppBaseUrl, requireEnv } from './common/env';
import { describeTokenPurposePolicy } from './auth/access-token.util';
import { describeSecretPolicy } from './auth/token-secret.util';
import { PROCESS_STARTED_AT } from './common/process-start';
import { shouldTrustProxyForRateLimit } from './common/rate-limit';
import { Features } from './config/features';
import { TenantsService } from './tenants/tenants.service';
import { OpsMetricsStore } from './admin/ops/ops-metrics.store';
import { createRequestMetricsMiddleware } from './admin/ops/request-metrics.middleware';
import { ScheduledTasksService } from './admin/scheduled-tasks/scheduled-tasks.service';
import { assertSafeDatabaseRole } from './common/database-role-safety';
import { createRequestTenancyMiddleware } from './common/tenancy/request-tenancy.middleware';
import { createRequestFinalizer } from './common/request-finalizer.middleware';

function validateStartupEnv() {
  requireEnv('DATABASE_URL');
  requireEnv('JWT_SECRET');
  if (isProductionEnv()) {
    requireAppBaseUrl();
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

async function ensurePrimaryUserRole(manager: EntityManager, user: User, role: Role) {
  const userRoleRepo = manager.getRepository(UserRole);
  const existing = await userRoleRepo.findOne({ where: { user_id: user.id, role_id: role.id } });
  if (!existing) {
    const tenantId = user.tenant_id ?? (await manager.query(`SELECT app_current_tenant()::text AS tenant_id`))?.[0]?.tenant_id;
    await userRoleRepo.save(userRoleRepo.create({
      tenant_id: tenantId,
      user_id: user.id,
      role_id: role.id,
      is_primary: true,
    }));
  } else if (!existing.is_primary && user.role_id === role.id) {
    existing.is_primary = true;
    await userRoleRepo.save(existing);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  validateStartupEnv();
  logTokenSecretPolicy();
  const reflector = app.get(Reflector);
  if (shouldTrustProxyForRateLimit()) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
  }
  app.use(helmet());
  const corsPatterns = parseCorsPatterns();
  if (corsPatterns.length === 0) {
    if (isProductionEnv()) {
      throw new Error('FATAL: CORS_ORIGINS must be set in production. Example: CORS_ORIGINS=https://*.kanap.net');
    }
    // In non-production, allow all origins with a warning
    app.use(cors({
      origin: true,
      credentials: true,
    }));
    // eslint-disable-next-line no-console
    console.warn('[CORS] CORS_ORIGINS not set; allowing all origins (dev mode only)');
  } else {
    // eslint-disable-next-line no-console
    console.log(`[CORS] Configured ${corsPatterns.length} origin pattern(s)`);
    app.use(cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (server-to-server, curl, etc.)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (matchesCorsOrigin(origin, corsPatterns)) {
          callback(null, true);
          return;
        }
        // eslint-disable-next-line no-console
        console.warn(`[CORS] Rejected origin: ${origin}`);
        callback(new Error('CORS origin not allowed'), false);
      },
      credentials: true,
    }));
  }
  const rawBodySaver = (req: Request, _res: Response, buffer: Buffer) => {
    if (buffer?.length) {
      (req as any).rawBody = buffer;
    }
  };
  app.use('/stripe/webhook', express.raw({ type: '*/*' }));
  app.use(express.json({ limit: '20mb', verify: rawBodySaver }));
  app.use(express.urlencoded({ limit: '20mb', verify: rawBodySaver, extended: true }));
  // Ops metrics middleware — must be registered before tenancy so it wraps the full pipeline
  const opsMetricsStore = app.get(OpsMetricsStore);
  app.use(createRequestMetricsMiddleware(opsMetricsStore));

  // Use both ValidationPipe (for class-validator DTOs) and ZodValidationPipe (for Zod DTOs)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
    new ZodValidationPipe(),
  );

  // Seed admin user (dev-only convenience). Enable explicitly via SEED_ADMIN=true.
  const ds = app.get(DataSource);
  const roleState = await assertSafeDatabaseRole(ds, 'startup');
  // eslint-disable-next-line no-console
  console.log(`[DB] Connected as PostgreSQL role "${roleState.currentUser}" with native RLS enforcement`);
  const shouldSeedAdmin = parseBoolean(process.env.SEED_ADMIN);
  if (shouldSeedAdmin) {
    const adminEmail = requireEnv('ADMIN_EMAIL');
    const adminPassword = requireEnv('ADMIN_PASSWORD');
    const defaultTenantSlug = requireEnv('DEFAULT_TENANT_SLUG');
    try {
      const runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const row = await runner.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [defaultTenantSlug]);
        const tenantId = row?.[0]?.id as string | undefined;
        if (!tenantId) {
          // eslint-disable-next-line no-console
          console.warn(`Admin seed skipped: tenant '${defaultTenantSlug}' not found`);
          await runner.rollbackTransaction();
          await runner.release();
          return;
        }
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        await runner.query(`SELECT set_config('app.default_tenant_slug', $1, true)`, [defaultTenantSlug]);

        // First ensure roles exist (roles table should be created by migration, but ensure seeding)
        const roleRepo = runner.manager.getRepository(Role);
        const userRepo = runner.manager.getRepository(User);
        const rolePermRepo = runner.manager.getRepository(RolePermission);

        // Seed Administrator and Contact roles if missing
        let adminRole = await roleRepo.findOne({ where: { role_name: 'Administrator' } });
        if (!adminRole) {
          adminRole = await roleRepo.save(roleRepo.create({
            role_name: 'Administrator',
            role_description: 'Full system administrator with access to all features',
            is_system: true,
          }));
        }
        // Ensure Administrator marked as system
        if (!adminRole.is_system) {
          adminRole.is_system = true as any;
          await roleRepo.save(adminRole);
        }
        let contactRole = await roleRepo.findOne({ where: { role_name: 'Contact' } });
        if (!contactRole) {
          contactRole = await roleRepo.save(roleRepo.create({
            role_name: 'Contact',
            role_description: 'Directory contact without app access by default',
            is_system: true,
          }));
        }
        if (!contactRole.is_system) {
          contactRole.is_system = true as any;
          await roleRepo.save(contactRole);
        }

        // Ensure Administrator has full permissions on all resources
        for (const r of RESOURCES) {
          const existing = await rolePermRepo.findOne({ where: { role_id: adminRole.id, resource: r } });
          if (!existing) {
            await rolePermRepo.save(rolePermRepo.create({ role_id: adminRole.id, resource: r, level: 'admin' as any }));
          } else if (existing.level !== 'admin') {
            existing.level = 'admin' as any;
            await rolePermRepo.save(existing);
          }
        }

        const existing = await userRepo.findOne({ where: { email: adminEmail } });
        if (!existing) {
          const password_hash = await argon2.hash(adminPassword, { type: argon2.argon2id });
          const savedAdmin = await userRepo.save(userRepo.create({
            email: adminEmail,
            password_hash,
            tenant_id: tenantId,
            role_id: adminRole.id,
            status: 'enabled'
          }));
          await ensurePrimaryUserRole(runner.manager, savedAdmin, adminRole);
          // eslint-disable-next-line no-console
          console.log(`Seeded admin user ${adminEmail} with Administrator role`);
        } else {
          // Ensure admin user has correct role even if already exists
          if (existing.role_id !== adminRole.id) {
            existing.role_id = adminRole.id;
            await userRepo.save(existing);
            // eslint-disable-next-line no-console
            console.log(`Updated admin user ${adminEmail} to Administrator role`);
          } else {
            // eslint-disable-next-line no-console
            console.log(`Admin user already present: ${adminEmail}`);
          }
          await ensurePrimaryUserRole(runner.manager, existing, adminRole);
        }
        await runner.commitTransaction();
      } catch (seedError) {
        await runner.rollbackTransaction();
        throw seedError;
      } finally {
        await runner.release();
      }
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

    const tenantsService = app.get(TenantsService);

    // 1. Ensure tenant exists (idempotent — TenantsService.createTenant returns existing if found)
    const existing = await ds.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
    if (!existing?.[0]) {
      await tenantsService.createTenant({ slug, name });
      // eslint-disable-next-line no-console
      console.log(`[on-prem] Created tenant '${slug}'`);
    }

    // 2. Seed admin user (reuses SEED_ADMIN logic pattern but triggered by single-tenant mode)
    const adminEmail = process.env.ADMIN_EMAIL?.trim();
    const adminPassword = process.env.ADMIN_PASSWORD?.trim();
    if (adminEmail && adminPassword) {
      const tenantRow = await ds.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
      const tenantId = tenantRow[0].id;
      const runner = ds.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

        const roleRepo = runner.manager.getRepository(Role);
        const userRepo = runner.manager.getRepository(User);
        const rolePermRepo = runner.manager.getRepository(RolePermission);

        let adminRole = await roleRepo.findOne({ where: { role_name: 'Administrator' } });
        if (!adminRole) {
          adminRole = await roleRepo.save(roleRepo.create({
            role_name: 'Administrator',
            role_description: 'Full system administrator with access to all features',
            is_system: true,
          }));
        }
        if (!adminRole.is_system) {
          adminRole.is_system = true as any;
          await roleRepo.save(adminRole);
        }
        let contactRole = await roleRepo.findOne({ where: { role_name: 'Contact' } });
        if (!contactRole) {
          contactRole = await roleRepo.save(roleRepo.create({
            role_name: 'Contact',
            role_description: 'Directory contact without app access by default',
            is_system: true,
          }));
        }
        if (!contactRole.is_system) {
          contactRole.is_system = true as any;
          await roleRepo.save(contactRole);
        }

        for (const r of RESOURCES) {
          const existingPerm = await rolePermRepo.findOne({ where: { role_id: adminRole.id, resource: r } });
          if (!existingPerm) {
            await rolePermRepo.save(rolePermRepo.create({ role_id: adminRole.id, resource: r, level: 'admin' as any }));
          } else if (existingPerm.level !== 'admin') {
            existingPerm.level = 'admin' as any;
            await rolePermRepo.save(existingPerm);
          }
        }

        const existingUser = await userRepo.findOne({ where: { email: adminEmail } });
        if (!existingUser) {
          const password_hash = await argon2.hash(adminPassword, { type: argon2.argon2id });
          const savedAdmin = await userRepo.save(userRepo.create({
            email: adminEmail,
            password_hash,
            tenant_id: tenantId,
            role_id: adminRole.id,
            status: 'enabled',
          }));
          await ensurePrimaryUserRole(runner.manager, savedAdmin, adminRole);
          // eslint-disable-next-line no-console
          console.log(`[on-prem] Seeded admin user ${adminEmail}`);
        } else if (existingUser.role_id !== adminRole.id) {
          existingUser.role_id = adminRole.id;
          await userRepo.save(existingUser);
          await ensurePrimaryUserRole(runner.manager, existingUser, adminRole);
          // eslint-disable-next-line no-console
          console.log(`[on-prem] Updated admin user ${adminEmail} to Administrator role`);
        } else {
          await ensurePrimaryUserRole(runner.manager, existingUser, adminRole);
        }

        await runner.commitTransaction();
      } catch (seedError) {
        await runner.rollbackTransaction();
        throw seedError;
      } finally {
        await runner.release();
      }
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
          VALUES ($1, 'On-Prem', 1000, 0, 'annual', 'card', 'active')
        `, [tenantId]);
        // eslint-disable-next-line no-console
        console.log('[on-prem] Created default subscription (On-Prem, 1000 seats)');
      } else {
        await subRunner.query(`
          UPDATE subscriptions
          SET plan_name = 'On-Prem',
              seat_limit = 1000,
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

  // Tenancy resolution middleware: attach { slug, id? } based on Host header (or the single-tenant
  // slug); a failed lookup answers 503 busy. See common/tenancy/request-tenancy.middleware.ts.
  // NOTE: TenancyMiddleware is available in common/tenancy for use with NestJS module-level
  // middleware configuration. New code should prefer using TenancyManager and @Tenant() decorator in controllers.
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => ds.query(sql, params),
    singleTenant: Features.SINGLE_TENANT,
    defaultTenantSlug: (process.env.DEFAULT_TENANT_SLUG || 'default').trim(),
    platformAdminHost: process.env.PLATFORM_ADMIN_HOST || '',
    marketingRedirectUrl: (process.env.MARKETING_BASE_URL || 'https://www.kanap.net').replace(/\/$/, ''),
  }));
  // Initialize tenant DB context before guards
  app.useGlobalGuards(new TenantInitGuard(ds, reflector));
  // Bind tenant to DB session (reuse or create) around controller handling
  app.useGlobalInterceptors(new TenantInterceptor(ds, reflector));

  // Finalizer middleware: ensure any leftover queryRunner is released on finish/close; a client
  // abort rolls back quietly (one warning line). See common/request-finalizer.middleware.ts.
  app.use(createRequestFinalizer());

  // Global exception filter: release queryRunner on errors thrown before interceptors finalize
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));

  const port = process.env.PORT || 8080;
  await app.listen(port as number);

  // Only the served API runs the startup tasks, never another AppModule context (scripts, specs).
  app.get(ScheduledTasksService).runStartupTasks();
}

bootstrap();
