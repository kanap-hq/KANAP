import { EntityManager, Repository, ObjectLiteral } from 'typeorm';

/**
 * Strategy for handling related records during deletion
 */
export type DeleteStrategy = 'cascade' | 'nullify' | 'restrict';

/**
 * Configuration for a cascade relation
 */
export interface CascadeRelation<T extends ObjectLiteral = ObjectLiteral> {
  /** The repository or entity class for the related records */
  repository: Repository<T> | (new () => T);
  /** The foreign key column that references the parent entity */
  foreignKey: string;
  /** How to handle the relation during deletion */
  deleteStrategy: DeleteStrategy;
  /** Optional: Column to use for storage path cleanup (if relation has attachments) */
  storagePathColumn?: string;
}

/**
 * Configuration for the delete service
 */
export interface DeleteConfig {
  /** Human-readable name for the entity (used in error messages) */
  entityName: string;
  /** Storage prefix for cleaning up related files (e.g., 'applications', 'contracts') */
  storagePrefix?: string;
  /** Relations to handle during cascade delete */
  cascadeRelations?: CascadeRelation[];
  /** Custom audit action name (defaults to 'delete') */
  auditAction?: 'delete' | 'disable';
  /** Table name for audit logging (defaults to entityName) */
  auditTable?: string;
}

/**
 * Options for the delete operation
 */
export interface DeleteOptions {
  /** EntityManager for transaction support */
  manager?: EntityManager;
  /** User ID for audit logging */
  userId?: string | null;
  /** Skip audit logging */
  skipAudit?: boolean;
}

/**
 * Result of a bulk delete operation
 */
export interface BulkDeleteResult {
  deleted: string[];
  /** `code` and `count`: a refusal the screen words in its language (`errors:<code>`, with the count). */
  failed: Array<{ id: string; name: string; reason: string; code?: string; count?: number }>;
}

/**
 * Storage item to clean up
 */
export interface StorageCleanupItem {
  path: string;
  source?: string;
}
