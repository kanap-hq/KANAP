import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import {
  getManagedDocsSeedDefinitions,
  seedManagedDocsKnowledgeAssets,
} from '../integrated-document-seed';
import { INCIDENT_REVIEW_SLOT } from '../integrated-document.constants';
import { markdownToSearchText } from '../../common/markdown-search-text';
import {
  INCIDENT_REVIEW_SLOT_KEY,
  INCIDENT_REVIEW_SOURCE_ENTITY_TYPE,
} from '../incident-review-provisioning';

function testFoundationDefinitionsExcludeInterfaces() {
  const { folderDefinitions, slotDefinitions } = getManagedDocsSeedDefinitions({
    supportedSourceEntityTypes: ['requests', 'projects', 'applications', 'assets'],
  });

  assert.equal(folderDefinitions.some((definition) => definition.sourceEntityType === 'interfaces'), false);
  assert.equal(slotDefinitions.some((definition) => definition.sourceEntityType === 'interfaces'), false);
  assert.deepEqual(
    slotDefinitions.map((definition) => `${definition.sourceEntityType}:${definition.slotKey}`),
    ['applications:overview', 'requests:purpose', 'requests:risks_mitigations', 'projects:purpose'],
  );
}

function testInterfaceDefinitionsIncludeSpecificationSlot() {
  const { folderDefinitions, slotDefinitions } = getManagedDocsSeedDefinitions({
    supportedSourceEntityTypes: ['requests', 'projects', 'interfaces', 'applications', 'assets'],
  });

  assert.equal(folderDefinitions.some((definition) => definition.sourceEntityType === 'interfaces'), true);
  const slot = slotDefinitions.find(
    (definition) => definition.sourceEntityType === 'interfaces' && definition.slotKey === 'specification',
  );
  assert.ok(slot, 'interfaces:specification slot is seeded');
  // The library template stays English: a tenant has no language. The document of a
  // new interface takes the creator's language at provision time.
  assert.deepEqual(
    String(slot?.templateContentMarkdown || '').split('\n').filter((line) => line.startsWith('## ')),
    [
      '## Business Purpose & Overview',
      '## Business Objects',
      '## Use Cases',
      '## Business Rules',
      '## Impact of Failure',
      '## Transformations Overview',
      '## Error Handling',
      '## Data & Compliance Notes',
    ],
  );
}

function testOtherSlotsShipNoHeadingTemplate() {
  const { slotDefinitions } = getManagedDocsSeedDefinitions();
  for (const key of ['requests:purpose', 'requests:risks_mitigations', 'projects:purpose', 'applications:overview'] as const) {
    const [sourceEntityType, slotKey] = key.split(':');
    const slot = slotDefinitions.find(
      (definition) => definition.sourceEntityType === sourceEntityType && definition.slotKey === slotKey,
    );
    assert.ok(slot, key);
    assert.deepEqual(
      String(slot?.templateContentMarkdown || '').split('\n').filter((line) => line.startsWith('## ')),
      [],
      `${key} ships no heading template`,
    );
  }
}

function testDefaultDefinitionsRemainUnfiltered() {
  const { folderDefinitions, slotDefinitions } = getManagedDocsSeedDefinitions();

  assert.equal(folderDefinitions.some((definition) => definition.sourceEntityType === 'interfaces'), true);
  assert.equal(slotDefinitions.some((definition) => definition.sourceEntityType === 'interfaces'), true);
}

function testIncidentReviewSlotIsDeclared() {
  const { folderDefinitions, slotDefinitions } = getManagedDocsSeedDefinitions();

  const folder = folderDefinitions.find((definition) => definition.sourceEntityType === 'incidents');
  assert.equal(folder?.systemKey, 'integrated_incidents');
  assert.equal(folder?.name, 'Incidents');

  const slot = slotDefinitions.find(
    (definition) => definition.sourceEntityType === 'incidents' && definition.slotKey === 'review',
  );
  assert.equal(slot?.displayName, 'Incident review');
  assert.equal(slot?.templateTitle, 'Incident Review Template');
  assert.deepEqual(
    String(slot?.templateContentMarkdown || '')
      .split('\n')
      .filter((line) => line.startsWith('## ')),
    ['## Detailed description', '## Impact', '## Root cause', '## Corrective actions', '## Lessons learned'],
  );
}

function testExplicitDefinitionsWinOverTheSourceFilter() {
  const frozen = {
    folderDefinitions: [
      {
        sourceEntityType: 'incidents' as const,
        systemKey: 'integrated_incidents' as const,
        name: 'Incidents',
        displayOrder: 5,
      },
    ],
    slotDefinitions: [
      {
        sourceEntityType: 'incidents' as const,
        slotKey: 'review' as const,
        displayName: 'Incident review',
        folderSystemKey: 'integrated_incidents' as const,
        documentTypeName: 'Incident review',
        documentTypeSystemKey: 'integrated_incident_review',
        documentTypeDescription: 'frozen',
        templateTitle: 'Incident Review Template',
        templateSummary: 'frozen',
        templateContentMarkdown: '## Detailed description\n',
      },
    ],
  };

  // A migration passes its own frozen copy; the shared constants are not consulted.
  const definitions = getManagedDocsSeedDefinitions({
    supportedSourceEntityTypes: ['requests', 'projects'],
    definitions: frozen,
  });
  assert.equal(definitions, frozen);
}

const SLOT_QUERY = `
  SELECT s.template_document_id::text AS template_document_id,
         d.content_markdown,
         d.title
  FROM integrated_document_slot_settings s
  JOIN documents d ON d.id = s.template_document_id AND d.tenant_id = s.tenant_id
  WHERE s.tenant_id = app_current_tenant()
    AND s.source_entity_type = 'incidents'
    AND s.slot_key = 'review'
  LIMIT 1`;

/**
 * §9 of planning/incident-review-document.md: a tenant that adapts the seeded
 * template must keep its body and its slot reference across a re-seed.
 */
async function testReSeedKeepsACustomisedIncidentTemplate() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `seed-spec-${tenantId.slice(0, 8)}`, 'Integrated document seed spec'],
    );

    await seedManagedDocsKnowledgeAssets(runner, tenantId, {
      supportedSourceEntityTypes: ['incidents'],
    });

    const [before] = await runner.query(SLOT_QUERY);
    assert.ok(before?.template_document_id, 'incidents:review slot must reference a template document');
    assert.equal(before.title, 'Incident Review Template');
    assert.match(String(before.content_markdown), /## Lessons learned/);

    const customised = '## Constat\n\nModèle adapté par le tenant.\n';
    await runner.query(
      `UPDATE documents SET content_markdown = $2, updated_at = now() WHERE id = $1`,
      [before.template_document_id, customised],
    );

    await seedManagedDocsKnowledgeAssets(runner, tenantId, {
      supportedSourceEntityTypes: ['incidents'],
    });

    const [after] = await runner.query(SLOT_QUERY);
    assert.equal(after.template_document_id, before.template_document_id, 'template reference must not move');
    assert.equal(after.content_markdown, customised, 'customised template body must survive a re-seed');

    const duplicates = await runner.query(
      `SELECT COUNT(*)::int AS count
       FROM documents d
       JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
       WHERE d.tenant_id = app_current_tenant()
         AND dl.slug = 'templates'
         AND d.title = 'Incident Review Template'`,
    );
    assert.equal(duplicates[0].count, 1, 're-seed must not create a second template document');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const TEMPLATES_QUERY = `
  SELECT d.id, d.title, d.content_markdown, d.content_plain,
         d.search_vector @@ to_tsquery('kanap_en', 'lessons') AS body_indexed
  FROM documents d
  JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
  WHERE d.tenant_id = app_current_tenant()
    AND dl.slug = 'templates'
  ORDER BY d.title`;

/**
 * A seeded template is a published document of the Templates library: its body is indexed for the
 * search like any document's, so the seed derives `content_plain` from the Markdown it writes, on
 * insert and on the update of a template found by its title.
 */
async function testSeededTemplatesHaveAnIndexedBody() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `seed-plain-${tenantId.slice(0, 8)}`, 'Integrated document seed plain text spec'],
    );

    await seedManagedDocsKnowledgeAssets(runner, tenantId);

    const templates = await runner.query(TEMPLATES_QUERY);
    assert.ok(templates.length >= 2, 'the Templates library holds the seeded templates');
    for (const template of templates) {
      assert.equal(template.content_plain, markdownToSearchText(template.content_markdown), `${template.title}: plain text derived`);
    }
    const incident = templates.find((template: any) => template.title === 'Incident Review Template');
    assert.ok(incident, 'the incident review template is seeded');
    assert.notEqual(incident.content_plain, '');
    assert.equal(incident.body_indexed, true, 'a word of the body only is found by the search vector');

    // A template found again by its title (its slot no longer points at it) is rewritten with its plain text.
    await runner.query(`UPDATE documents SET content_plain = '' WHERE id = $1`, [incident.id]);
    await runner.query(
      `UPDATE integrated_document_slot_settings SET template_document_id = NULL
       WHERE tenant_id = app_current_tenant() AND template_document_id = $1`,
      [incident.id],
    );
    await seedManagedDocsKnowledgeAssets(runner, tenantId);
    const [reseeded] = (await runner.query(TEMPLATES_QUERY)).filter((template: any) => template.id === incident.id);
    assert.equal(reseeded.content_plain, markdownToSearchText(reseeded.content_markdown));
    assert.equal(reseeded.body_indexed, true);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/**
 * `incident-review-provisioning.ts` deliberately keeps its own copies of the
 * slot identity: the migration runs it on a frozen schema and must not change
 * behaviour because a shared constant moved. This asserts the two never drift,
 * which is what the shared constant would have bought without the coupling.
 */
function testProvisioningConstantsMatchTheSharedSlot() {
  assert.equal(INCIDENT_REVIEW_SOURCE_ENTITY_TYPE, INCIDENT_REVIEW_SLOT.sourceEntityType);
  assert.equal(INCIDENT_REVIEW_SLOT_KEY, INCIDENT_REVIEW_SLOT.slotKey);
}

async function run() {
  testFoundationDefinitionsExcludeInterfaces();
  testProvisioningConstantsMatchTheSharedSlot();
  testInterfaceDefinitionsIncludeSpecificationSlot();
  testOtherSlotsShipNoHeadingTemplate();
  testDefaultDefinitionsRemainUnfiltered();
  testIncidentReviewSlotIsDeclared();
  testExplicitDefinitionsWinOverTheSourceFilter();

  await dataSource.initialize();
  try {
    await testReSeedKeepsACustomisedIncidentTemplate();
    await testSeededTemplatesHaveAnIndexedBody();
  } finally {
    await dataSource.destroy();
  }
}

void run();
