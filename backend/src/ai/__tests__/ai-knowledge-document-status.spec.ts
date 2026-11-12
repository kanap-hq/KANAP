import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { AiCapabilityRegistry } from '../control-plane/capability/ai-capability.registry';
import { AiToolRegistry } from '../ai-tool.registry';
import { DocumentActivity } from '../../knowledge/document-activity.entity';
import { DocumentApplication } from '../../knowledge/document-application.entity';
import { DocumentAttachment } from '../../knowledge/document-attachment.entity';
import { DocumentAsset } from '../../knowledge/document-asset.entity';
import { DocumentClassification } from '../../knowledge/document-classification.entity';
import { DocumentContributor } from '../../knowledge/document-contributor.entity';
import { DocumentEditLock } from '../../knowledge/document-edit-lock.entity';
import { DocumentFolder } from '../../knowledge/document-folder.entity';
import { DocumentLibrary } from '../../knowledge/document-library.entity';
import { DocumentProject } from '../../knowledge/document-project.entity';
import { DocumentReference } from '../../knowledge/document-reference.entity';
import { DocumentRequest } from '../../knowledge/document-request.entity';
import { DocumentTask } from '../../knowledge/document-task.entity';
import { DocumentType } from '../../knowledge/document-type.entity';
import { DocumentVersion } from '../../knowledge/document-version.entity';
import { Document } from '../../knowledge/document.entity';
import { IntegratedDocumentBinding } from '../../knowledge/integrated-document-binding.entity';
import { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * Fried's rule of 12/11: an agent (surface `internal`) searches and reads published documents only;
 * Kad (chat) and the MCP server keep every document the person may read, each with its status.
 */

const STATUSES = ['draft', 'in_review', 'published', 'archived', 'obsolete'] as const;

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
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    dataSource,
    {} as any, {} as any, {} as any, {} as any,
  );
}

const policy = {
  assertSurfaceAccess: async () => undefined,
  assertKnowledgeReadAccess: async () => undefined,
  listReadableEntityTypes: async () => [],
  canReadKnowledge: async () => true,
  assertWriteAccess: async () => { throw new Error('no write'); },
};

function toolRegistry(knowledge: KnowledgeService) {
  return new AiToolRegistry(
    {} as any, knowledge, policy as any, {} as any, {} as any,
    { find: async () => ({ web_search_enabled: false }) } as any,
    {} as any,
    { hasExecutedUndoablePreviewInConversation: async () => false } as any,
    { listOperations: () => [], getOperationOrNull: () => null } as any,
  );
}

function capabilityRegistry(tools: AiToolRegistry, knowledge: KnowledgeService) {
  return new AiCapabilityRegistry(
    tools,
    {} as any, {} as any, {} as any, {} as any, {} as any,
    undefined,
    policy as any,
    knowledge,
  );
}

function context(manager: any, tenantId: string, surface: 'chat' | 'mcp' | 'internal') {
  return {
    tenantId,
    userId: null,
    isPlatformHost: false,
    surface,
    authMethod: surface === 'mcp' ? 'api_key' : 'jwt',
    manager,
  } as any;
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const libraryId = randomUUID();
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Document status spec', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `doc-status-${tenantId.slice(0, 8)}`],
    );
    await runner.query(
      `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
       VALUES ($1, $2, 'Service desk', 'service-desk', false, 0, now(), now())`,
      [libraryId, tenantId],
    );
    for (const [index, status] of STATUSES.entries()) {
      await runner.query(
        `INSERT INTO documents (
           id, tenant_id, item_number, title, summary, content_markdown, content_plain,
           library_id, document_type_id, status, revision, current_version_number, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, '', $5, $5, $6, null, $7, 1, 0, now(), now())`,
        [randomUUID(), tenantId, 501 + index, `Zebra printer ${status}`, 'Clear the paper jam, then press feed.', libraryId, status],
      );
    }
    const refOf = (status: (typeof STATUSES)[number]) => `DOC-${501 + STATUSES.indexOf(status)}`;

    const knowledge = createKnowledgeService(runner.manager);
    const tools = toolRegistry(knowledge);
    const registry = capabilityRegistry(tools, knowledge);
    const execution = { surface: 'internal', trigger_kind: 'internal' } as any;

    // Agent: published only, in the search and in get_document.
    const agent = context(runner.manager, tenantId, 'internal');
    const agentSearch = await registry.resolve(agent, 'search_knowledge', '1.0.0', 'internal');
    const agentResult = await agentSearch.handler(agent, { query: 'zebra printer jam', library_ids: [libraryId] }, execution) as any;
    assert.deepEqual(agentResult.items.map((item: any) => item.ref), [refOf('published')]);
    assert.equal(agentResult.total, 1);
    assert.equal(agentResult.items[0].fallback, false);

    const agentDocument = await registry.resolve(agent, 'get_document', '1.0.0', 'internal');
    const published = await agentDocument.handler(agent, { document_id: refOf('published') }, execution) as any;
    assert.equal(published.status, 'published');
    assert.match(published.content_markdown, /paper jam/);
    for (const status of STATUSES.filter((value) => value !== 'published')) {
      await assert.rejects(
        () => agentDocument.handler(agent, { document_id: refOf(status) }, execution),
        (error: any) => {
          const response = error?.getResponse?.() ?? {};
          assert.equal(error?.getStatus?.(), 403);
          assert.equal(response.code, 'DOCUMENT_NOT_PUBLISHED');
          assert.match(String(response.message), new RegExp(`${refOf(status)}.*${status.replace('_', ' ')}`));
          assert.doesNotMatch(JSON.stringify(response), /paper jam/, 'the refusal carries no content');
          return true;
        },
        `an agent does not read a ${status} document`,
      );
    }

    // Kad (chat) and the MCP server: every state, with its status.
    for (const surface of ['chat', 'mcp'] as const) {
      const person = context(runner.manager, tenantId, surface);
      const searchResult = await tools.execute(person, 'search_knowledge', { query: 'zebra printer jam' }) as any;
      assert.deepEqual(
        searchResult.items.map((item: any) => item.status).sort(),
        [...STATUSES].sort(),
        `${surface}: every state is returned`,
      );
      assert.equal(searchResult.items.every((item: any) => item.fallback === false), true);
      assert.equal(searchResult.fallback, false);
      const draft = await tools.execute(person, 'get_document', { document_id: refOf('draft') }) as any;
      assert.equal(draft.status, 'draft');
      assert.match(draft.content_markdown, /paper jam/);
    }

    // A result found by one word of the query only (KnowledgeService marks it, see
    // knowledge-search.spec.ts) keeps its mark in the answer of every surface.
    const fallbackKnowledge = {
      search: async () => ({
        items: [{ id: 'doc-1', item_number: 1, title: 'Gouda', summary: null, status: 'published', snippet: null, rank: 0, score: 0, fallback: true }],
        total: 1,
        offset: 0,
        limit: 20,
        truncated: false,
        fallback: true,
      }),
    } as any;
    const fallbackTools = toolRegistry(fallbackKnowledge);
    for (const surface of ['chat', 'mcp'] as const) {
      const result = await fallbackTools.execute(context(runner.manager, tenantId, surface), 'search_knowledge', { query: 'gouda' }) as any;
      assert.equal(result.items[0].fallback, true, `${surface}: the fallback mark is kept`);
      assert.equal(result.fallback, true);
    }
    const fallbackAgent = capabilityRegistry(fallbackTools, fallbackKnowledge);
    const internalSearch = await fallbackAgent.resolve(agent, 'search_knowledge', '1.0.0', 'internal');
    const internalResult = await internalSearch.handler(agent, { query: 'gouda' }, execution) as any;
    assert.equal(internalResult.items[0].fallback, true, 'internal: the fallback mark is kept');
    assert.equal(internalResult.fallback, true);

    // The tool description (chat and MCP) says the same in a few words.
    const description = tools.listRegisteredTools().find((tool) => tool.name === 'search_knowledge')?.description ?? '';
    assert.match(description, /English, French, German or Spanish/);
    assert.match(description, /`fallback: true`/);
    assert.match(description, /not published, say its status/);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
