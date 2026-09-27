import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BaseDeleteService } from '../base-delete.service';
import { DeleteConfig, DeleteOptions } from '../delete.types';

// Mock entity type
interface TestEntity {
  id: string;
  name: string;
  tenant_id: string;
}

// Mock attachment type
interface TestAttachment {
  id: string;
  entity_id: string;
  storage_path: string;
}

// Mock related entity type
interface TestRelated {
  id: string;
  entity_id: string;
}

// Test implementation of BaseDeleteService
class TestDeleteService extends BaseDeleteService<TestEntity> {
  public beforeDeleteCalled = false;
  public afterDeleteCalled = false;
  public beforeDeleteEntity: TestEntity | null = null;
  public afterDeleteEntity: TestEntity | null = null;

  constructor(
    repository: any,
    storage: any,
    audit: any,
    config: DeleteConfig,
  ) {
    super(repository, storage, audit, config);
  }

  protected async beforeDelete(entity: TestEntity): Promise<void> {
    this.beforeDeleteCalled = true;
    this.beforeDeleteEntity = entity;
  }

  protected async afterDelete(entity: TestEntity): Promise<void> {
    this.afterDeleteCalled = true;
    this.afterDeleteEntity = entity;
  }
}

// Helper to create mock repository
function createMockRepository(entities: TestEntity[] = []) {
  const data = [...entities];
  let deletedIds: string[] = [];

  const mockRepo = {
    target: 'TestEntity',
    metadata: { tableName: 'test_entities' },
    manager: {
      getRepository: (target: any) => {
        if (target === 'TestEntity') return mockRepo;
        // Return a mock for related repositories
        return createMockRelatedRepository([]);
      },
    },
    findOne: async (opts: { where: { id: string } }) => {
      return data.find((e) => e.id === opts.where.id) || null;
    },
    delete: async (opts: { id: string }) => {
      deletedIds.push(opts.id);
      const idx = data.findIndex((e) => e.id === opts.id);
      if (idx >= 0) data.splice(idx, 1);
      return { affected: 1 };
    },
    getDeletedIds: () => deletedIds,
  };

  return mockRepo;
}

// Helper to create mock related repository
function createMockRelatedRepository(entities: any[] = []) {
  const data = [...entities];
  let deletedWhere: any[] = [];
  let updatedRecords: any[] = [];

  return {
    metadata: { tableName: 'related_entities' },
    find: async (opts: { where: any }) => {
      const key = Object.keys(opts.where)[0];
      const value = opts.where[key];
      return data.filter((e) => e[key] === value);
    },
    count: async (opts: { where: any }) => {
      const key = Object.keys(opts.where)[0];
      const value = opts.where[key];
      return data.filter((e) => e[key] === value).length;
    },
    delete: async (where: any) => {
      deletedWhere.push(where);
      const key = Object.keys(where)[0];
      const value = where[key];
      const toDelete = data.filter((e) => e[key] === value);
      for (const item of toDelete) {
        const idx = data.indexOf(item);
        if (idx >= 0) data.splice(idx, 1);
      }
      return { affected: toDelete.length };
    },
    update: async (where: any, updates: any) => {
      const key = Object.keys(where)[0];
      const value = where[key];
      data.filter((e) => e[key] === value).forEach((e) => {
        Object.assign(e, updates);
        updatedRecords.push(e);
      });
      return { affected: data.length };
    },
    getDeletedWhere: () => deletedWhere,
    getUpdatedRecords: () => updatedRecords,
    getData: () => data,
  };
}

// Helper to create mock storage service
function createMockStorage() {
  const deletedPaths: string[] = [];
  let shouldFail = false;
  let failMessage = '';

  return {
    deleteObject: async (path: string) => {
      if (shouldFail) {
        throw new Error(failMessage || 'Storage error');
      }
      deletedPaths.push(path);
    },
    getDeletedPaths: () => deletedPaths,
    setShouldFail: (fail: boolean, message?: string) => {
      shouldFail = fail;
      failMessage = message || '';
    },
  };
}

// Helper to create mock audit service
function createMockAudit() {
  const logs: any[] = [];

  return {
    log: async (params: any, opts?: any) => {
      logs.push({ params, opts });
    },
    getLogs: () => logs,
  };
}

// Test: Successful deletion with cascade relations
async function testSuccessfulDeletionWithCascade() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };
  const attachments: TestAttachment[] = [
    { id: 'att-1', entity_id: 'entity-1', storage_path: 'path/to/file1.pdf' },
    { id: 'att-2', entity_id: 'entity-1', storage_path: 'path/to/file2.pdf' },
  ];

  const mockRepo = createMockRepository([entity]);
  const mockAttachmentRepo = createMockRelatedRepository(attachments);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  // Override manager to return our mock attachment repo
  mockRepo.manager.getRepository = (target: any) => {
    if (target === 'TestEntity') return mockRepo;
    return mockAttachmentRepo;
  };

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    {
      entityName: 'TestEntity',
      cascadeRelations: [
        {
          repository: 'TestAttachment' as any,
          foreignKey: 'entity_id',
          deleteStrategy: 'cascade',
          storagePathColumn: 'storage_path',
        },
      ],
    },
  );

  await service.delete('entity-1', { userId: 'user-1' });

  // Verify entity was deleted
  assert.deepEqual(mockRepo.getDeletedIds(), ['entity-1']);

  // Verify storage was cleaned up
  assert.deepEqual(mockStorage.getDeletedPaths(), ['path/to/file1.pdf', 'path/to/file2.pdf']);

  // Verify audit was logged
  assert.equal(mockAudit.getLogs().length, 1);
  assert.equal(mockAudit.getLogs()[0].params.table, 'test_entities');
  assert.equal(mockAudit.getLogs()[0].params.action, 'delete');
  assert.equal(mockAudit.getLogs()[0].params.userId, 'user-1');

  // Verify hooks were called
  assert.equal(service.beforeDeleteCalled, true);
  assert.equal(service.afterDeleteCalled, true);
  assert.deepEqual(service.beforeDeleteEntity, entity);
  assert.deepEqual(service.afterDeleteEntity, entity);
}

// Test: Entity not found throws NotFoundException
async function testEntityNotFoundThrowsNotFoundException() {
  const mockRepo = createMockRepository([]);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    { entityName: 'TestEntity' },
  );

  let thrownError: any = null;
  try {
    await service.delete('non-existent-id');
  } catch (error) {
    thrownError = error;
  }

  assert.ok(thrownError instanceof NotFoundException);
  assert.equal(thrownError.message, 'TestEntity not found');
}

// Test: Restrict strategy prevents deletion when relations exist
async function testRestrictStrategyPreventsDeletion() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };
  const related: TestRelated[] = [
    { id: 'rel-1', entity_id: 'entity-1' },
    { id: 'rel-2', entity_id: 'entity-1' },
  ];

  const mockRepo = createMockRepository([entity]);
  const mockRelatedRepo = createMockRelatedRepository(related);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  mockRepo.manager.getRepository = (target: any) => {
    if (target === 'TestEntity') return mockRepo;
    return mockRelatedRepo;
  };

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    {
      entityName: 'TestEntity',
      cascadeRelations: [
        {
          repository: 'TestRelated' as any,
          foreignKey: 'entity_id',
          deleteStrategy: 'restrict',
        },
      ],
    },
  );

  let thrownError: any = null;
  try {
    await service.delete('entity-1');
  } catch (error) {
    thrownError = error;
  }

  assert.ok(thrownError instanceof ConflictException);
  assert.ok(thrownError.message.includes('Cannot delete TestEntity'));
  assert.ok(thrownError.message.includes('2 related record(s) exist'));

  // Verify entity was NOT deleted
  assert.deepEqual(mockRepo.getDeletedIds(), []);
}

// Test: Storage cleanup failures are logged but don't fail deletion
async function testStorageCleanupFailuresAreLogged() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };
  const attachments: TestAttachment[] = [
    { id: 'att-1', entity_id: 'entity-1', storage_path: 'path/to/file1.pdf' },
  ];

  const mockRepo = createMockRepository([entity]);
  const mockAttachmentRepo = createMockRelatedRepository(attachments);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  mockRepo.manager.getRepository = (target: any) => {
    if (target === 'TestEntity') return mockRepo;
    return mockAttachmentRepo;
  };

  // Make storage fail
  mockStorage.setShouldFail(true, 'S3 connection error');

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    {
      entityName: 'TestEntity',
      cascadeRelations: [
        {
          repository: 'TestAttachment' as any,
          foreignKey: 'entity_id',
          deleteStrategy: 'cascade',
          storagePathColumn: 'storage_path',
        },
      ],
    },
  );

  // Should not throw despite storage failure
  await service.delete('entity-1');

  // Verify entity was still deleted
  assert.deepEqual(mockRepo.getDeletedIds(), ['entity-1']);

  // Verify audit was still logged
  assert.equal(mockAudit.getLogs().length, 1);
}

// Test: Audit logging is called with correct parameters
async function testAuditLoggingWithCorrectParameters() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };

  const mockRepo = createMockRepository([entity]);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    {
      entityName: 'TestEntity',
      auditTable: 'custom_table',
      auditAction: 'disable',
    },
  );

  await service.delete('entity-1', { userId: 'admin-user' });

  const logs = mockAudit.getLogs();
  assert.equal(logs.length, 1);

  const log = logs[0];
  assert.equal(log.params.table, 'custom_table');
  assert.equal(log.params.recordId, 'entity-1');
  assert.equal(log.params.action, 'disable');
  assert.deepEqual(log.params.before, entity);
  assert.equal(log.params.after, null);
  assert.equal(log.params.userId, 'admin-user');
}

// Test: Transaction support via EntityManager option
async function testTransactionSupportViaEntityManager() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };

  const mockRepo = createMockRepository([entity]);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  // Create a custom manager to verify it's being used
  let managerUsed = false;
  const customManager = {
    getRepository: (target: any) => {
      managerUsed = true;
      return mockRepo;
    },
  };

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    { entityName: 'TestEntity' },
  );

  await service.delete('entity-1', { manager: customManager as any });

  // Verify custom manager was used
  assert.equal(managerUsed, true);

  // Verify audit received the manager in opts
  const logs = mockAudit.getLogs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].opts.manager, customManager);
}

// Test: Nullify strategy sets foreign key to null
async function testNullifyStrategySetsNull() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };
  const related: TestRelated[] = [
    { id: 'rel-1', entity_id: 'entity-1' },
    { id: 'rel-2', entity_id: 'entity-1' },
  ];

  const mockRepo = createMockRepository([entity]);
  const mockRelatedRepo = createMockRelatedRepository(related);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  mockRepo.manager.getRepository = (target: any) => {
    if (target === 'TestEntity') return mockRepo;
    return mockRelatedRepo;
  };

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    {
      entityName: 'TestEntity',
      cascadeRelations: [
        {
          repository: 'TestRelated' as any,
          foreignKey: 'entity_id',
          deleteStrategy: 'nullify',
        },
      ],
    },
  );

  await service.delete('entity-1');

  // Verify entity was deleted
  assert.deepEqual(mockRepo.getDeletedIds(), ['entity-1']);

  // Verify related records had FK nullified (not deleted)
  const updatedRecords = mockRelatedRepo.getUpdatedRecords();
  assert.equal(updatedRecords.length, 2);
  for (const record of updatedRecords) {
    assert.equal(record.entity_id, null);
  }
}

// Test: Skip audit option works
async function testSkipAuditOption() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };

  const mockRepo = createMockRepository([entity]);
  const mockStorage = createMockStorage();
  const mockAudit = createMockAudit();

  const service = new TestDeleteService(
    mockRepo,
    mockStorage,
    mockAudit,
    { entityName: 'TestEntity' },
  );

  await service.delete('entity-1', { skipAudit: true });

  // Verify entity was deleted
  assert.deepEqual(mockRepo.getDeletedIds(), ['entity-1']);

  // Verify no audit logs
  assert.equal(mockAudit.getLogs().length, 0);
}

// Test: No storage service handles gracefully
async function testNoStorageServiceHandlesGracefully() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };
  const attachments: TestAttachment[] = [
    { id: 'att-1', entity_id: 'entity-1', storage_path: 'path/to/file1.pdf' },
  ];

  const mockRepo = createMockRepository([entity]);
  const mockAttachmentRepo = createMockRelatedRepository(attachments);
  const mockAudit = createMockAudit();

  mockRepo.manager.getRepository = (target: any) => {
    if (target === 'TestEntity') return mockRepo;
    return mockAttachmentRepo;
  };

  const service = new TestDeleteService(
    mockRepo,
    null, // No storage service
    mockAudit,
    {
      entityName: 'TestEntity',
      cascadeRelations: [
        {
          repository: 'TestAttachment' as any,
          foreignKey: 'entity_id',
          deleteStrategy: 'cascade',
          storagePathColumn: 'storage_path',
        },
      ],
    },
  );

  // Should not throw
  await service.delete('entity-1');

  // Verify entity was deleted
  assert.deepEqual(mockRepo.getDeletedIds(), ['entity-1']);
}

// Test: a row delete refused by the database keeps the stored files. Files go
// only once the row delete, the audit and the after hook have gone through.
async function testRefusedRowDeleteKeepsStoredFiles() {
  const entity: TestEntity = { id: 'entity-1', name: 'Test Entity', tenant_id: 'tenant-1' };
  const attachments: TestAttachment[] = [
    { id: 'att-1', entity_id: 'entity-1', storage_path: 'path/to/kept.pdf' },
  ];
  const mockRepo = createMockRepository([entity]);
  const mockAttachmentRepo = createMockRelatedRepository(attachments);
  const mockStorage = createMockStorage();
  mockRepo.manager.getRepository = (target: any) => (target === 'TestEntity' ? mockRepo : mockAttachmentRepo);
  mockRepo.delete = async () => {
    throw Object.assign(new Error('update or delete on table "test_entities" violates foreign key constraint'), { code: '23503' });
  };
  const config: DeleteConfig = {
    entityName: 'TestEntity',
    cascadeRelations: [
      { repository: 'TestAttachment' as any, foreignKey: 'entity_id', deleteStrategy: 'cascade', storagePathColumn: 'storage_path' },
    ],
  };

  const service = new TestDeleteService(mockRepo, mockStorage, createMockAudit(), config);
  await assert.rejects(service.delete('entity-1'), (err: any) => err?.code === '23503');
  assert.deepEqual(mockStorage.getDeletedPaths(), [], 'a refused row delete leaves its files in place');

  // Same when the audit, which runs after the row delete, fails.
  const auditRepo = createMockRepository([entity]);
  auditRepo.manager.getRepository = (target: any) => (target === 'TestEntity' ? auditRepo : createMockRelatedRepository(attachments));
  const failingAudit = { log: async () => { throw new Error('current transaction is aborted'); } };
  const storage2 = createMockStorage();
  await assert.rejects(new TestDeleteService(auditRepo, storage2, failingAudit, config).delete('entity-1'), /aborted/);
  assert.deepEqual(storage2.getDeletedPaths(), [], 'a failed audit leaves the files in place');
}

// Run all tests
(async () => {
  await testSuccessfulDeletionWithCascade();
  await testEntityNotFoundThrowsNotFoundException();
  await testRestrictStrategyPreventsDeletion();
  await testStorageCleanupFailuresAreLogged();
  await testAuditLoggingWithCorrectParameters();
  await testTransactionSupportViaEntityManager();
  await testNullifyStrategySetsNull();
  await testSkipAuditOption();
  await testNoStorageServiceHandlesGracefully();
  await testRefusedRowDeleteKeepsStoredFiles();
  console.log('All base-delete.service tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
