import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import { SuppliersController } from '../suppliers.controller';
import { SuppliersService } from '../suppliers.service';
import { SuppliersDeleteService } from '../suppliers-delete.service';
import { SupplierContactsService } from '../supplier-contacts.service';

// POST /suppliers/import through the real controller and Nest's HTTP stack (lot I4 of 26.11.9):
// `mode` is `enrich` or `replace`, `enrich` when the request names none; any other value is a
// 400 before the service reads the file. The service is a stub that records what the route hands
// it. The route's guards (authentication, rights) are taken off the controller for this process:
// their own specs cover them.

async function main() {
  const calls: Array<{ mode: unknown; dryRun: boolean }> = [];
  const service = {
    importCsv: async (params: { mode?: unknown; dryRun: boolean }): Promise<{ ok: boolean }> => {
      calls.push({ mode: params.mode, dryRun: params.dryRun });
      return { ok: true };
    },
  };
  Reflect.defineMetadata(GUARDS_METADATA, [], SuppliersController);
  for (const name of Object.getOwnPropertyNames(SuppliersController.prototype)) {
    const handler = (SuppliersController.prototype as any)[name];
    if (typeof handler === 'function') Reflect.defineMetadata(GUARDS_METADATA, [], handler);
  }
  @Module({
    controllers: [SuppliersController],
    providers: [
      { provide: SuppliersService, useValue: service },
      { provide: SuppliersDeleteService, useValue: {} },
      { provide: SupplierContactsService, useValue: {} },
    ],
  })
  class ImportModeProbeModule {}
  const app: INestApplication = await NestFactory.create(ImportModeProbeModule, { logger: false, abortOnError: false });
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: '00000000-0000-0000-0000-000000000001', slug: 'import-mode', name: 'Import mode' };
    req.user = { sub: '00000000-0000-0000-0000-000000000002' };
    next();
  });
  await app.listen(0, '127.0.0.1');
  try {
    const { port } = app.getHttpServer().address() as AddressInfo;
    const post = async (query: string) => {
      const form = new FormData();
      form.append('file', new Blob(['name;notes\nAcme;x\n'], { type: 'text/csv' }), 'suppliers.csv');
      const res = await fetch(`http://127.0.0.1:${port}/suppliers/import?dryRun=true&language=en${query}`, { method: 'POST', body: form });
      return { status: res.status, body: await res.json() as any };
    };

    const unknown = await post('&mode=merge');
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.message, 'mode must be enrich or replace.');
    assert.deepEqual(calls, [], 'the service never ran');

    assert.equal((await post('')).status, 201);
    assert.equal((await post('&mode=')).status, 201);
    assert.equal((await post('&mode=replace')).status, 201);
    assert.equal((await post('&mode=enrich')).status, 201);
    assert.deepEqual(calls.map((call: { mode: unknown }) => call.mode), ['enrich', 'enrich', 'replace', 'enrich']);
    console.log('suppliers-import-mode-http: OK');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
