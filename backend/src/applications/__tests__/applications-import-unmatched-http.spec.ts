import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import * as jwt from 'jsonwebtoken';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { ACCESS_TOKEN_PURPOSE } from '../../auth/access-token.util';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { PermissionsService } from '../../permissions/permissions.service';
import { UsersService } from '../../users/users.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { StorageService } from '../../common/storage/storage.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { ApplicationsController } from '../applications.controller';
import { ApplicationsCsvService } from '../applications-csv.service';
import { ApplicationsDeleteService } from '../applications-delete.service';
import { ApplicationsRelationsService, ApplicationsService } from '../services';

// Lot I3 of 26.11.9, fixes after the adversarial review (finding 11): the import route of the
// applications, through Nest's HTTP layer and its multipart interceptor, binds the `unmatched`
// text field of the form (the matches the person undid) and hands the list to the import; a list
// it cannot read is refused with 400 before any work. The real controller, its guards and its
// interceptor; its services, and the reads of the rights guard (an administrator), replaced by probes,
// no database.

process.env.JWT_SECRET ||= 'applications-import-unmatched-http-spec-secret-0123';
const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const UNDONE = [{ column: 'supplier_name', value: 'Societe Generale' }];

async function createApp(seen: unknown[][]): Promise<INestApplication> {
  const csv = { import: async (...args: unknown[]) => { seen.push(args); return { ok: true }; } };
  @Module({
    // The other routes of the controller have their own guards (the share rate limit).
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
    controllers: [ApplicationsController],
    providers: [
      { provide: ApplicationsService, useValue: {} },
      { provide: StorageService, useValue: {} },
      { provide: ApplicationsDeleteService, useValue: {} },
      { provide: ApplicationsCsvService, useValue: csv },
      { provide: KnowledgeService, useValue: {} },
      { provide: IntegratedDocumentsService, useValue: {} },
      { provide: DataSource, useValue: {} },
      { provide: TasksUnifiedService, useValue: {} },
      { provide: ApplicationsRelationsService, useValue: {} },
      // The rights guard of `@RequireLevel`: the person is an administrator, the workspace not frozen.
      { provide: UsersService, useValue: { findById: async () => ({ id: USER, status: 'enabled', role_id: null, role: { role_name: 'Administrator' } }) } },
      { provide: PermissionsService, useValue: {} },
      { provide: StripeConfigService, useValue: { isConfigured: () => false } },
    ],
  })
  class ProbeModule {}
  const app = await NestFactory.create(ProbeModule, { logger: false, abortOnError: false });
  // What the tenancy middleware and `TenantInitGuard` give a request of the workspace.
  app.use((req: any, _res: unknown, next: () => void) => {
    req.tenant = { id: TENANT };
    req.queryRunner = { manager: { query: async () => [], getRepository: () => ({ find: async () => [] }) } };
    next();
  });
  await app.listen(0, '127.0.0.1');
  return app;
}

async function post(app: INestApplication, fields: Array<[string, string]>) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const body = new FormData();
  body.append('file', new Blob(['name\nAlpha\n'], { type: 'text/csv' }), 'applications.csv');
  for (const [name, value] of fields) body.append(name, value);
  const token = jwt.sign({ purpose: ACCESS_TOKEN_PURPOSE, sub: USER, role: 'temporary', tenant_id: TENANT }, process.env.JWT_SECRET!, { expiresIn: '5m' });
  const res = await fetch(`http://127.0.0.1:${port}/applications/import?dryRun=true&language=en`, {
    method: 'POST', body, headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.status, text: await res.text() };
}

async function run() {
  const seen: unknown[][] = [];
  const app = await createApp(seen);
  try {
    const sent = await post(app, [['unmatched', JSON.stringify(UNDONE)]]);
    assert.equal(sent.status, 201, sent.text);
    assert.equal(seen.length, 1);
    assert.deepEqual((seen[0][1] as { unmatched?: unknown }).unmatched, UNDONE, 'the form field reaches the import');

    const none = await post(app, []);
    assert.equal(none.status, 201, none.text);
    assert.deepEqual((seen[1][1] as { unmatched?: unknown }).unmatched, [], 'no field: nothing undone');

    const bad = await post(app, [['unmatched', '{not json']]);
    assert.equal(bad.status, 400, bad.text);
    assert.equal(seen.length, 2, 'refused before the import');
  } finally {
    await app.close();
  }
  console.log('applications-import-unmatched-http.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
