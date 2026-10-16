import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { KnowledgeRelationsService } from '../knowledge-relations.service';

// The relations of a managed document cannot be changed from Knowledge. The refusal carries a code
// the interface translates (QA lot 14: the English server sentence reached a French user).
async function testManagedDocumentRelationsRefusalIsCoded() {
  const manager = {} as any;
  const knowledge = {
    getManager: () => manager,
    resolveDocumentId: async (id: string) => id,
    assertDocumentWritable: async () => undefined,
    getIntegratedBinding: async () => ({ document_id: 'doc-1' }),
    replaceDocumentRelationsByEntity: async () => {
      throw new Error('a managed document relation must not be written');
    },
  } as any;
  const service = new KnowledgeRelationsService(knowledge);

  await assert.rejects(
    () => service.bulkReplaceRelations('doc-1', 'incidents', ['inc-1']),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      const response = error.getResponse() as Record<string, unknown>;
      assert.equal(response.code, 'KNOWLEDGE_DOCUMENT_MANAGED_RELATIONS');
      return true;
    },
  );
}

async function run() {
  await testManagedDocumentRelationsRefusalIsCoded();
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
