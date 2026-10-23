import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { applicationCsvConfig } from '../../applications/application-csv.config';
import { ApplicationsCrudService } from '../../applications/services/applications-crud.service';
import { InterfacesCrudService } from '../../interfaces/services/interfaces-crud.service';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { MARKDOWN_MAX_BYTES, MARKDOWN_TOO_LARGE } from '../../common/markdown-limits';
import { closeMarkdownWorkers, interfaceSpecificationMarkdown } from '../../common/markdown-worker';
import { interfaceSpecificationMarkdown as interfaceSpecificationMarkdownInProcess } from '../integrated-document-markdown';

// The texts integrated documents are built from (application description,
// interface specification fields) get the Markdown size limit when a write sets
// them; stored texts are kept. The interface specification is built in the
// Markdown workers; one they cannot build in time is shown as plain text.

const tenantId = randomUUID();
const applicationId = randomUUID();
const interfaceId = randomUUID();

/** Raised by the stubs once the write went past the size check. */
class PastTheSizeCheck extends Error {}

function fill(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

const TOO_LONG = fill('Une phrase de description. ', MARKDOWN_MAX_BYTES + 1);
const AT_LIMIT = fill('Une phrase de description. ', MARKDOWN_MAX_BYTES);

async function outcomeOf(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return 'ok';
  } catch (error) {
    if (error instanceof PastTheSizeCheck) return 'accepted';
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as { code?: string };
      return response.code ?? 'BAD_REQUEST';
    }
    throw error;
  }
}

function applicationsService(existing: Record<string, unknown>) {
  const manager: any = {
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
    // No other application holds the name (the name check reads `lower(btrim(name))`).
    query: async (sql: string) => (sql.includes('lower(btrim(name))') ? [] : [{ id: applicationId, tenant_id: tenantId }]),
    getRepository: () => ({
      findOne: async () => ({ ...existing }),
      create: () => { throw new PastTheSizeCheck(); },
      save: async () => { throw new PastTheSizeCheck(); },
    }),
  };
  const settings = {
    lockClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
    getSettings: async () => { throw new PastTheSizeCheck(); },
    resolveApplicationCategoryCode: async () => { throw new PastTheSizeCheck(); },
  };
  const service = new ApplicationsCrudService(
    { manager } as any,
    { log: async () => undefined } as any,
    null as any,
    settings as any,
    null as any,
  );
  return { service, manager };
}

async function testApplicationDescriptionIsLimitedOnWrite() {
  const stored = { id: applicationId, tenant_id: tenantId, name: 'Paie', description: TOO_LONG };
  const { service, manager } = applicationsService(stored);
  const opts = { manager };

  assert.equal(await outcomeOf(() => service.create({ name: 'Paie', description: TOO_LONG }, null, opts)), MARKDOWN_TOO_LARGE);
  assert.equal(await outcomeOf(() => service.create({ name: 'Paie', description: AT_LIMIT }, null, opts)), 'accepted');
  assert.equal(await outcomeOf(() => service.create({ name: 'Paie', description: null }, null, opts)), 'accepted');

  assert.equal(
    await outcomeOf(() => service.update(applicationId, { description: `${TOO_LONG}!` }, null, opts)),
    MARKDOWN_TOO_LARGE,
  );
  // A description stored before the limit is kept when a write leaves it as it is.
  assert.equal(await outcomeOf(() => service.update(applicationId, { description: TOO_LONG }, null, opts)), 'accepted');
  assert.equal(await outcomeOf(() => service.update(applicationId, { name: 'Paie v2' }, null, opts)), 'accepted');
  assert.equal(await outcomeOf(() => service.update(applicationId, { description: AT_LIMIT }, null, opts)), 'accepted');
}

async function testApplicationCsvDescriptionIsLimited() {
  const field = applicationCsvConfig.fields.find((candidate) => candidate.csvColumn === 'description');
  assert.ok(field?.importTransformFn, 'the description column has an import transform');
  const transform = field.importTransformFn as (value: string) => unknown;
  assert.equal(transform(AT_LIMIT), AT_LIMIT);
  assert.equal(await outcomeOf(async () => transform(TOO_LONG)), MARKDOWN_TOO_LARGE);
}

function interfacesService(existing: Record<string, unknown>) {
  const manager: any = {
    query: async () => [{ id: interfaceId }],
    getRepository: () => ({
      findOne: async () => ({ ...existing }),
      save: async () => { throw new PastTheSizeCheck(); },
    }),
  };
  const service = new InterfacesCrudService(
    { manager } as any,
    null as any,
    null as any,
    { manager } as any,
    null as any,
    null as any,
    { log: async () => undefined } as any,
    null as any,
    null as any,
    null as any,
  );
  return { service, manager };
}

async function testInterfaceSpecificationSourcesAreLimitedOnWrite() {
  const stored = {
    id: interfaceId,
    tenant_id: tenantId,
    name: 'Flux paie',
    business_purpose: 'Envoyer la paie.',
    overview_notes: TOO_LONG,
    business_objects: ['Salarié', 'Bulletin'],
  };
  const { service, manager } = interfacesService(stored);
  const opts = { manager };

  // Checked before anything is read or written.
  for (const field of ['business_purpose', 'overview_notes', 'functional_rules', 'security_controls_summary']) {
    assert.equal(
      await outcomeOf(() => service.create({ name: 'Flux', business_purpose: 'Envoyer.', [field]: TOO_LONG }, tenantId, null, opts)),
      MARKDOWN_TOO_LARGE,
      field,
    );
  }
  assert.equal(
    await outcomeOf(() => service.create({ name: 'Flux', business_purpose: 'Envoyer.', business_objects: [TOO_LONG] }, tenantId, null, opts)),
    MARKDOWN_TOO_LARGE,
  );

  assert.equal(await outcomeOf(() => service.update(interfaceId, { main_use_cases: TOO_LONG }, tenantId, null, opts)), MARKDOWN_TOO_LARGE);
  assert.equal(await outcomeOf(() => service.update(interfaceId, { overview_notes: `${TOO_LONG}!` }, tenantId, null, opts)), MARKDOWN_TOO_LARGE);
  // Stored texts are kept when a write leaves them as they are.
  assert.equal(await outcomeOf(() => service.update(interfaceId, { overview_notes: TOO_LONG }, tenantId, null, opts)), 'accepted');
  assert.equal(await outcomeOf(() => service.update(interfaceId, { business_purpose: 'Envoyer la paie chaque mois.' }, tenantId, null, opts)), 'accepted');
  assert.equal(await outcomeOf(() => service.update(interfaceId, { functional_rules: AT_LIMIT }, tenantId, null, opts)), 'accepted');
  // Texts that are not specification sources keep no limit here.
  assert.equal(await outcomeOf(() => service.update(interfaceId, { pii_description: TOO_LONG }, tenantId, null, opts)), 'accepted');
}

/** Runs `fn` while a 5 ms timer measures how long the main thread stays busy at once. */
async function withMainThreadProbe<T>(fn: () => Promise<T>): Promise<{ result: T; maxLagMs: number }> {
  let maxLagMs = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 5);
    last = now;
  }, 5);
  try {
    return { result: await fn(), maxLagMs };
  } finally {
    clearInterval(timer);
  }
}

function interfaceRow(overrides: Record<string, unknown>) {
  return {
    id: interfaceId,
    tenant_id: tenantId,
    item_number: null,
    name: 'Flux paie',
    reference_label: 'INT-1',
    business_purpose: 'Envoyer la paie **chaque mois**.',
    overview_notes: '<p>Notes <strong>HTML</strong></p>',
    impact_of_failure: null,
    business_objects: ['Salarié', 'Bulletin'],
    main_use_cases: '- Clôture\n- Rappel',
    functional_rules: null,
    core_transformations_summary: null,
    error_handling_summary: null,
    typical_data: null,
    audit_logging: null,
    security_controls_summary: null,
    ...overrides,
  };
}

async function testInterfaceSpecificationIsBuiltInTheWorkers() {
  // Normal texts: the same specification as built in process.
  const normal = interfaceRow({ functional_rules: fill('Règle _métier_ appliquée au flux. ', 20 * 1024) });
  assert.equal(await interfaceSpecificationMarkdown(normal as any), interfaceSpecificationMarkdownInProcess(normal as any));
  const withHtml = interfaceRow({ overview_notes: '<p>Flux <strong>quotidien</strong> vers la paie.</p>' });
  assert.equal(await interfaceSpecificationMarkdown(withHtml as any), interfaceSpecificationMarkdownInProcess(withHtml as any));

  // Stored texts the workers cannot read in time: the whole specification as plain text.
  const unparsable = fill('_a ', MARKDOWN_MAX_BYTES);
  const { result, maxLagMs } = await withMainThreadProbe(() => interfaceSpecificationMarkdown(
    interfaceRow({ overview_notes: unparsable, business_objects: ['Salarié', unparsable] }) as any,
  ));
  const markdown = String(result);
  assert.ok(maxLagMs < 50, `main thread busy ${maxLagMs.toFixed(0)} ms at once`);
  assert.ok(markdown.startsWith('```text\n## Business Purpose & Overview'), 'specification as plain text');
  assert.ok(markdown.includes(`### Overview notes\n\n${unparsable.trim()}`), 'overview notes kept');
  assert.ok(markdown.includes('### Business purpose\n\nEnvoyer la paie **chaque mois**.'), 'other texts kept');
  assert.ok(markdown.endsWith('\n```'), 'one closed code block');
}

async function run() {
  await testApplicationDescriptionIsLimitedOnWrite();
  await testApplicationCsvDescriptionIsLimited();
  await testInterfaceSpecificationSourcesAreLimitedOnWrite();
  await testInterfaceSpecificationIsBuiltInTheWorkers();
  await closeMarkdownWorkers();
}

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await closeMarkdownWorkers();
  process.exit(1);
});
