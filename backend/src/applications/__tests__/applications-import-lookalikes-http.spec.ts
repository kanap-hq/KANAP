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

// Lot I3 of 26.11.9, pass 3a: the import route of the applications, through Nest's HTTP layer and
// its multipart interceptor, binds the `lookalikes` text field of the form (the person's choices for
// the rows that look like an application) and hands the list to the import; a list it cannot read,
// or of more than 200 choices, is refused with 400 before any work. The real controller, its guards
// and its interceptor; its services, and the reads of the rights guard (an administrator), replaced
// by probes, no database.

process.env.JWT_SECRET ||= 'applications-import-lookalikes-http-spec-secret-0123';
const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const ID = '00000000-0000-4000-8000-0000000000aa';
const CHOICES = [
  { kind: 'lookalike', line: 2, action: 'update', id: ID, state: '0123456789abcdef' },
  { kind: 'lookalikes', action: 'ignore', targets: { 3: { id: ID, state: 'fedcba9876543210' } } },
];

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
    const sent = await post(app, [['lookalikes', JSON.stringify(CHOICES)]]);
    assert.equal(sent.status, 201, sent.text);
    assert.equal(seen.length, 1);
    assert.deepEqual((seen[0][1] as { lookalikes?: unknown }).lookalikes, [
      CHOICES[0],
      { kind: 'lookalikes', action: 'ignore', targets: { 3: { id: ID, state: 'fedcba9876543210' } } },
    ], 'the form field reaches the import');

    const none = await post(app, []);
    assert.equal(none.status, 201, none.text);
    assert.deepEqual((seen[1][1] as { lookalikes?: unknown }).lookalikes, [], 'no field: no choice');

    // "Update" without the state of the check (review 4, C5): for one row, and for all rows without their targets.
    for (const bad of ['{not json', JSON.stringify([{ kind: 'lookalike', line: 2, action: 'update', id: 'APP-4' }]),
      JSON.stringify([{ kind: 'lookalike', line: 2, action: 'update', id: ID }]), JSON.stringify([{ kind: 'lookalikes', action: 'update' }]),
      JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ kind: 'lookalike', line: i + 2, action: 'create' })))]) {
      const refused = await post(app, [['lookalikes', bad]]);
      assert.equal(refused.status, 400, refused.text);
    }
    assert.equal(seen.length, 2, 'refused before the import');
    const most = await post(app, [['lookalikes', JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ kind: 'lookalike', line: i + 2, action: 'create' })))]]);
    assert.equal(most.status, 201, '200 choices are taken');
  } finally {
    await app.close();
  }
  console.log('applications-import-lookalikes-http.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
