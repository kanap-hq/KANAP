import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { DocumentActivity } from '../document-activity.entity';
import { DocumentApplication } from '../document-application.entity';
import { DocumentAttachment } from '../document-attachment.entity';
import { DocumentAsset } from '../document-asset.entity';
import { DocumentClassification } from '../document-classification.entity';
import { DocumentContributor } from '../document-contributor.entity';
import { DocumentEditLock } from '../document-edit-lock.entity';
import { DocumentFolder } from '../document-folder.entity';
import { DocumentLibrary } from '../document-library.entity';
import { DocumentProject } from '../document-project.entity';
import { DocumentReference } from '../document-reference.entity';
import { DocumentRequest } from '../document-request.entity';
import { DocumentTask } from '../document-task.entity';
import { DocumentType } from '../document-type.entity';
import { DocumentVersion } from '../document-version.entity';
import { Document } from '../document.entity';
import { IntegratedDocumentBinding } from '../integrated-document-binding.entity';
import { KnowledgeService } from '../knowledge.service';
import { bilingualDocumentTsQueryAnyTermSql, normalizeDocumentAnyTermQuery } from '../../common/document-search-tsquery';

async function setCurrentTenant(runner: any, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

function createKnowledgeService(manager: any) {
  return new KnowledgeService(
    manager.getRepository(Document),
    manager.getRepository(DocumentFolder),
    manager.getRepository(IntegratedDocumentBinding),
    manager.getRepository(DocumentLibrary),
    manager.getRepository(DocumentType),
    manager.getRepository(DocumentVersion),
    manager.getRepository(DocumentEditLock),
    manager.getRepository(DocumentAttachment),
    manager.getRepository(DocumentActivity),
    manager.getRepository(DocumentContributor),
    manager.getRepository(DocumentClassification),
    manager.getRepository(DocumentReference),
    manager.getRepository(DocumentApplication),
    manager.getRepository(DocumentAsset),
    manager.getRepository(DocumentProject),
    manager.getRepository(DocumentRequest),
    manager.getRepository(DocumentTask),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    dataSource,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

async function testKnowledgeSearchMatchesLinkTextThroughContentPlain() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const tenantId = randomUUID();
    const libraryId = randomUUID();
    const documentId = randomUUID();
    const staleDocumentId = randomUUID();
    const service = createKnowledgeService(runner.manager);

    await setCurrentTenant(runner, tenantId);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `search-spec-${tenantId.slice(0, 8)}`, 'Search Spec Tenant'],
    );
    await runner.query(
      `INSERT INTO document_libraries (
         id, tenant_id, name, slug, is_system, display_order, created_at, updated_at
       )
       VALUES ($1, $2, 'Knowledge Search Spec', 'knowledge-search-spec', false, 0, now(), now())`,
      [libraryId, tenantId],
    );
    // content_plain produced by markdownToSearchText keeps visible link text.
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, summary, content_markdown, content_plain,
         library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
       )
       VALUES (
         $1, $2, 42, 'Runbook Search Spec', 'Link text repro',
         $3, $4,
         $5, null, 'published', 1, 0, now(), now()
       )`,
      [
        documentId,
        tenantId,
        'Un paragraphe sur les [fleurs](https://example.com) dans un document.',
        'Un paragraphe sur les fleurs dans un document.',
        libraryId,
      ],
    );
    // Legacy row whose content_plain predates the converter fix and lost the
    // link text: the AI search path no longer scans content_markdown (perf),
    // but the workspace list path still matches it.
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, summary, content_markdown, content_plain,
         library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
       )
       VALUES (
         $1, $2, 43, 'Runbook Stale Plain Text', 'Markdown-only repro',
         $3, $4,
         $5, null, 'published', 1, 0, now(), now()
       )`,
      [
        staleDocumentId,
        tenantId,
        'Un paragraphe sur les [fleurs](https://example.com) dans un document.',
        'Un paragraphe sur les dans un document.',
        libraryId,
      ],
    );

    const searchResult = await service.search({ q: 'fleurs', limit: 10, offset: 0 }, { manager: runner.manager });
    assert.deepEqual(searchResult.items.map((item: any) => item.id), [documentId]);

    const listResult = await service.list({ q: 'fleurs', page: 1, limit: 10 }, { manager: runner.manager });
    assert.deepEqual(
      listResult.items.map((item: any) => item.id).sort(),
      [documentId, staleDocumentId].sort(),
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testKnowledgeSearchFallsBackToNormalizedSearchTerms() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const tenantId = randomUUID();
    const libraryId = randomUUID();
    const documentId = randomUUID();
    const service = createKnowledgeService(runner.manager);

    await setCurrentTenant(runner, tenantId);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `normalized-search-${tenantId.slice(0, 8)}`, 'Normalized Search Spec Tenant'],
    );
    await runner.query(
      `INSERT INTO document_libraries (
         id, tenant_id, name, slug, is_system, display_order, created_at, updated_at
       )
       VALUES ($1, $2, 'Normalized Search Spec', 'normalized-search-spec', false, 0, now(), now())`,
      [libraryId, tenantId],
    );
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, summary, content_markdown, content_plain,
         library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
       )
       VALUES (
         $1, $2, 165, 'Recette du Burnt Cheesecake', 'Dessert au cream cheese',
         $3, $4,
         $5, null, 'published', 1, 0, now(), now()
       )`,
      [
        documentId,
        tenantId,
        'Une recette avec 300 g de sucre et une surface caramélisée.',
        'Une recette avec 300 g de sucre et une surface caramélisée.',
        libraryId,
      ],
    );

    const result = await service.search({ q: 'plus sucré', limit: 10, offset: 0 }, { manager: runner.manager });
    assert.deepEqual(result.items.map((item: any) => item.id), [documentId]);
    // Found by one word of the query only: the item says so, so that no assistant cites it as a source.
    assert.equal(result.items[0].fallback, true);
    assert.equal(result.fallback, true);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

type SeededDocument = {
  title: string;
  summary?: string;
  contentPlain?: string;
  itemNumber?: number;
  status?: 'draft' | 'in_review' | 'published' | 'archived' | 'obsolete';
};

async function seedSearchFixture(runner: any, docs: SeededDocument[]): Promise<string[]> {
  const tenantId = randomUUID();
  const libraryId = randomUUID();

  await setCurrentTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `fts-spec-${tenantId.slice(0, 8)}`, 'FTS Spec Tenant'],
  );
  await runner.query(
    `INSERT INTO document_libraries (
       id, tenant_id, name, slug, is_system, display_order, created_at, updated_at
     )
     VALUES ($1, $2, 'Bilingual FTS Spec', $3, false, 0, now(), now())`,
    [libraryId, tenantId, `bilingual-fts-spec-${tenantId.slice(0, 8)}`],
  );

  const ids: string[] = [];
  for (const [index, doc] of docs.entries()) {
    const id = randomUUID();
    ids.push(id);
    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, summary, content_markdown, content_plain,
         library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, null, $8, 1, 0, now(), now())`,
      [
        id,
        tenantId,
        doc.itemNumber ?? 9000 + index,
        doc.title,
        doc.summary ?? '',
        doc.contentPlain ?? '',
        libraryId,
        doc.status ?? 'published',
      ],
    );
  }
  return ids;
}

async function withSearchFixture(
  docs: SeededDocument[],
  assertions: (search: (q: string) => Promise<any>, ids: string[]) => Promise<void>,
) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const service = createKnowledgeService(runner.manager);
    const ids = await seedSearchFixture(runner, docs);
    await assertions(
      (q: string) => service.search({ q, limit: 10, offset: 0 }, { manager: runner.manager }),
      ids,
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testKnowledgeSearchFoldsAccentsBothDirections() {
  await withSearchFixture(
    [
      { title: 'Gouvernance documentaire', contentPlain: 'Le référentiel des applications est maintenu ici.' },
      { title: 'Catalogue technique', contentPlain: 'Le referentiel sans accent est decrit dans cette page.' },
    ],
    async (search, [accentedDoc, unaccentedDoc]) => {
      const unaccentedQuery = await search('referentiel');
      assert.equal(unaccentedQuery.items.some((item: any) => item.id === accentedDoc), true);

      const accentedQuery = await search('référentiel');
      assert.equal(accentedQuery.items.some((item: any) => item.id === unaccentedDoc), true);
      assert.equal(accentedQuery.items.some((item: any) => item.id === accentedDoc), true);
    },
  );
}

async function testKnowledgeSearchStemsFrenchAndEnglish() {
  await withSearchFixture(
    [
      { title: 'Parc bureautique', contentPlain: 'Chaque imprimante du parc est inventoriée.' },
      { title: 'Operations guide', contentPlain: 'How to run the nightly batch.' },
    ],
    async (search, [frenchDoc, englishDoc]) => {
      const pluralQuery = await search('imprimantes');
      assert.equal(pluralQuery.items.some((item: any) => item.id === frenchDoc), true);

      const singularQuery = await search('imprimante');
      assert.equal(singularQuery.items.some((item: any) => item.id === frenchDoc), true);

      const englishQuery = await search('running');
      assert.equal(englishQuery.items.some((item: any) => item.id === englishDoc), true);
    },
  );
}

async function testKnowledgeSearchRanksTitleAboveContent() {
  await withSearchFixture(
    [
      { title: 'Notes diverses', contentPlain: 'Cette page mentionne la sauvegarde des serveurs.' },
      { title: 'Sauvegarde des serveurs', contentPlain: 'Procédure complète.' },
    ],
    async (search, [contentDoc, titleDoc]) => {
      const result = await search('sauvegarde');
      const orderedIds = result.items.map((item: any) => item.id);
      assert.equal(orderedIds.includes(titleDoc), true);
      assert.equal(orderedIds.includes(contentDoc), true);
      assert.equal(orderedIds.indexOf(titleDoc) < orderedIds.indexOf(contentDoc), true);
    },
  );
}

async function testKnowledgeSearchGeneratesAccentedSnippet() {
  await withSearchFixture(
    [
      {
        title: 'Gestion du parc',
        contentPlain: 'La maintenance du référentiel des imprimantes est planifiée chaque trimestre avec les équipes.',
      },
    ],
    async (search, [doc]) => {
      const result = await search('referentiel');
      const item = result.items.find((entry: any) => entry.id === doc);
      assert.ok(item, 'expected snippet document to match');
      assert.equal(String(item.snippet || '').includes('<b>référentiel</b>'), true);
    },
  );
}

async function testKnowledgeSearchStillMatchesItemReference() {
  await withSearchFixture(
    [{ title: 'Plan de reprise', contentPlain: 'Contenu du PRA.', itemNumber: 4242 }],
    async (search, [doc]) => {
      const result = await search('DOC-4242');
      assert.equal(result.items.some((item: any) => item.id === doc), true);
    },
  );
}

async function testKnowledgeSearchIlikeFallbackCatchesNonLexemeMatches() {
  await withSearchFixture(
    [{ title: 'Gouvernance', contentPlain: 'Le référentiel central est documenté ici.' }],
    async (search, [doc]) => {
      // "entiel" is not a lexeme websearch_to_tsquery can match — only the
      // ILIKE substring clauses can catch it.
      const result = await search('entiel');
      assert.equal(result.items.some((item: any) => item.id === doc), true);
    },
  );
}

async function testKnowledgeSearchHandlesStopWordOnlyQuery() {
  await withSearchFixture(
    [{ title: 'Budget des achats', contentPlain: 'Inventaire des contrats.' }],
    async (search, [doc]) => {
      // "des" maps to an empty tsquery in both configs; the ILIKE clauses
      // still substring-match without raising.
      const result = await search('des');
      assert.equal(result.items.some((item: any) => item.id === doc), true);
    },
  );
}

// Ticket 96 of fromage (12/11): no word of the ticket is in any document, and the substring fallback
// brought back every document containing "Paris", "Parma" or "spare" through the word "par".
async function testKnowledgeSearchFallbackIgnoresShortWordsAndWordParts() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const service = createKnowledgeService(runner.manager);
    const [doc] = await seedSearchFixture(runner, [
      { title: 'Label printer troubleshooting', contentPlain: 'Paris, Gouda and Parma each keep two spare label rolls.' },
    ]);
    const result = await service.search(
      { q: 'Panne Bourrage papier suspecté par le demandeur', limit: 10, offset: 0, matchMode: 'any' },
      { manager: runner.manager },
    );
    assert.equal(result.items.some((item: any) => item.id === doc), false, 'the word "par" does not bring back "Paris"');
    assert.equal(result.fallback, false);

    // A whole word of four letters or more still finds its document, marked as found by the fallback.
    const wordResult = await service.search({ q: 'Gouda rouleau', limit: 10, offset: 0 }, { manager: runner.manager });
    assert.deepEqual(wordResult.items.map((item: any) => item.id), [doc]);
    assert.equal(wordResult.items[0].fallback, true);
    assert.equal(wordResult.items[0].score, 0);

    // A part of a word inside a multi-word query no longer matches.
    const partResult = await service.search({ q: 'Goud rouleau', limit: 10, offset: 0 }, { manager: runner.manager });
    assert.equal(partResult.items.length, 0);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

// The whole-word fallback reads title, summary and body in one pass with one pattern (the review
// of 12/11 measured 24 regular expressions per row), and folds the words of the query as the
// columns are folded: "Straße" finds "Straße", "cœur" finds "cœur".
async function testKnowledgeSearchFallbackIsOnePassFoldedLikeTheColumns() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const statements: string[] = [];
    const manager = Object.create(runner.manager);
    manager.query = (sql: string, params?: unknown[]) => {
      statements.push(sql);
      return runner.manager.query(sql, params);
    };
    const service = createKnowledgeService(manager);
    const [street, heart] = await seedSearchFixture(runner, [
      { title: 'Lieferadresse', contentPlain: 'Die Straße des Lagers wurde umbenannt.' },
      { title: 'Notes', summary: 'Le cœur du réseau est au sous-sol.' },
    ]);
    const streetResult = await service.search({ q: 'Straße rouleau', limit: 10, offset: 0 }, { manager });
    assert.deepEqual(streetResult.items.map((item: any) => item.id), [street], 'Straße finds Straße');
    assert.equal(streetResult.items[0].fallback, true);
    const heartResult = await service.search({ q: 'cœur rouleau', limit: 10, offset: 0 }, { manager });
    assert.deepEqual(heartResult.items.map((item: any) => item.id), [heart], 'cœur finds cœur');
    // unaccent maps the modifier letter "ˆ" to "^": it is dropped and never reaches the pattern.
    const modifier = await service.search({ q: 'Straˆße rouleau', limit: 10, offset: 0 }, { manager });
    assert.deepEqual(modifier.items.map((item: any) => item.id), [street]);
    const fallbackSql = statements.filter((sql) => sql.includes('~*'));
    assert.ok(fallbackSql.length > 0, 'the fallback ran');
    for (const sql of fallbackSql) {
      assert.equal(sql.split('~*').length - 1, 1, `one regular expression per row: ${sql}`);
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testKnowledgeSearchMarksDirectMatchesAsNotFallback() {
  await withSearchFixture(
    [{ title: 'Sauvegarde des serveurs', contentPlain: 'Procédure complète.' }],
    async (search, [doc]) => {
      const result = await search('sauvegarde');
      const item = result.items.find((entry: any) => entry.id === doc);
      assert.ok(item);
      assert.equal(item.fallback, false);
      assert.equal(result.fallback, false);
    },
  );
}

const ALL_STATUSES = ['draft', 'in_review', 'published', 'archived', 'obsolete'] as const;

async function testKnowledgeSearchPublishedOnlyLeavesOtherStatesOut() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const service = createKnowledgeService(runner.manager);
    const ids = await seedSearchFixture(
      runner,
      ALL_STATUSES.map((status) => ({ title: `Zebra printer guide ${status}`, contentPlain: 'Clear the paper jam.', status })),
    );
    const byStatus = new Map(ALL_STATUSES.map((status, index) => [ids[index], status]));

    const everything = await service.search(
      { q: 'zebra printer', limit: 10, offset: 0, matchMode: 'any' },
      { manager: runner.manager },
    );
    assert.deepEqual(
      everything.items.map((item: any) => item.status).sort(),
      [...ALL_STATUSES].sort(),
      'without the option every state is returned, with its status',
    );

    const published = await service.search(
      { q: 'zebra printer', limit: 10, offset: 0, matchMode: 'any' },
      { manager: runner.manager, publishedOnly: true },
    );
    assert.deepEqual(published.items.map((item: any) => byStatus.get(item.id)), ['published']);
    assert.equal(published.total, 1);

    // The fallback query applies the same filter.
    const fallback = await service.search(
      { q: 'zzqq paper', limit: 10, offset: 0 },
      { manager: runner.manager, publishedOnly: true },
    );
    assert.deepEqual(fallback.items.map((item: any) => item.status), ['published']);
    assert.equal(fallback.items[0].fallback, true);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const LONG_BODY = [
  'Label Printer Troubleshooting. The warehouses and production sites use Zebra ZT411 printers for product and shipping labels.',
  'Each site keeps two spare label rolls per format in the IT cabinet, next to the ribbon stock and the cleaning pens.',
  'Ordering: rolls and ribbons are ordered every quarter through the purchasing portal, with the cost center of the site.',
  'Network: the printers take their address from DHCP, and the address is reserved in the console of the site router.',
  'Training: new operators follow a short session on loading media before they print production labels on their own.',
  'Paper jam: open the printhead, remove the jammed label, check the ribbon path, close the head and press feed twice.',
  'If the printer still shows a red light after a jam, power cycle it and run the calibration from the front panel.',
].join(' ');

async function testDocumentSearchPassagesReturnLongPlainFragments() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const service = createKnowledgeService(runner.manager);
    const [doc, draft] = await seedSearchFixture(runner, [
      { title: 'Label printer troubleshooting', contentPlain: LONG_BODY, itemNumber: 7101 },
      { title: 'Draft printer notes', contentPlain: LONG_BODY, itemNumber: 7102, status: 'draft' },
    ]);

    const hit = await service.getDocumentSearchPassages(doc, 'bourrage paper jam red light', { manager: runner.manager });
    assert.ok(hit);
    assert.equal(hit.ref, 'DOC-7101');
    assert.equal(hit.status, 'published');
    assert.equal(hit.matched, true);
    assert.ok(hit.passages.length >= 1);
    const joined = hit.passages.join(' ');
    assert.match(joined, /jam/i);
    assert.match(joined, /red light/);
    assert.equal(/<\/?b>/.test(joined), false, 'passages carry no highlight tags');
    assert.ok(hit.passages.every((passage) => passage.split(/\s+/).length >= 15), 'each passage is long');

    // By reference too, and nothing in the body matches: the start of the body.
    const lead = await service.getDocumentSearchPassages('DOC-7101', 'kubernetes ingress', { manager: runner.manager });
    assert.ok(lead);
    assert.equal(lead.matched, false);
    assert.equal(lead.passages.length, 1);
    assert.ok(LONG_BODY.startsWith(lead.passages[0].replace(/…$/, '')));
    assert.ok(lead.passages[0].length > 200);

    // Published only: a draft gives nothing.
    assert.equal(
      await service.getDocumentSearchPassages(draft, 'paper jam', { manager: runner.manager, publishedOnly: true }),
      null,
    );
    const draftHit = await service.getDocumentSearchPassages(draft, 'paper jam', { manager: runner.manager });
    assert.equal(draftHit?.status, 'draft');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function testAnyTermTsQueryDoesNotBroadenNegation() {
  const sql = bilingualDocumentTsQueryAnyTermSql('$1');
  assert.match(sql, /replace\(/);
  assert.match(sql, /'&', '\|'/);
  assert.match(sql, /LIKE '%!%'/);
}

function testAnyTermQueryNormalizationDropsWeakWords() {
  assert.equal(
    normalizeDocumentAnyTermQuery('pour faire plaisir à mes collègues. De préférence une recette du Sud, c\'est l\'été'),
    'plaisir collegues preference recette sud ete',
  );
  assert.equal(normalizeDocumentAnyTermQuery('des'), 'des');
}

async function testKnowledgeSearchAnyTermModeFindsStrongPartialMatch() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const service = createKnowledgeService(runner.manager);
    const [targetDoc, weakDoc, exactDecoy, unrelatedDoc] = await seedSearchFixture(runner, [
      {
        title: 'Administration SQL Server',
        summary: 'Activation du Query Store',
        contentPlain: '4. Activation du Query Store dans SQL Server. Ouvrir les propriétés de la base et activer Query Store.',
      },
      {
        title: 'New server inventory',
        summary: 'Server setup',
        contentPlain: 'Ajouter un nouveau serveur dans le parc.',
      },
      {
        title: 'Guide activer query store SQL Server',
        summary: 'Document minimal',
        contentPlain: 'Stub temporaire contenant tous les mots de la requête.',
      },
      {
        title: 'Plaid settings',
        summary: 'Agent workspace',
        contentPlain: 'Configuration des agents.',
      },
    ]);

    const anyResult = await service.search(
      { q: 'activer query store SQL Server guide', limit: 10, offset: 0, matchMode: 'any' },
      { manager: runner.manager },
    );
    const anyIds = anyResult.items.map((item: any) => item.id);
    assert.equal(anyIds.includes(targetDoc), true);
    assert.equal(anyIds.includes(weakDoc), true);
    assert.equal(anyIds.includes(unrelatedDoc), false);
    const targetScore = Number(anyResult.items.find((item: any) => item.id === targetDoc)?.score ?? 0);
    const weakScore = Number(anyResult.items.find((item: any) => item.id === weakDoc)?.score ?? 0);
    assert.equal(targetScore > weakScore, true);

    const andResult = await service.search(
      { q: 'activer query store SQL Server guide', limit: 10, offset: 0 },
      { manager: runner.manager },
    );
    const andIds = andResult.items.map((item: any) => item.id);
    assert.equal(andIds.includes(exactDecoy), true);
    assert.equal(andIds.includes(targetDoc), false);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function testLinkOptionsSearchesBeyondInitialPage() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const tenantId = randomUUID();
    const libraryId = randomUUID();
    const targetDocumentId = randomUUID();
    const service = createKnowledgeService(runner.manager);

    await setCurrentTenant(runner, tenantId);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `link-options-spec-${tenantId.slice(0, 8)}`, 'Link Options Spec Tenant'],
    );
    await runner.query(
      `INSERT INTO document_libraries (
         id, tenant_id, name, slug, is_system, display_order, created_at, updated_at
       )
       VALUES ($1, $2, 'Knowledge Link Options Spec', 'knowledge-link-options-spec', false, 0, now(), now())`,
      [libraryId, tenantId],
    );

    for (let index = 0; index < 8; index += 1) {
      await runner.query(
        `INSERT INTO documents (
           id, tenant_id, item_number, title, summary, content_markdown, content_plain,
           library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, '', '', '',
           $5, null, 'published', 1, 0, now(), now()
         )`,
        [
          randomUUID(),
          tenantId,
          100 + index,
          `Alpha Link Option ${index}`,
          libraryId,
        ],
      );
    }

    await runner.query(
      `INSERT INTO documents (
         id, tenant_id, item_number, title, summary, content_markdown, content_plain,
         library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
       )
       VALUES (
         $1, $2, 909, 'Zzz External Link Target', '', '', '',
         $3, null, 'published', 1, 0, now(), now()
       )`,
      [targetDocumentId, tenantId, libraryId],
    );

    const firstPage = await service.listLinkOptions({ page: 1, limit: 5 }, { manager: runner.manager });
    assert.equal(firstPage.items.some((item: any) => item.id === targetDocumentId), false);

    const refResult = await service.listLinkOptions({ q: 'DOC-909', page: 1, limit: 5 }, { manager: runner.manager });
    assert.deepEqual(refResult.items.map((item: any) => item.id), [targetDocumentId]);

    const titleResult = await service.listLinkOptions({ q: 'External Link Target', page: 1, limit: 5 }, { manager: runner.manager });
    assert.deepEqual(titleResult.items.map((item: any) => item.id), [targetDocumentId]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

// A managed document belongs to its record: no relation of it can be changed from Knowledge
// (`KNOWLEDGE_DOCUMENT_MANAGED_RELATIONS`), so the picker that links documents to a record does not
// offer it (QA lot 14: an incident offered DOC-55, an application's overview, and its own review).
async function testLinkOptionsLeaveOutManagedDocuments() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const tenantId = randomUUID();
    const libraryId = randomUUID();
    const standaloneId = randomUUID();
    const managedId = randomUUID();
    const service = createKnowledgeService(runner.manager);

    await setCurrentTenant(runner, tenantId);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `link-managed-spec-${tenantId.slice(0, 8)}`, 'Link Managed Spec Tenant'],
    );
    await runner.query(
      `INSERT INTO document_libraries (
         id, tenant_id, name, slug, is_system, display_order, created_at, updated_at
       )
       VALUES ($1, $2, 'Knowledge Link Managed Spec', 'knowledge-link-managed-spec', false, 0, now(), now())`,
      [libraryId, tenantId],
    );
    for (const [id, itemNumber, title] of [
      [standaloneId, 301, 'Managed Spec Standalone Guide'],
      [managedId, 302, 'Managed Spec Application Overview'],
    ] as const) {
      await runner.query(
        `INSERT INTO documents (
           id, tenant_id, item_number, title, summary, content_markdown, content_plain,
           library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, '', '', '', $5, null, 'published', 1, 0, now(), now())`,
        [id, tenantId, itemNumber, title, libraryId],
      );
    }
    await runner.query(
      `INSERT INTO integrated_document_bindings (
         tenant_id, source_entity_type, source_entity_id, slot_key, document_id, hidden_from_entity_knowledge
       )
       VALUES ($1, 'applications', $2, 'overview', $3, false)`,
      [tenantId, randomUUID(), managedId],
    );

    const options = await service.listLinkOptions({ q: 'Managed Spec', page: 1, limit: 50 }, { manager: runner.manager });
    assert.deepEqual(options.items.map((item: any) => item.id), [standaloneId]);
    assert.equal(options.total, 1);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  await dataSource.initialize();
  try {
    await testKnowledgeSearchMatchesLinkTextThroughContentPlain();
    await testKnowledgeSearchFallsBackToNormalizedSearchTerms();
    await testKnowledgeSearchFoldsAccentsBothDirections();
    await testKnowledgeSearchStemsFrenchAndEnglish();
    await testKnowledgeSearchRanksTitleAboveContent();
    await testKnowledgeSearchGeneratesAccentedSnippet();
    await testKnowledgeSearchStillMatchesItemReference();
    await testKnowledgeSearchIlikeFallbackCatchesNonLexemeMatches();
    await testKnowledgeSearchHandlesStopWordOnlyQuery();
    await testKnowledgeSearchFallbackIgnoresShortWordsAndWordParts();
    await testKnowledgeSearchFallbackIsOnePassFoldedLikeTheColumns();
    await testKnowledgeSearchMarksDirectMatchesAsNotFallback();
    await testKnowledgeSearchPublishedOnlyLeavesOtherStatesOut();
    await testDocumentSearchPassagesReturnLongPlainFragments();
    testAnyTermTsQueryDoesNotBroadenNegation();
    testAnyTermQueryNormalizationDropsWeakWords();
    await testKnowledgeSearchAnyTermModeFindsStrongPartialMatch();
    await testLinkOptionsSearchesBeyondInitialPage();
    await testLinkOptionsLeaveOutManagedDocuments();
  } finally {
    await dataSource.destroy();
  }
}

void run();
