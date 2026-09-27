import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage/storage.service';
import {
  CascadeRelation,
  DeleteConfig,
  DeleteOptions,
  StorageCleanupItem,
} from './delete.types';

/**
 * Abstract base class for delete services that provides common deletion logic
 * including cascade handling, storage cleanup, and audit logging.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class ApplicationsDeleteService extends BaseDeleteService<Application> {
 *   constructor(
 *     @InjectRepository(Application) repository: Repository<Application>,
 *     storage: StorageService,
 *     audit: AuditService,
 *   ) {
 *     super(repository, storage, audit, {
 *       entityName: 'Application',
 *       storagePrefix: 'applications',
 *       cascadeRelations: [
 *         { repository: ApplicationAttachment, foreignKey: 'application_id', deleteStrategy: 'cascade', storagePathColumn: 'storage_path' },
 *       ],
 *     });
 *   }
 * }
 * ```
 */
export abstract class BaseDeleteService<T extends ObjectLiteral> {
  protected readonly logger: Logger;

  constructor(
    protected readonly repository: Repository<T>,
    protected readonly storage: StorageService | null,
    protected readonly audit: AuditService,
    protected readonly config: DeleteConfig,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Get the repository, using the transaction manager if provided
   */
  protected getRepo(manager?: EntityManager): Repository<T> {
    return manager ? manager.getRepository(this.repository.target) : this.repository;
  }

  /**
   * Delete an entity by ID
   *
   * @param id The entity ID to delete
   * @param opts Delete options including manager for transaction support
   * @throws NotFoundException if entity is not found
   * @throws ConflictException if restrict strategy prevents deletion
   */
  async delete(id: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);

    // 1. Find entity
    const entity = await repo.findOne({ where: { id } as any });
    if (!entity) {
      throw new NotFoundException(`${this.config.entityName} not found`);
    }

    // 2. Call beforeDelete hook
    await this.beforeDelete(entity, manager);

    // 3. Handle cascade relations (collects the storage paths, touches no file)
    const storageItems = await this.handleCascadeRelations(id, manager);

    // 4. Delete the entity
    await repo.delete({ id } as any);

    // 5. Log deletion to audit
    if (!opts?.skipAudit) {
      await this.logDeletion(entity, opts?.userId ?? null, manager);
    }

    // 6. Call afterDelete hook
    await this.afterDelete(entity, manager);

    // 7. Clean up storage last: a delete that fails above keeps its files
    await this.cleanupStorage(storageItems);
  }

  /**
   * Hook called before deletion starts.
   * Override to add validation or pre-deletion logic.
   */
  protected async beforeDelete(_entity: T, _manager: EntityManager): Promise<void> {
    // Empty by default - override in subclass
  }

  /**
   * Hook called after deletion completes.
   * Override to add post-deletion cleanup or notifications.
   */
  protected async afterDelete(_entity: T, _manager: EntityManager): Promise<void> {
    // Empty by default - override in subclass
  }

  /**
   * Handle cascade relations according to their configured strategy
   * Returns storage items that need cleanup
   */
  private async handleCascadeRelations(
    entityId: string,
    manager: EntityManager,
  ): Promise<StorageCleanupItem[]> {
    const storageItems: StorageCleanupItem[] = [];

    if (!this.config.cascadeRelations?.length) {
      return storageItems;
    }

    for (const relation of this.config.cascadeRelations) {
      const items = await this.deleteCascadeRelation(entityId, relation, manager);
      storageItems.push(...items);
    }

    return storageItems;
  }

  /**
   * Process a single cascade relation
   */
  private async deleteCascadeRelation(
    entityId: string,
    relation: CascadeRelation,
    manager: EntityManager,
  ): Promise<StorageCleanupItem[]> {
    const storageItems: StorageCleanupItem[] = [];

    // Get the repository from the manager
    const relatedRepo = manager.getRepository(relation.repository as any);
    const whereClause = { [relation.foreignKey]: entityId } as any;

    switch (relation.deleteStrategy) {
      case 'restrict': {
        // Check if any related records exist
        const count = await relatedRepo.count({ where: whereClause });
        if (count > 0) {
          throw new ConflictException(
            `Cannot delete ${this.config.entityName}: ${count} related record(s) exist and must be removed first`,
          );
        }
        break;
      }

      case 'nullify': {
        // Set the foreign key to null for all related records
        await relatedRepo.update(whereClause, { [relation.foreignKey]: null } as any);
        break;
      }

      case 'cascade':
      default: {
        // Collect storage paths if configured
        if (relation.storagePathColumn) {
          const records = await relatedRepo.find({ where: whereClause });
          for (const record of records) {
            const path = (record as any)[relation.storagePathColumn];
            if (path) {
              storageItems.push({
                path,
                source: relatedRepo.metadata.tableName,
              });
            }
          }
        }

        // Delete all related records
        await relatedRepo.delete(whereClause);
        break;
      }
    }

    return storageItems;
  }

  /**
   * Clean up storage files with proper error logging
   */
  private async cleanupStorage(items: StorageCleanupItem[]): Promise<void> {
    if (!this.storage || items.length === 0) {
      return;
    }

    for (const item of items) {
      try {
        await this.storage.deleteObject(item.path);
      } catch (error: any) {
        // Log the error but don't fail the deletion
        this.logger.warn(
          `Failed to delete storage object "${item.path}"${item.source ? ` from ${item.source}` : ''}: ${error?.message || 'Unknown error'}`,
        );
      }
    }
  }

  /**
   * Log the deletion to the audit service
   */
  private async logDeletion(
    entity: T,
    userId: string | null,
    manager: EntityManager,
  ): Promise<void> {
    const tableName = this.config.auditTable ?? this.repository.metadata.tableName;
    const entityId = (entity as any).id;

    await this.audit.log(
      {
        table: tableName,
        recordId: entityId,
        action: this.config.auditAction ?? 'delete',
        before: entity,
        after: null,
        userId,
      },
      { manager },
    );
  }
}
