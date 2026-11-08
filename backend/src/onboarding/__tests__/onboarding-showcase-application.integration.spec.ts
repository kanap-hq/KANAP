import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  runSpecs,
  Services,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { buildAccessTokenPayload } from '../../auth/auth.service';
import { accessTokenVerifyKey } from '../../auth/jwt-key';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { createRequestTenancyMiddleware } from '../../common/tenancy/request-tenancy.middleware';
import { DemoDataService } from '../../demo-data/demo-data.service';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { buildDemoData, permissionGuardProviders } from './onboarding-test-helpers';
import { OnboardingController } from '../onboarding.controller';
import { OnboardingService } from '../onboarding.service';

// `GET /onboarding/showcase-application` over HTTP (the application the cartography step "an
// application record" opens): the real controller behind JwtAuthGuard and PermissionGuard, the
// tenancy middleware and the request pipeline, the real OnboardingService on the spec database.
// - the most critical application with the most deployments, interfaces and technologies, before
//   an emptier critical one and a lower one with a bigger footprint;
// - a disabled or retired application, and another workspace's, are never chosen;
// - a Business Contributor gets one of their own applications; no applications read is a 403;
// - a workspace without applications answers `{ item: null }`.
// @database-spec: opens the data-source and boots Nest, so run-ci-tests.js runs it on a database lane.

type Served = { app: INestApplication; port: number; close: () => Promise<void> };

async function serve(): Promise<Served> {
  const demo = buildDemoData(buildServices());
  @Module({
    controllers: [OnboardingController],
    providers: [
      ListContextsService,
      OnboardingService,
      { provide: DataSource, useValue: dataSource },
      { provide: DemoDataService, useValue: demo.service },
      ...permissionGuardProviders(),
    ],
  })
  class ShowcaseProbeModule {}

  const app = await NestFactory.create(ShowcaseProbeModule, { logger: false });
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => dataSource.query(sql, params),
    singleTenant: false,
    defaultTenantSlug: 'default',
    platformAdminHost: 'platform.onboarding-spec.test',
    marketingRedirectUrl: 'https://www.kanap.test',
  }));
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return { app, port, close: () => app.close() };
}

function showcase(served: Served, t: ActivatedTenant, token: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: served.port,
      method: 'GET',
      path: '/onboarding/showcase-application',
      headers: { Host: `${t.slug}.lvh.me`, Authorization: `Bearer ${token}` },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any = text;
        try { body = text ? JSON.parse(text) : null; } catch { /* text */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function tokenFor(user: { id: string; email: string; tenant_id: string }): string {
  return jwt.sign(buildAccessTokenPayload(user), accessTokenVerifyKey(), { expiresIn: '10m' });
}

const ownerToken = (t: ActivatedTenant) => tokenFor({ id: t.ownerId, email: t.ownerEmail, tenant_id: t.tenantId });

async function userToken(tenantId: string, id: string): Promise<string> {
  const [row] = await inTenant(tenantId, (m) => m.query(`SELECT email FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, id]));
  return tokenFor({ id, email: row.email, tenant_id: tenantId });
}

/** The default business criticality levels in the tenant's catalog (`business_critical` ranks first). */
async function setCatalog(tenantId: string) {
  await dataSource.query(
    `UPDATE tenants
        SET metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('it_ops', COALESCE(metadata->'it_ops', '{}'::jsonb) || jsonb_build_object('business_criticality_levels', $2::jsonb))
      WHERE id = $1`,
    [tenantId, JSON.stringify(DEFAULT_CLASSIFICATION_CATALOG.businessCriticalityLevels)],
  );
}

let technologyNumber = 0;
let interfaceNumber = 0;

/**
 * An application with `deployments` environments, `technologies` technologies and an interface
 * to each of `interfacesTo`; `disabled` and `retired` take it out of the default list.
 */
async function application(
  tenantId: string,
  name: string,
  criticality: string,
  opts: { deployments?: number; technologies?: number; interfacesTo?: string[]; disabled?: boolean; retired?: boolean } = {},
): Promise<string> {
  return inTenant(tenantId, async (m) => {
    const [row] = await m.query(
      `INSERT INTO applications (tenant_id, name, criticality, status, disabled_at, lifecycle)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        tenantId, name, criticality,
        opts.disabled ? 'disabled' : 'enabled',
        opts.disabled ? new Date(Date.now() - 86_400_000) : null,
        opts.retired ? 'retired' : 'active',
      ],
    );
    const id: string = row.id;
    for (let i = 0; i < (opts.deployments ?? 0); i += 1) {
      await m.query(`INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, $3)`, [tenantId, id, `env-${i}`]);
    }
    for (let i = 0; i < (opts.technologies ?? 0); i += 1) {
      technologyNumber += 1;
      const [tech] = await m.query(
        `INSERT INTO technologies (tenant_id, name, item_number) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, `Showcase tech ${technologyNumber}`, 900_000 + technologyNumber],
      );
      await m.query(`INSERT INTO application_technologies (tenant_id, application_id, technology_id) VALUES ($1, $2, $3)`, [tenantId, id, tech.id]);
    }
    for (const target of opts.interfacesTo ?? []) {
      interfaceNumber += 1;
      await m.query(
        `INSERT INTO interfaces (tenant_id, interface_reference, name, business_purpose, data_category, integration_route_type,
                                 source_application_id, target_application_id)
         VALUES ($1, $2, $3, 'Showcase', 'master_data', 'direct', $4, $5)`,
        [tenantId, `SHOW-${interfaceNumber}`, `Showcase interface ${interfaceNumber}`, id, target],
      );
    }
    return id;
  });
}

async function testShowcaseApplication() {
  const svc: Services = buildServices();
  const served = await serve();
  let a: ActivatedTenant | undefined;
  let b: ActivatedTenant | undefined;
  try {
    a = await createActivatedTenant(svc, { tag: 'onb-show-a', orgName: 'Onboarding Showcase A' });
    b = await createActivatedTenant(svc, { tag: 'onb-show-b', orgName: 'Onboarding Showcase B' });
    await setCatalog(a.tenantId);
    await setCatalog(b.tenantId);

    assert.deepEqual((await showcase(served, b, ownerToken(b))).body, { item: null }, 'a workspace without applications');

    // Workspace A: an empty critical application (first by name), a richer critical one, a lower
    // one with a bigger footprint, a disabled and a retired critical one with the biggest.
    const lower = await application(a.tenantId, 'Lower footprint', 'high', { deployments: 3, technologies: 2 });
    const empty = await application(a.tenantId, 'Aaa empty critical', 'business_critical');
    const rich = await application(a.tenantId, 'Rich critical', 'business_critical', { deployments: 2, technologies: 1, interfacesTo: [lower] });
    await application(a.tenantId, 'Disabled critical', 'business_critical', { deployments: 5, technologies: 2, interfacesTo: [lower], disabled: true });
    await application(a.tenantId, 'Retired critical', 'business_critical', { deployments: 5, technologies: 2, retired: true });
    // Workspace B: a critical application richer than any of A.
    const other = await application(b.tenantId, 'Other workspace critical', 'business_critical', { deployments: 6, technologies: 3 });

    const res = await showcase(served, a, ownerToken(a));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { item: { id: rich, name: 'Rich critical' } }, 'the richest enabled critical application of the workspace');
    assert.deepEqual((await showcase(served, b, ownerToken(b))).body, { item: { id: other, name: 'Other workspace critical' } }, 'each workspace its own');

    // A Business Contributor reads only the applications they own.
    const contributor = await inTenant(a.tenantId, async (manager) => {
      const user = await svc.users.createUser({
        email: `contributor-${Date.now()}@reset-spec.test`,
        role_name: 'Business Contributor',
        first_name: 'Busy',
        last_name: 'Contributor',
        tenant_id: a!.tenantId,
      }, { manager });
      await manager.query(
        `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
        [a!.tenantId, empty, user.id],
      );
      return user.id as string;
    });
    const asContributor = await showcase(served, a, await userToken(a.tenantId, contributor));
    assert.equal(asContributor.status, 200, JSON.stringify(asContributor.body));
    assert.deepEqual(asContributor.body, { item: { id: empty, name: 'Aaa empty critical' } }, 'a Business Contributor gets one of their own');

    // A Budget Reader does not read the applications.
    const reader = await inTenant(a.tenantId, async (manager) => (await svc.users.createUser({
      email: `budget-reader-${Date.now()}@reset-spec.test`,
      role_name: 'Budget Reader',
      first_name: 'Budget',
      last_name: 'Reader',
      tenant_id: a!.tenantId,
    }, { manager })).id as string);
    const refused = await showcase(served, a, await userToken(a.tenantId, reader));
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
  } finally {
    await served.close();
    await cleanupTenants([a?.tenantId, b?.tenantId]);
  }
}

runSpecs('onboarding-showcase-application.integration.spec', [
  testShowcaseApplication,
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
