import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

/**
 * The budget file's import row says the same through Kad as on the screen (pass D of lot I5): the
 * same two files loaded on the screen in one workspace and through Kad's cards in another, the
 * second one updating the lines its rows look like (one unchanged, one updated, one new). The two
 * rows hold the same `after`, file name included; only the source and `source_ref` differ.
 */
async function testKadWritesTheScreensBudgetFileRow() {
  const svc = buildServices();
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../../ai/ai-mutation-preview.service');
  const { AiPolicyService } = require('../../ai/ai-policy.service');
  const { AiAttachmentService } = require('../../ai/ai-attachment.service');
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error'] });
  applyHttpMiddleware(app);
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  // The AI surface checks and the attachment storage are not under test: stubbed.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const files = new Map<string, { name: string; buffer: Buffer }>();
  const attachments = app.get(AiAttachmentService);
  attachments.assertAndLoadAttachments = async (ids: string[]) => ids.map((id) => ({ id, kind: 'table', original_filename: files.get(id)!.name }));
  attachments.loadAttachmentBuffer = async (id: string) => ({ attachment: { id }, buffer: files.get(id)!.buffer });
  const previews = app.get(AiMutationPreviewService);
  const tenants: Array<string | undefined> = [];
  try {
    const screen = await createActivatedTenant(svc, { tag: 'imp-ev-s', orgName: 'Import events' });
    tenants.push(screen.tenantId);
    const kad = await createActivatedTenant(svc, { tag: 'imp-ev-k', orgName: 'Import events' });
    tenants.push(kad.tenantId);
    const budgetFiles = async (t: ActivatedTenant) => {
      const [account] = await inTenant(t.tenantId, (m) => m.query(`SELECT account_number FROM accounts WHERE tenant_id = $1 ORDER BY account_number LIMIT 1`, [t.tenantId]));
      const row = (name: string, description: string) => `capex,${name},${description},${t.companyName},${account.account_number},EUR`;
      const header = 'nature,name,description,company_name,account_number,currency';
      return [
        { name: 'Budget été.csv', content: [header, row('Hosting', 'Racks'), row('Servers', 'Blades')].join('\n') + '\n' },
        // Hosting the same, Servers described anew, Network new.
        { name: 'Budget été.csv', content: [header, row('Hosting', 'Racks'), row('Servers', 'Blades and disks'), row('Network', 'Switches')].join('\n') + '\n' },
      ];
    };
    const updateAll = [{ kind: 'lookalikes', action: 'update' }];

    // The screen: the preflight, then the load with its snapshot, the second file updating the lines its rows look like.
    const host = `${screen.slug}.lvh.me`;
    const token = svc.auth.signToken({ id: screen.ownerId, email: screen.ownerEmail, tenant_id: screen.tenantId }).access_token;
    for (const [index, file] of (await budgetFiles(screen)).entries()) {
      const fields: Record<string, string> = index === 0 ? {} : { choices: JSON.stringify(updateAll) };
      const preflight = await upload(port, host, token, '/spend-items/budget-file/preflight?language=en', file, fields);
      ok(preflight, `screen preflight ${index + 1}`);
      assert.equal(preflight.body.ok, true, JSON.stringify(preflight.body).slice(0, 2000));
      const load = await upload(port, host, token, '/spend-items/budget-file/import?language=en', file, { ...fields, snapshot: JSON.stringify(preflight.body.snapshot) });
      ok(load, `screen load ${index + 1}`);
    }

    // Kad: the same files attached to a conversation, each card checked and approved.
    const conversationId = randomUUID();
    await inTenant(kad.tenantId, (m) => m.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'Import events', 'custom', 'import-model', 'custom', now(), now())`,
      [conversationId, kad.tenantId, kad.ownerId],
    ));
    const columns = ['nature', 'name', 'description', 'company_name', 'account_number', 'currency']
      .map((column, index) => ({ column, source: index + 1, confidence: 'high' }));
    const cards: string[] = [];
    for (const [index, file] of (await budgetFiles(kad)).entries()) {
      await inTenant(kad.tenantId, async (manager) => {
        const ctx = { tenantId: kad.tenantId, userId: kad.ownerId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager, conversationId };
        const attachmentId = randomUUID();
        files.set(attachmentId, { name: file.name, buffer: Buffer.from(file.content, 'utf8') });
        let card = await previews.createPreview(ctx, 'prepare_import_mapping', { attachment_id: attachmentId, entity_type: 'budget_lines', columns });
        if (index > 0) card = { ...card, ...(await previews.replaceImportChoices(ctx, card.preview_id, updateAll)) };
        assert.equal(card.import_mapping.validation.ok, true, `Kad check ${index + 1}: ${JSON.stringify(card.import_mapping.validation.issues)}`);
        const done = await previews.executePreview(ctx, card.preview_id);
        assert.equal(done.status, 'executed', `Kad load ${index + 1}: ${done.error_message ?? ''}`);
        cards.push(card.preview_id);
      });
    }

    const onScreen = await importRows(screen.tenantId);
    const byKad = await importRows(kad.tenantId);
    assert.deepEqual(onScreen.map((row) => row.after_json), [
      { list: 'budget_lines', filename: 'Budget été.csv', rows: 2, inserted: 2, updated: 0, unchanged: 0 },
      { list: 'budget_lines', filename: 'Budget été.csv', rows: 3, inserted: 1, updated: 1, unchanged: 1 },
    ], 'the screen: one unchanged, one updated, one new');
    assert.deepEqual(byKad.map((row) => row.after_json), onScreen.map((row) => row.after_json), 'Kad writes the counts the screen writes');
    assert.deepEqual(onScreen.map((row) => [row.source, row.source_ref]), [['user', null], ['user', null]]);
    assert.deepEqual(byKad.map((row) => [row.source, row.source_ref]), cards.map((id) => ['ai_chat', id]));
  } finally {
    await app.close();
    await cleanupTenants(tenants);
  }
}

runSpecs('import-events-http', [testEachLoadWritesOneImportRow, testKadWritesTheScreensBudgetFileRow]).catch((error) => {
  console.error(error);
  process.exit(1);
});
