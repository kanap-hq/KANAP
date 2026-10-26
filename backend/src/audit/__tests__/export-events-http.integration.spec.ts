import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { BadRequestException, CanActivate, Controller, Get, INestApplication, Injectable, Module, Post, Res, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Response } from 'express';
import dataSource from '../../data-source';
import { ExportRoute, recordExportRows } from '../security-events';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';

// Exports in the audit log, over HTTP against the database, with the
// production request pipeline (common/request-pipeline.ts): a route whose path
// ends with `/export`, or a route marked `@ExportRoute()` (a generated report),
// writes one `export` row (the person, the resource, the path and the query
// asked for, then the format of the file sent, from its Content-Type, and the
// row count the handler reports) committed with the request; an export that
// fails leaves no row, a refused one neither, and other routes write nothing.
//
// A route that answers itself (`@Res()`, a download) sends its response before
// TenantInterceptor commits, so its row becomes visible a moment after the
// response arrives: the spec waits for the rows (expectExportRows) instead of
// reading them once.

@Injectable()
class RefuseGuard implements CanActivate {
  canActivate() {
    return false;
  }
}

@Controller('probe-items')
class ExportProbeController {
  @Get('export')
  exportCsv(@Res() res: Response) {
    recordExportRows(res.req, 1);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('name\nProbe\n');
  }

  @Post(':id/export')
  exportDocument() {
    return { ok: true };
  }

  @ExportRoute()
  @Get(':id/report')
  report(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
    res.send(Buffer.from('%PDF-1.4 probe'));
  }

  @Get('list')
  list() {
    return { items: [] };
  }
}

@Controller('probe-broken')
class BrokenExportProbeController {
  @Get('export')
  exportFails(@Res() res: Response) {
    recordExportRows(res.req, 3);
    throw new BadRequestException('The export failed');
  }
}

@Controller('probe-refused')
class RefusedExportProbeController {
  @UseGuards(RefuseGuard)
  @Get('export')
  exportRefused() {
    return 'never';
  }
}

@Module({
  controllers: [ExportProbeController, BrokenExportProbeController, RefusedExportProbeController],
  providers: [ListContextsService, RefuseGuard],
})
class ExportProbeModule {}

async function exportRows(tenantId: string): Promise<any[]> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return manager.query(
      `SELECT table_name, action, record_id, user_id, source, before_json, after_json FROM audit_log
        WHERE table_name = 'export' ORDER BY created_at, id`,
    );
  });
}

// Polls until the expected number of rows is committed, or 2 s have passed, then compares.
async function expectExportRows(tenantId: string, expected: any[]): Promise<void> {
  const deadline = Date.now() + 2000;
  let rows = await exportRows(tenantId);
  while (rows.length < expected.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    rows = await exportRows(tenantId);
  }
  assert.deepEqual(rows, expected);
}

async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  const userId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Export events probe', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `export-events-${tenantId.slice(0, 8)}`],
  );
  // The request's person must exist in the tenant: data_access_apply refuses an unknown one.
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [role] = await manager.query(
      `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Export probe', 'Export probe') RETURNING id`,
      [tenantId],
    );
    await manager.query(
      `INSERT INTO users (id, tenant_id, email, role_id, status) VALUES ($1, $2, $3, $4, 'enabled')`,
      [userId, tenantId, `export-probe-${tenantId.slice(0, 8)}@example.test`, role.id],
    );
  });
  // A saved list context: the export row keeps its id, not the filters it holds.
  const { id: contextId } = await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return new ListContextsService().save(manager, tenantId, 'probe-items', { filters: { name: { filterType: 'text', type: 'contains', filter: 'Probe' } } });
  });
  const app = await NestFactory.create(ExportProbeModule, { logger: false });
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: tenantId, slug: 'export-probe', name: 'Export events probe' };
    req.user = { sub: userId };
    next();
  });
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const call = async (method: string, path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'user-agent': 'Export probe' } });
    await res.text();
    return res.status;
  };
  try {
    assert.equal(await call('GET', '/probe-items/export?scope=data&language=en'), 200);
    assert.equal(await call('GET', `/probe-items/export?ctx=${contextId}&format=XLSX`), 200);
    assert.equal(await call('POST', '/probe-items/DOC-12/export'), 201);
    assert.equal(await call('GET', '/probe-items/INC-3/report'), 200);
    assert.equal(await call('GET', '/probe-items/list'), 200);
    assert.equal(await call('GET', '/probe-broken/export'), 400);
    assert.equal(await call('GET', '/probe-refused/export'), 403);
    const row = (resource: string, path: string, format: string | undefined, query: Record<string, unknown>, rows?: number) => ({
      table_name: 'export',
      action: 'export',
      record_id: null,
      user_id: userId,
      source: 'user',
      before_json: null,
      after_json: {
        resource, path, query, ip: '127.0.0.1', user_agent: 'Export probe',
        ...(format === undefined ? {} : { format }), ...(rows === undefined ? {} : { rows }),
      },
    });
    // The CSV route answers itself (`@Res()`) and reports one row: the count is on its row, committed.
    // It ignores `?format=XLSX`: the row says csv, the type of what it sent. A route that returns a
    // value has no Content-Type when the handler finishes: no format.
    await expectExportRows(tenantId, [
      row('probe-items', '/probe-items/export', 'csv', { language: 'en', scope: 'data' }, 1),
      row('probe-items', '/probe-items/export', 'csv', { ctx: contextId, format: 'XLSX' }, 1),
      row('probe-items', '/probe-items/DOC-12/export', undefined, {}),
      row('probe-items/report', '/probe-items/INC-3/report', 'pdf', {}),
    ]);
  } finally {
    await app.close();
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tenantId]);
    }).catch(() => undefined);
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => undefined);
    await dataSource.destroy();
  }
  console.log('export-events-http.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
