import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';

// The `import` row of the screens' imports (lot I5 of 26.11.9), over HTTP against the database, with
// the whole application (AppModule with the HTTP wiring of main.ts), as the administrator of a
// fresh workspace. For imports of four different answers (the applications, a list of the shared
// import dialog; the suppliers, a reference list; the users, whose answer adds `processed`; the
// budget file, whose load has no `total`): the check writes no row, the load writes one, with its
// list, its counts and the name of the file sent, committed with the request; a refused file, and
// a request the route refuses, write none.

process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'import-events-http-spec';
delete process.env.EMAIL_OVERRIDE;

type Answer = { status: number; body: any };

function upload(port: number, host: string, token: string, path: string, file: { name: string; content: string } | null, fields: Record<string, string> = {}): Promise<Answer> {
  const boundary = `----import-events-${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: text/csv\r\n\r\n`, 'utf8'));
    parts.push(Buffer.from(file.content, 'utf8'));
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const payload = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path,
      headers: {
        Host: host,
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(payload.length),
      },
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
    req.write(payload);
    req.end();
  });
}

async function importRows(tenantId: string): Promise<any[]> {
  return inTenant(tenantId, (m) => m.query(
    `SELECT record_id, user_id, source, source_ref, before_json, after_json FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'import' AND action = 'import' ORDER BY created_at, id`,
    [tenantId],
  ));
}

const ok = (answer: Answer, what: string) => assert.ok(answer.status === 200 || answer.status === 201, `${what}: ${answer.status} ${JSON.stringify(answer.body)}`);

async function testEachLoadWritesOneImportRow() {
  const svc = buildServices();
  const { AppModule } = require('../../app.module');
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error'] });
  applyHttpMiddleware(app);
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  let tenant: ActivatedTenant | undefined;
  try {
    tenant = await createActivatedTenant(svc, { tag: 'imp-ev', orgName: 'Import events' });
    const t = tenant;
    const host = `${t.slug}.lvh.me`;
    const token = svc.auth.signToken({ id: t.ownerId, email: t.ownerEmail, tenant_id: t.tenantId }).access_token;
    const send = (path: string, file: { name: string; content: string } | null, fields?: Record<string, string>) => upload(port, host, token, path, file, fields);
    const expected: any[] = [];
    const row = (list: string, filename: string, counts: [number, number, number, number]) => ({
      record_id: null,
      user_id: t.ownerId,
      source: 'user',
      source_ref: null,
      before_json: null,
      after_json: { list, filename, rows: counts[0], inserted: counts[1], updated: counts[2], unchanged: counts[3] },
    });

    // The applications (the shared import dialog): the check writes nothing, the load one row.
    const applications = { name: 'Applications été.csv', content: 'name\nAlpha\nBeta\n' };
    const checked = await send('/applications/import?dryRun=true&language=en', applications);
    ok(checked, 'applications check');
    assert.equal(checked.body.ok, true, JSON.stringify(checked.body));
    assert.deepEqual(await importRows(t.tenantId), [], 'the check writes no import row');
    ok(await send('/applications/import?dryRun=false&language=en', applications), 'applications load');
    expected.push(row('applications', 'Applications été.csv', [2, 2, 0, 0]));
    assert.deepEqual(await importRows(t.tenantId), expected, 'one row for the load');
    // The same file again: nothing new, still one row for the load.
    ok(await send('/applications/import?dryRun=false&language=en', applications), 'applications load again');
    expected.push(row('applications', 'Applications été.csv', [2, 0, 0, 2]));
    assert.deepEqual(await importRows(t.tenantId), expected, 'one row per load, whatever it changed');

    // A refused file (a row without its name), and a request without a file: no row.
    const refused = await send('/applications/import?dryRun=false&language=en', { name: 'bad.csv', content: 'name,description\n,No name\n' });
    ok(refused, 'refused file');
    assert.equal(refused.body.ok, false, JSON.stringify(refused.body));
    assert.equal((await send('/suppliers/import?dryRun=false&language=en', null)).status, 400, 'no file');
    assert.deepEqual(await importRows(t.tenantId), expected, 'a refused import writes no row');

    // A reference list: the suppliers.
    const suppliers = { name: 'suppliers.csv', content: 'name\nAcme\nGlobex\nInitech\n' };
    ok(await send('/suppliers/import?dryRun=true&language=en', suppliers), 'suppliers check');
    assert.equal((await importRows(t.tenantId)).length, expected.length, 'the check writes no import row');
    const loaded = await send('/suppliers/import?dryRun=false&language=en', suppliers);
    ok(loaded, 'suppliers load');
    assert.equal(loaded.body.inserted, 3, JSON.stringify(loaded.body));
    expected.push(row('suppliers', 'suppliers.csv', [3, 3, 0, 0]));
    assert.deepEqual(await importRows(t.tenantId), expected);

    // The users: their answer adds `processed`; the list is the screen's own.
    const users = { name: 'users.csv', content: 'email,first_name,last_name,role,status\nada.import@example.test,Ada,Row,Contact,contact\n' };
    const usersChecked = await send('/users/import?dryRun=true&language=en', users);
    ok(usersChecked, 'users check');
    assert.equal(usersChecked.body.ok, true, JSON.stringify(usersChecked.body));
    assert.equal((await importRows(t.tenantId)).length, expected.length, 'the check writes no import row');
    ok(await send('/users/import?dryRun=false&language=en', users), 'users load');
    expected.push(row('users', 'users.csv', [1, 1, 0, 0]));
    assert.deepEqual(await importRows(t.tenantId), expected);

    // The budget file: its check is the preflight, its load has no `total`.
    // The first account of the starting chart, a CAPEX one: two CAPEX lines.
    const [account] = await inTenant(t.tenantId, (m) => m.query(`SELECT account_number FROM accounts WHERE tenant_id = $1 ORDER BY account_number LIMIT 1`, [t.tenantId]));
    assert.ok(account, 'the starting chart of accounts has an account');
    const budget = {
      name: 'budget.csv',
      content: `nature,name,company_name,account_number,currency\ncapex,Hosting,${t.companyName},${account.account_number},EUR\ncapex,Servers,${t.companyName},${account.account_number},EUR\n`,
    };
    const preflight = await send('/spend-items/budget-file/preflight?language=en', budget);
    ok(preflight, 'budget preflight');
    assert.equal(preflight.body.ok, true, JSON.stringify(preflight.body).slice(0, 2000));
    assert.equal((await importRows(t.tenantId)).length, expected.length, 'the preflight writes no import row');
    const budgetLoad = await send('/spend-items/budget-file/import?language=en', budget, { snapshot: JSON.stringify(preflight.body.snapshot) });
    ok(budgetLoad, 'budget load');
    assert.equal(budgetLoad.body.inserted, 2, JSON.stringify(budgetLoad.body));
    expected.push(row('budget_lines', 'budget.csv', [2, 2, 0, 0]));
    assert.deepEqual(await importRows(t.tenantId), expected, 'the budget file, under the list Plaid uses');
  } finally {
    await app.close();
    await cleanupTenants([tenant?.tenantId]);
  }
}

runSpecs('import-events-http', [testEachLoadWritesOneImportRow]).catch((error) => {
  console.error(error);
  process.exit(1);
});
