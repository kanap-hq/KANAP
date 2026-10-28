import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES, resolveAuditParent } from '../audit-parent-rules';
import { RECORD_HISTORY, recordHistoryPayloadKeyReads } from '../record-history.inventory';
import { assetsParentRules } from '../record-history/records/assets';
import { technologiesParentRules } from '../record-history/records/technologies';

// The parent rules of family D (lot 2): the asset and technology children whose audit row names
// its record in the payload. Their SQL copy and their partial indexes are in
// `1855730000000-audit-log-parent-record-family-d.ts`; the last test reads that file and checks
// that the labels, the keys and the index names agree. A record-mode child (a relation, a cluster
// member, a technology version...) keeps `parent_*` NULL and needs no rule.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const ASSET = '11111111-1111-4111-8111-111111111111';
const TECHNOLOGY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const MIGRATION_PATH = backendPath('src', 'migrations', '1855730000000-audit-log-parent-record-family-d.ts');
const MIGRATION_TEXT = () => fs.readFileSync(MIGRATION_PATH, 'utf8');

function quotedLabels(block: string | undefined, what: string): string[] {
  assert.ok(block, `the migration declares ${what}`);
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

function migrationAssetLabels(): string[] {
  return quotedLabels(/const ASSET_LABELS = \[([\s\S]*?)\] as const;/.exec(MIGRATION_TEXT())?.[1], 'its asset labels');
}

function migrationTechnologyLabels(): string[] {
  return quotedLabels(/const TECHNOLOGY_LABELS = \[([\s\S]*?)\] as const;/.exec(MIGRATION_TEXT())?.[1], 'its technology labels');
}

function fakeManager() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager: any = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [];
    },
  };
  return { queries, manager };
}

async function testRulesAndResolve() {
  assert.deepEqual(Object.keys(assetsParentRules).sort(), migrationAssetLabels(), 'the asset rules and the migration labels agree');
  assert.deepEqual(Object.keys(technologiesParentRules).sort(), migrationTechnologyLabels(), 'the technology rules and the migration labels agree');
  for (const [label, rule] of Object.entries(assetsParentRules)) {
    assert.equal(rule.parentTable, 'assets', `${label}: the asset table`);
    assert.equal(rule.from, 'payload', `${label}: a payload key`);
    assert.deepEqual(rule.from === 'payload' ? rule.keys : [], ['asset_id'], `${label}: the asset key`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
  }
  for (const [label, rule] of Object.entries(technologiesParentRules)) {
    assert.equal(rule.parentTable, 'technologies', `${label}: the technology table`);
    assert.equal(rule.from, 'payload', `${label}: a payload key`);
    assert.deepEqual(rule.from === 'payload' ? rule.keys : [], ['technology_id'], `${label}: the technology key`);
    assert.equal(AUDIT_PARENT_RULES[label], rule, `${label}: aggregated`);
  }

  const { manager, queries } = fakeManager();
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'asset_hardware_info', recordId: OTHER, after: { asset_id: ASSET }, before: null }),
    { table: 'assets', id: ASSET },
    'an asset hardware row names its asset after',
  );
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'asset_links', recordId: OTHER, before: { asset_id: ASSET }, after: null }),
    { table: 'assets', id: ASSET },
    'a deleted asset link names its asset before',
  );
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'asset_technologies', recordId: TECHNOLOGY, after: { asset_id: ASSET }, before: null }),
    { table: 'assets', id: ASSET },
    'an installed technology names the asset, not the technology in record_id',
  );
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'technology_links', recordId: OTHER, after: { technology_id: TECHNOLOGY }, before: null }),
    { table: 'technologies', id: TECHNOLOGY },
    'a technology link names its technology',
  );
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'technology_vulnerabilities', recordId: OTHER, after: { technology_id: TECHNOLOGY, cve_id: 'CVE-2026-1234' }, before: null }),
    { table: 'technologies', id: TECHNOLOGY },
    'a vulnerability row names its technology',
  );
  assert.equal(
    await resolveAuditParent(manager, { table: 'asset_relations', recordId: ASSET, after: { relations: [] }, before: null }),
    null,
    'a record-mode child needs no rule',
  );
  assert.equal(
    await resolveAuditParent(manager, { table: 'technology_versions', recordId: TECHNOLOGY, after: { label: '2.1' }, before: null }),
    null,
    'a technology version is read by record_id, not by a rule',
  );
  assert.equal(queries.length, 0, 'the payload rules read nothing');
}

function testMigrationIndexes() {
  const text = MIGRATION_TEXT();
  for (const entry of [RECORD_HISTORY.assets, RECORD_HISTORY.technologies]) {
    for (const read of recordHistoryPayloadKeyReads(entry)) {
      const name = `idx_audit_log_${read.key}_${entry.table}`;
      assert.ok(text.includes(name), `${name}: the migration creates the index`);
      assert.ok(text.includes(`->> '${read.key}'`), `${name}: the key expression is in the migration`);
      for (const label of read.labels) {
        assert.ok(text.includes(`'${label}'`), `${name}: the index names ${label}`);
      }
    }
  }
  assert.doesNotMatch(text, /ROW LEVEL SECURITY|row_security/i, 'the migration never touches RLS');
  assert.doesNotMatch(text, /ALTER TABLE[^\n]*DISABLE ROW LEVEL SECURITY/i, 'the migration never disables RLS');
}

async function run() {
  await testRulesAndResolve();
  testMigrationIndexes();
  console.log('audit-parent-rules-family-d.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
