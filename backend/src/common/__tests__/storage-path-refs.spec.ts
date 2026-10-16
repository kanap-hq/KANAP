import * as assert from 'node:assert/strict';
import { ATTACHMENT_TABLES } from '../storage-path-refs';
import { TENANT_PURGE_ATTACHMENT_TABLES } from '../../admin/tenants/tenant-purge.inventory';

// The orphan file cleanup deletes a stored file that no table of ATTACHMENT_TABLES names.
// Every table whose files the tenant purge deletes holds live files, so it belongs there too,
// unless it is listed below with the reason it must stay out.
const KEPT_OUT_OF_ORPHAN_CLEANUP: Record<string, string> = {
  // Dormant since the budget lines moved into spend_* (migration 1853970000000): its rows were
  // copied into spend_attachments with the same storage_path, which keeps the files alive.
  // Reading it would keep a file alive after its spend attachment is deleted.
  capex_attachments: 'dormant, rows mirrored in spend_attachments',
};

function testEveryPurgedAttachmentTableIsReadByTheOrphanCleanup() {
  const read = new Set<string>(ATTACHMENT_TABLES);
  const missing = TENANT_PURGE_ATTACHMENT_TABLES.filter(
    (table) => !read.has(table) && !(table in KEPT_OUT_OF_ORPHAN_CLEANUP),
  );
  assert.deepEqual(missing, [], `attachment tables missing from ATTACHMENT_TABLES: ${missing.join(', ')}`);
}

function testExclusionsNameRealAttachmentTables() {
  const purged = new Set<string>(TENANT_PURGE_ATTACHMENT_TABLES);
  const read = new Set<string>(ATTACHMENT_TABLES);
  for (const table of Object.keys(KEPT_OUT_OF_ORPHAN_CLEANUP)) {
    assert.ok(purged.has(table), `${table} is excluded but is not a purged attachment table`);
    assert.ok(!read.has(table), `${table} is excluded but ATTACHMENT_TABLES reads it`);
  }
}

function testOrphanCleanupReadsOnlyPurgedTables() {
  const purged = new Set<string>(TENANT_PURGE_ATTACHMENT_TABLES);
  const unknown = ATTACHMENT_TABLES.filter((table) => !purged.has(table));
  assert.deepEqual(unknown, [], `ATTACHMENT_TABLES names tables the tenant purge ignores: ${unknown.join(', ')}`);
}

testEveryPurgedAttachmentTableIsReadByTheOrphanCleanup();
testExclusionsNameRealAttachmentTables();
testOrphanCleanupReadsOnlyPurgedTables();
console.log('storage-path-refs.spec passed');
