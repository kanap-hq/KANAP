import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { KnowledgeService, RelationEntityType } from './knowledge.service';

const RELATION_ENTITY_TYPES: RelationEntityType[] = [
  'applications',
  'assets',
  'projects',
  'requests',
  'tasks',
  'locations',
  'connections',
  'interfaces',
  'incidents',
];

type RelationMutationOptions = {
  manager?: EntityManager;
  userId?: string | null;
  guardAgainstActiveLock?: boolean;
};

@Injectable()
export class KnowledgeRelationsService {
  constructor(private readonly knowledge: KnowledgeService) {}

  private getManager(opts?: RelationMutationOptions): EntityManager {
    return this.knowledge.getManager(opts);
  }

  private async resolveMutableDocumentId(
    idOrRef: string,
    opts?: RelationMutationOptions,
  ): Promise<{ manager: EntityManager; documentId: string }> {
    const manager = this.getManager(opts);
    const documentId = await this.knowledge.resolveDocumentId(idOrRef, manager);
    await this.knowledge.assertDocumentWritable(documentId, manager, opts?.userId || null);

    if (opts?.guardAgainstActiveLock) {
      await this.knowledge.assertWorkflowAllowsEditing(documentId, manager);
      await this.knowledge.assertDocumentUnlockedForUser(documentId, opts.userId || null, manager);
    }

    if (await this.knowledge.getIntegratedBinding(documentId, manager)) {
      // A managed document belongs to its record: the record's page links it, not Knowledge.
      throw new BadRequestException({
        code: 'KNOWLEDGE_DOCUMENT_MANAGED_RELATIONS',
        message: 'Managed integrated document relations cannot be changed from Knowledge',
      });
    }

    return { manager, documentId };
  }

  async bulkReplaceRelations(
    idOrRef: string,
    entity: RelationEntityType,
    ids: string[],
    opts?: RelationMutationOptions,
  ) {
    const { manager, documentId } = await this.resolveMutableDocumentId(idOrRef, opts);
    await this.knowledge.assertRelationWriteAllowed(documentId, { [entity]: Array.isArray(ids) ? ids : [] }, manager, opts?.userId || null);
    return this.knowledge.replaceDocumentRelationsByEntity(documentId, entity, ids, manager);
  }

  async bulkReplaceRelationSets(
    idOrRef: string,
    body: Partial<Record<RelationEntityType, string[]>>,
    opts?: RelationMutationOptions,
  ) {
    const manager = this.getManager(opts);
    const updates = RELATION_ENTITY_TYPES.filter((key) => Object.prototype.hasOwnProperty.call(body || {}, key));

    if (updates.length === 0) {
      return { ok: true, updated: [] as RelationEntityType[] };
    }

    const run = async (tx: EntityManager) => {
      const { documentId } = await this.resolveMutableDocumentId(idOrRef, {
        manager: tx,
        userId: opts?.userId || null,
        guardAgainstActiveLock: opts?.guardAgainstActiveLock,
      });
      await this.knowledge.assertRelationWriteAllowed(
        documentId,
        Object.fromEntries(updates.map((key) => [key, Array.isArray(body?.[key]) ? body?.[key] || [] : []])),
        tx,
        opts?.userId || null,
      );

      for (const key of updates) {
        await this.knowledge.replaceDocumentRelationsByEntity(
          documentId,
          key,
          Array.isArray(body?.[key]) ? body?.[key] || [] : [],
          tx,
        );
      }
      return { ok: true, updated: updates };
    };

    if (manager.queryRunner?.isTransactionActive) {
      return run(manager);
    }
    return manager.transaction(run);
  }

  async addRelation(
    idOrRef: string,
    entity: RelationEntityType,
    targetId: string,
    opts?: RelationMutationOptions,
  ) {
    const { manager, documentId } = await this.resolveMutableDocumentId(idOrRef, opts);
    await this.knowledge.assertRelationWriteAllowed(documentId, { [entity]: [String(targetId || '').trim()] }, manager, opts?.userId || null);
    return this.knowledge.addDocumentRelationByEntity(documentId, entity, targetId, manager);
  }

  async removeRelation(
    idOrRef: string,
    entity: RelationEntityType,
    targetId: string,
    opts?: RelationMutationOptions,
  ) {
    const { manager, documentId } = await this.resolveMutableDocumentId(idOrRef, opts);
    await this.knowledge.assertRelationWriteAllowed(documentId, { [entity]: [] }, manager, opts?.userId || null, 'remove');
    return this.knowledge.removeDocumentRelationByEntity(documentId, entity, targetId, manager);
  }
}
