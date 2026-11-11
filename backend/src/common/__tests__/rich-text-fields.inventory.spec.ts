import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  loadDemoSet,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';
import { FxRateService } from '../../currency/fx-rate.service';
import { backendPath } from './backend-root';
import { MARKDOWN_HTML_NOT_ALLOWED } from '../markdown-limits';
import { RICH_TEXT_CHECK_HELPERS, RICH_TEXT_FIELDS } from '../rich-text-fields.inventory';

// The rich-text fields (rich-text-fields.inventory.ts), written through the whole application
// (AppModule with the HTTP wiring of main.ts) against the database. For each field and each
// route the spec can drive (the page's API, the CSV import):
// - a text with an HTML tag outside the accepted list is refused, the tag on its own line and
//   the tag in a table cell (400 `MARKDOWN_HTML_NOT_ALLOWED`, or the coded error of its CSV row);
// - a text of plain Markdown with the accepted tags is stored;
// - an update that repeats a stored text holding such a tag (a text saved before the rule)
//   is accepted, and the text stays as it is.
// The assistant writes through the same services (`routes: ['assistant']` in the inventory).
// A field of `NOT_DRIVEN` is covered by the first test only.

// The application starts without its outside services (AppModule is loaded by the test).
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'rich-text-fields-spec';
delete process.env.EMAIL_OVERRIDE;

const TAG = '<div class="note">A note</div>';
const OUTSIDE_A_TABLE = `Introduction.\n\n${TAG}\n\nEnd.`;
const IN_A_CELL = `Introduction.\n\n| Step | Detail |\n|---|---|\n| One | ${TAG} |`;
const ACCEPTED = 'A **plain** text with an <u>underlined</u> word.\n\n| Step | Detail |\n|---|---|\n| One | Two<br>lines |';
const STORED_BEFORE = `Earlier text.\n\n| Step | Detail |\n|---|---|\n| One | <details open>More</details> |\n\n${TAG}`;

/** Fields this spec does not write over HTTP, with the reason: the first test covers the file that checks them. */
const NOT_DRIVEN: Record<string, string> = {
  'document_workflow_participants.comment': 'the comment is read once a review is in progress, with its reviewers',
};

type Reply = { status: number; body: string; json: any };

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'migrations') sourceFiles(file, found);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(file);
    }
  }
  return found;
}

async function testTheInventoryNamesEveryFileThatChecksAWrite() {
  const root = backendPath('src');
  const call = /\b(?:normalizeMarkdownRichText|normalizeMarkdownWithSearchText|richTextCell)\(/;
  const checking = sourceFiles(root)
    .filter((file) => call.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
  const declared = [...new Set(RICH_TEXT_FIELDS.flatMap((field) => field.checkedIn.map((entry) => entry.file)))];
  const known = [...declared, ...RICH_TEXT_CHECK_HELPERS].sort();
  assert.deepEqual(
    checking.filter((file) => !known.includes(file)),
    [],
    'a file checks a rich-text write and is in no row of RICH_TEXT_FIELDS',
  );
  assert.deepEqual(
    known.filter((file) => !checking.includes(file)),
    [],
    'a file named by the inventory checks no rich-text write',
  );
  for (const field of RICH_TEXT_FIELDS) {
    assert.ok(field.checkedIn.length > 0 && field.checkedIn.every((entry) => entry.routes.length > 0), field.field);
  }
}

async function testEveryFieldRefusesOtherTagsThroughItsRoutes() {
  const svc = buildServices();
  const { AppModule } = require('../../app.module');
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error'] });
  applyHttpMiddleware(app);
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  app.get(FxRateService).onMissingRates(null);
  const port = (app.getHttpServer().address() as AddressInfo).port;

  let tenant: ActivatedTenant | undefined;
  const failures: string[] = [];
  /** `<field> by <api|csv>` for every probe that ran. */
  const probed = new Set<string>();
  try {
    tenant = await createActivatedTenant(svc, { tag: 'richtext', orgName: 'Rich text fields' });
    const tenantId = tenant.tenantId;
    const host = `${tenant.slug}.lvh.me`;
    const token = svc.auth.signToken({ id: tenant.ownerId, email: tenant.ownerEmail, tenant_id: tenantId }).access_token;
    await loadDemoSet(tenantId);

    const send = (method: string, target: string, payload?: Buffer, headers: Record<string, string> = {}) =>
      new Promise<Reply>((resolve, reject) => {
        const all: Record<string, string> = { Host: host, Authorization: `Bearer ${token}`, ...headers };
        if (payload) all['Content-Length'] = String(payload.length);
        const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: all }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            let json: any = null;
            try { json = JSON.parse(body); } catch { /* not JSON */ }
            resolve({ status: res.statusCode ?? 0, body, json });
          });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });
    const api = (method: string, target: string, body?: unknown, headers: Record<string, string> = {}) =>
      send(method, target, body === undefined ? undefined : Buffer.from(JSON.stringify(body)), {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      });
    const upload = (target: string, csv: string) => {
      const boundary = '----rich-text-fields-spec';
      const payload = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="import.csv"\r\n`
        + `Content-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`,
      );
      return send('POST', target, payload, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
    };
    const csvCell = (text: string) => `"${text.replace(/"/g, '""')}"`;
    const sql = <T = any>(query: string, params: unknown[] = []) =>
      inTenant(tenantId, (manager) => manager.query(query, params)) as Promise<T[]>;
    const show = (reply: Reply) => `${reply.status} ${reply.body.slice(0, 240)}`;
    const ok = (label: string, reply: Reply) => {
      if (reply.status < 200 || reply.status >= 300) throw new Error(`${label}: ${show(reply)}`);
      return reply.json;
    };

    /**
     * One route of a field. `write` sends a write holding the text (with another field of the
     * record when there is one). On an update, `store` puts a text in the field as an earlier
     * version stored it and `stored` reads the field back.
     */
    type Probe = {
      field: string;
      route: string;
      /** `csv` for an import of a file; the page's API otherwise. */
      kind?: 'api' | 'csv';
      /** The name the refusal gives the field, when the spec knows it. */
      named?: string;
      write: (text: string) => Promise<Reply>;
      store?: (text: string) => Promise<unknown>;
      stored?: () => Promise<string | null | undefined>;
    };
    const check = async (probe: Probe) => {
      probed.add(`${probe.field} by ${probe.kind ?? 'api'}`);
      const at = `${probe.field} by ${probe.route}`;
      try {
        const accepted = await probe.write(ACCEPTED);
        if (accepted.status < 200 || accepted.status >= 300) failures.push(`${at}: plain Markdown is stored, got ${show(accepted)}`);
        for (const [where, text] of [['on its own line', OUTSIDE_A_TABLE], ['in a table cell', IN_A_CELL]]) {
          const refused = await probe.write(text);
          if (refused.status !== 400 || refused.json?.code !== MARKDOWN_HTML_NOT_ALLOWED) {
            failures.push(`${at}: a tag ${where} is refused, got ${show(refused)}`);
          } else if (
            typeof refused.json?.field !== 'string'
            || (probe.named !== undefined && refused.json.field !== probe.named)
            || refused.json?.example !== TAG.slice(0, TAG.indexOf('>') + 1)
          ) {
            failures.push(`${at}: the refusal names the field and the tag, got ${show(refused)}`);
          }
        }
        if (!probe.store || !probe.stored) return;
        await probe.store(STORED_BEFORE);
        const repeated = await probe.write(STORED_BEFORE);
        if (repeated.status < 200 || repeated.status >= 300) {
          failures.push(`${at}: an update that repeats the stored text is accepted, got ${show(repeated)}`);
        } else if ((await probe.stored()) !== STORED_BEFORE) {
          failures.push(`${at}: the stored text stays as it is, got ${JSON.stringify(await probe.stored())}`);
        }
        const changed = await probe.write(`${STORED_BEFORE}\n\nOne more line.`);
        if (changed.status !== 400 || changed.json?.code !== MARKDOWN_HTML_NOT_ALLOWED) {
          failures.push(`${at}: a changed text is checked as a write, got ${show(changed)}`);
        }
      } catch (error) {
        failures.push(`${at}: ${(error as Error).message}`);
      }
    };
    /** A column of a table, stored and read back in SQL. */
    const column = (table: string, name: string, id: () => string) => ({
      store: (text: string) => sql(`UPDATE ${table} SET ${name} = $1 WHERE id = $2 AND tenant_id = $3`, [text, id(), tenantId]),
      stored: async () => (await sql(`SELECT ${name} AS value FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id(), tenantId]))[0]?.value,
    });
    /** The document bound to a record, stored and read back in SQL. */
    const boundDocument = (sourceType: string, slot: string, id: () => string) => {
      const where = `id = (SELECT document_id FROM integrated_document_bindings
        WHERE tenant_id = $1 AND source_entity_type = $2 AND source_entity_id = $3 AND slot_key = $4)`;
      return {
        store: (text: string) => sql(`UPDATE documents SET content_markdown = $5 WHERE ${where}`, [tenantId, sourceType, id(), slot, text]),
        stored: async () => (await sql(`SELECT content_markdown AS value FROM documents WHERE ${where}`, [tenantId, sourceType, id(), slot]))[0]?.value,
      };
    };
    /** A CSV dry run: the refusal of a row is the coded error of its column. */
    const csvReply = (reply: Reply, columnName: string): Reply => {
      if (reply.status < 200 || reply.status >= 300 || !reply.json) return reply;
      const errors: Array<{ code?: string; column?: string; message?: string }> = reply.json.errors ?? [];
      if (errors.length === 0) return reply;
      const refusal = errors.find((error) => error.code === MARKDOWN_HTML_NOT_ALLOWED && error.column === columnName);
      const example = /Example: (.*)$/.exec(refusal?.message ?? '')?.[1];
      return refusal
        ? { status: 400, body: reply.body, json: { code: refusal.code, field: columnName, example } }
        : { status: 422, body: reply.body, json: reply.json };
    };

    // --- Tasks -------------------------------------------------------------
    const task = ok('a task', await api('POST', '/tasks/standalone', { title: 'Rich text task', description: 'Plain.' }));
    let taskCount = 0;
    await check({
      field: 'tasks.description',
      route: 'POST /tasks/standalone',
      write: (text) => api('POST', '/tasks/standalone', { title: `Rich text task ${++taskCount}`, description: text }),
    });
    await check({
      field: 'tasks.description',
      route: 'PATCH /tasks/:id',
      write: (text) => api('PATCH', `/tasks/${task.id}`, { description: text, title: `Rich text task, edited ${++taskCount}` }),
      ...column('tasks', 'description', () => task.id),
    });
    await check({
      field: 'tasks.description',
      route: 'POST /tasks/import (CSV)',
      kind: 'csv',
      write: async (text) => csvReply(
        await upload('/tasks/import?dryRun=true&mode=enrich&operation=upsert', `id;title;description\n${task.id};Rich text task, imported;${csvCell(text)}\n`),
        'description',
      ),
      ...column('tasks', 'description', () => task.id),
    });

    // --- Comments, decisions, status updates --------------------------------
    const comment = ok('a task comment', await api('POST', `/tasks/${task.id}/activities`, { type: 'comment', content: 'Plain.' }));
    await check({
      field: 'portfolio_activities.content',
      route: 'POST /tasks/:id/activities',
      write: (text) => api('POST', `/tasks/${task.id}/activities`, { type: 'comment', content: text }),
    });
    await check({
      field: 'portfolio_activities.content',
      route: 'PATCH /tasks/:id/activities/:activityId',
      write: (text) => api('PATCH', `/tasks/${task.id}/activities/${comment.id}`, { content: text }),
      ...column('portfolio_activities', 'content', () => comment.id),
    });

    // --- Requests ----------------------------------------------------------
    const request = ok('a request', await api('POST', '/portfolio/requests', { name: 'Rich text request', purpose: 'Plain.' }));
    let requestCount = 0;
    for (const name of ['purpose', 'risks', 'current_situation', 'expected_benefits']) {
      await check({
        field: 'portfolio_requests.current_situation, expected_benefits, purpose, risks',
        route: `POST /portfolio/requests (${name})`,
        write: (text) => api('POST', '/portfolio/requests', { name: `Rich text request ${++requestCount}`, [name]: text }),
      });
    }
    ok('the risks of the request', await api('PATCH', `/portfolio/requests/${request.id}`, { risks: 'Plain.' }));
    for (const [name, storage] of [
      ['purpose', boundDocument('requests', 'purpose', () => request.id)],
      ['risks', boundDocument('requests', 'risks_mitigations', () => request.id)],
      ['current_situation', column('portfolio_requests', 'current_situation', () => request.id)],
      ['expected_benefits', column('portfolio_requests', 'expected_benefits', () => request.id)],
    ] as const) {
      await check({
        field: 'portfolio_requests.current_situation, expected_benefits, purpose, risks',
        route: `PATCH /portfolio/requests/:id (${name})`,
        write: (text) => api('PATCH', `/portfolio/requests/${request.id}`, { [name]: text, name: `Rich text request, edited ${++requestCount}` }),
        ...storage,
      });
      await check({
        field: 'portfolio_requests.current_situation, expected_benefits, purpose, risks',
        route: `POST /portfolio/requests/import (CSV, ${name})`,
        kind: 'csv',
        named: name,
        write: async (text) => csvReply(
          await upload(
            '/portfolio/requests/import?dryRun=true&mode=enrich&operation=upsert',
            `id;name;${name}\n${request.id};Rich text request, imported ${++requestCount};${csvCell(text)}\n`,
          ),
          name,
        ),
        ...storage,
      });
    }
    const requestComment = ok('a request comment', await api('POST', `/portfolio/requests/${request.id}/comments`, { content: 'Plain.' }));
    await check({
      field: 'portfolio_activities.content',
      route: 'POST /portfolio/requests/:id/comments',
      write: (text) => api('POST', `/portfolio/requests/${request.id}/comments`, { content: text }),
    });
    await check({
      field: 'portfolio_activities.content',
      route: 'PATCH /portfolio/requests/:id/comments/:activityId',
      write: (text) => api('PATCH', `/portfolio/requests/${request.id}/comments/${requestComment.id}`, { content: text }),
      ...column('portfolio_activities', 'content', () => requestComment.id),
    });

    // The purpose of the request, edited as its bound document.
    const purposePath = `/portfolio/requests/${request.id}/integrated-documents/purpose`;
    const purposeDocument = boundDocument('requests', 'purpose', () => request.id);
    const purposeLock = ok('the lock of the purpose', await api('POST', `${purposePath}/locks`, {}));
    const purposeRevision = async () => Number(
      (await sql(`SELECT revision FROM documents WHERE id = (SELECT document_id FROM integrated_document_bindings
        WHERE tenant_id = $1 AND source_entity_type = 'requests' AND source_entity_id = $2 AND slot_key = 'purpose')`, [tenantId, request.id]))[0]?.revision,
    );
    await check({
      field: 'documents:integrated',
      route: 'PATCH /portfolio/requests/:id/integrated-documents/purpose',
      write: async (text) => api('PATCH', purposePath, { content_markdown: text, revision: await purposeRevision() }, {
        'x-lock-token': String(purposeLock.lock_token ?? purposeLock.token ?? purposeLock.lock?.lock_token ?? ''),
      }),
      ...purposeDocument,
    });

    // --- Projects ----------------------------------------------------------
    const project = ok('a project', await api('POST', '/portfolio/projects', { name: 'Rich text project', origin: 'fast_track', purpose: 'Plain.' }));
    let projectCount = 0;
    await check({
      field: 'portfolio_projects.purpose',
      route: 'POST /portfolio/projects',
      write: (text) => api('POST', '/portfolio/projects', { name: `Rich text project ${++projectCount}`, origin: 'fast_track', purpose: text }),
    });
    await check({
      field: 'portfolio_projects.purpose',
      route: 'PATCH /portfolio/projects/:id',
      write: (text) => api('PATCH', `/portfolio/projects/${project.id}`, { purpose: text, name: `Rich text project, edited ${++projectCount}` }),
      ...boundDocument('projects', 'purpose', () => project.id),
    });
    await check({
      field: 'portfolio_projects.purpose',
      route: 'POST /portfolio/projects/import (CSV)',
      kind: 'csv',
      write: async (text) => csvReply(
        await upload(
          '/portfolio/projects/import?dryRun=true&mode=enrich&operation=upsert',
          `id;name;purpose\n${project.id};Rich text project, imported ${++projectCount};${csvCell(text)}\n`,
        ),
        'purpose',
      ),
      ...boundDocument('projects', 'purpose', () => project.id),
    });
    const projectComment = ok('a project comment', await api('POST', `/portfolio/projects/${project.id}/comments`, { content: 'Plain.' }));
    await check({
      field: 'portfolio_activities.content',
      route: 'POST /portfolio/projects/:id/comments',
      write: (text) => api('POST', `/portfolio/projects/${project.id}/comments`, { content: text }),
    });
    await check({
      field: 'portfolio_activities.content',
      route: 'PATCH /portfolio/projects/:id/comments/:activityId',
      write: (text) => api('PATCH', `/portfolio/projects/${project.id}/comments/${projectComment.id}`, { content: text }),
      ...column('portfolio_activities', 'content', () => projectComment.id),
    });

    // --- Incidents (the review, a bound document) -----------------------------
    const incident = ok('an incident', await api('POST', '/incidents', { title: 'Rich text incident', severity: 'minor' }));
    let incidentCount = 0;
    await check({
      field: 'documents:integrated',
      route: 'POST /incidents/import (CSV)',
      kind: 'csv',
      named: 'review',
      write: async (text) => csvReply(
        await upload(
          '/incidents/import?dryRun=true&mode=enrich&operation=upsert',
          `ref;title;severity;review\nINC-${incident.item_number};Rich text incident, imported ${++incidentCount};minor;${csvCell(text)}\n`,
        ),
        'review',
      ),
      ...boundDocument('incidents', 'review', () => incident.id),
    });

    // --- Knowledge documents and their comments -----------------------------
    const [sample] = await sql<{ id: string; library_id: string; folder_id: string | null; document_type_id: string | null }>(
      `SELECT d.id, d.library_id, d.folder_id, d.document_type_id FROM documents d
       WHERE d.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM integrated_document_bindings b WHERE b.document_id = d.id)
       ORDER BY d.created_at LIMIT 1`, [tenantId]);
    assert.ok(sample, 'the sample data holds a document');
    let documentCount = 0;
    const newDocument = (text: string) => api('POST', '/knowledge', {
      title: `Rich text document ${++documentCount}`,
      content_markdown: text,
      library_id: sample.library_id,
      folder_id: sample.folder_id,
      document_type_id: sample.document_type_id,
    });
    const document = ok('a document', await newDocument('Plain.'));
    await check({ field: 'documents.content_markdown', route: 'POST /knowledge', write: newDocument });
    const documentLock = ok('the lock of the document', await api('POST', `/knowledge/${document.id}/locks`, {}));
    await check({
      field: 'documents.content_markdown',
      route: 'PATCH /knowledge/:id',
      write: async (text) => api('PATCH', `/knowledge/${document.id}`, {
        content_markdown: text,
        summary: `Summary ${++documentCount}`,
        revision: Number((await sql(`SELECT revision FROM documents WHERE id = $1 AND tenant_id = $2`, [document.id, tenantId]))[0]?.revision),
      }, { 'x-lock-token': String(documentLock.lock_token ?? documentLock.token ?? documentLock.lock?.lock_token ?? '') }),
      ...column('documents', 'content_markdown', () => document.id),
    });
    const documentComment = ok('a document comment', await api('POST', `/knowledge/${document.id}/activities`, { content: 'Plain.' }));
    await check({
      field: 'document_activities.content',
      route: 'POST /knowledge/:id/activities',
      write: (text) => api('POST', `/knowledge/${document.id}/activities`, { content: text }),
    });
    await check({
      field: 'document_activities.content',
      route: 'PATCH /knowledge/:id/activities/:activityId',
      write: (text) => api('PATCH', `/knowledge/${document.id}/activities/${documentComment.id}`, { content: text }),
      ...column('document_activities', 'content', () => documentComment.id),
    });
    // --- Applications ------------------------------------------------------
    let applicationCount = 0;
    const application = ok('an application', await api('POST', '/applications', { name: 'Rich text application', description: 'Plain.' }));
    await check({
      field: 'applications.description',
      route: 'POST /applications',
      write: (text) => api('POST', '/applications', { name: `Rich text application ${++applicationCount}`, description: text }),
    });
    await check({
      field: 'applications.description',
      route: 'PATCH /applications/:id',
      write: (text) => api('PATCH', `/applications/${application.id}`, { description: text, version: `1.${++applicationCount}` }),
      ...column('applications', 'description', () => application.id),
    });
    await check({
      field: 'applications.description',
      route: 'POST /applications/import (CSV)',
      kind: 'csv',
      write: async (text) => csvReply(
        await upload('/applications/import?dryRun=true&mode=enrich&operation=upsert', `id;name;description\n${application.id};Rich text application;${csvCell(text)}\n`),
        'description',
      ),
      ...column('applications', 'description', () => application.id),
    });

    // --- Interfaces (the texts of the specification) -------------------------
    const [iface] = await sql<{ id: string }>(`SELECT id FROM interfaces WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    assert.ok(iface, 'the sample data holds an interface');
    for (const name of ['business_purpose', 'overview_notes', 'impact_of_failure', 'typical_data']) {
      await check({
        field: 'interfaces.business_purpose, overview_notes and the other specification texts',
        route: `PATCH /interfaces/:id (${name})`,
        write: (text) => api('PATCH', `/interfaces/${iface.id}`, { [name]: text }),
        ...column('interfaces', name, () => iface.id),
      });
    }

    // --- Contracts ---------------------------------------------------------
    const [contract] = await sql<{ id: string; name: string; company_id: string; supplier_id: string; company: string; supplier: string }>(
      `SELECT c.id, c.name, c.company_id, c.supplier_id, co.name AS company, s.name AS supplier
       FROM contracts c JOIN companies co ON co.id = c.company_id JOIN suppliers s ON s.id = c.supplier_id
       WHERE c.tenant_id = $1 LIMIT 1`, [tenantId]);
    assert.ok(contract, 'the sample data holds a contract');
    let contractCount = 0;
    await check({
      field: 'contracts.notes',
      route: 'POST /contracts',
      write: (text) => api('POST', '/contracts', {
        name: `Rich text contract ${++contractCount}`, company_id: contract.company_id, supplier_id: contract.supplier_id, start_date: '2026-01-01', notes: text,
      }),
    });
    await check({
      field: 'contracts.notes',
      route: 'PATCH /contracts/:id',
      write: (text) => api('PATCH', `/contracts/${contract.id}`, { notes: text, notice_period_months: 1 + (++contractCount % 6) }),
      ...column('contracts', 'notes', () => contract.id),
    });
    await check({
      field: 'contracts.notes',
      route: 'POST /contracts/import (CSV)',
      kind: 'csv',
      write: async (text) => csvReply(
        await upload('/contracts/import?dryRun=true', [
          'name;company_name;supplier_name;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes',
          `${contract.name};${contract.company};${contract.supplier};2026-01-01;${12 + (++contractCount % 12)};yes;1;1000;EUR;annual;enabled;;${csvCell(text)}`,
        ].join('\n') + '\n'),
        'notes',
      ),
      ...column('contracts', 'notes', () => contract.id),
    });

    // --- Locations, assets -------------------------------------------------
    const settings = ok('the IT settings', await api('GET', '/it-ops/settings'));
    const onPrem = (settings.hostingTypes ?? []).find((type: any) => type.category === 'on_prem');
    let placeCount = 0;
    const newLocation = (text: string) => api('POST', '/locations', {
      name: `Rich text location ${++placeCount}`,
      hosting_type: onPrem?.code,
      operating_company_id: contract.company_id,
      additional_info: text,
    });
    const location = ok('a location', await newLocation('Plain.'));
    await check({ field: 'locations.additional_info', route: 'POST /locations', write: newLocation });
    await check({
      field: 'locations.additional_info',
      route: 'PATCH /locations/:id',
      write: (text) => api('PATCH', `/locations/${location.id}`, { additional_info: text, city: `City ${++placeCount}` }),
      ...column('locations', 'additional_info', () => location.id),
    });
    const newAsset = (text: string) => api('POST', '/assets', {
      name: `rich-text-asset-${++placeCount}`,
      environment: 'prod',
      kind: settings.serverKinds?.[0]?.code,
      provider: settings.serverProviders?.[0]?.code,
      location_id: location.id,
      notes: text,
    });
    const asset = ok('an asset', await newAsset('Plain.'));
    await check({ field: 'assets.notes', route: 'POST /assets', write: newAsset });
    await check({
      field: 'assets.notes',
      route: 'PATCH /assets/:id',
      write: (text) => api('PATCH', `/assets/${asset.id}`, { notes: text, hostname: `host-${++placeCount}` }),
      ...column('assets', 'notes', () => asset.id),
    });
    const [{ location_reference: locationReference }] = await sql<{ location_reference: string }>(
      `SELECT location_reference FROM locations WHERE id = $1 AND tenant_id = $2`, [location.id, tenantId]);
    await check({
      field: 'assets.notes',
      route: 'POST /assets/import (CSV)',
      kind: 'csv',
      write: async (text) => csvReply(
        await upload(
          '/assets/import?dryRun=true&mode=enrich&operation=upsert',
          `id;name;kind;environment;location_reference;notes\n${asset.id};${asset.name};${asset.kind};${asset.environment};${locationReference};${csvCell(text)}\n`,
        ),
        'notes',
      ),
      ...column('assets', 'notes', () => asset.id),
    });

    // --- Connections -------------------------------------------------------
    const [connection] = await sql<{ id: string }>(`SELECT id FROM connections WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    assert.ok(connection, 'the sample data holds a connection');
    await check({
      field: 'connections.description',
      route: 'PATCH /connections/:id',
      write: (text) => api('PATCH', `/connections/${connection.id}`, { description: text }),
      ...column('connections', 'description', () => connection.id),
    });
  } finally {
    await app.close();
    await cleanupTenants([tenant?.tenantId]);
  }

  assert.deepEqual(failures, [], `every rich-text field follows the rule through its routes:\n  ${failures.join('\n  ')}`);
  // Every route the inventory declares for a field, among those this spec can drive, is played.
  const declared = RICH_TEXT_FIELDS
    .filter((field) => !(field.field in NOT_DRIVEN))
    .flatMap((field) => [...new Set(field.checkedIn.flatMap((entry) => entry.routes))]
      .filter((route) => route === 'api' || route === 'csv')
      .map((route) => `${field.field} by ${route}`));
  assert.deepEqual(
    declared.filter((route) => !probed.has(route)),
    [],
    'a route the inventory declares for a field is played by no probe of this spec',
  );
  assert.deepEqual(
    [...probed].filter((route) => !declared.includes(route)),
    [],
    'a probe of this spec plays a route the inventory does not declare',
  );
}

runSpecs('rich-text-fields.inventory.spec', [
  testTheInventoryNamesEveryFileThatChecksAWrite,
  testEveryFieldRefusesOtherTagsThroughItsRoutes,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
