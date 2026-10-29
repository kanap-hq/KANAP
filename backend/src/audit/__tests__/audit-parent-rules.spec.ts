import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import {
  AUDIT_PARENT_RULES,
  auditParentRuleTables,
  isAuditUuid,
  payloadParentId,
  resolveAuditParent,
  singleChangedId,
} from '../audit-parent-rules';
import { RECORD_HISTORY } from '../record-history.inventory';

// The rules that give an audit row its budget line (`audit-parent-rules.ts`): the payload key of
// a child, or the line of a version. The links both sides write (application, technology, asset)
// have no rule: their writers hand the parent. The same labels are copied in the migration's SQL;
// the last test reads that file and checks that both lists agree. The other families have their
// own migration and their own comparison spec (`record-history-family-c-migration.spec.ts`).

const LINE = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function versionManager(rows: Array<{ spend_item_id: string }> = [{ spend_item_id: LINE }]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager: any = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return rows;
    },
  };
  return { queries, manager };
}

async function testPayloadRules() {
  const { manager } = versionManager();

  // A link, an attachment: the child payload names its line, OPEX or CAPEX key.
  for (const [table, after, before] of [
    ['spend_links', { spend_item_id: LINE }, null],
    ['capex_links', { capex_item_id: LINE }, null],
    ['spend_attachments', null, { spend_item_id: LINE }],
    ['capex_attachments', null, { capex_item_id: LINE }],
  ] as const) {
    assert.deepEqual(await resolveAuditParent(manager, { table, recordId: OTHER, after, before }), { table: 'spend_items', id: LINE }, table);
  }

  // A contact link names its line in the payload; the supplier sync writes the line in record_id
  // and its before/after are arrays of strings.
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'spend_item_contacts', recordId: OTHER, after: { spend_item_id: LINE }, before: null }),
    { table: 'spend_items', id: LINE },
    'contact payload',
  );
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'capex_item_contacts', recordId: LINE, after: ['contact:technical'], before: [] }),
    { table: 'spend_items', id: LINE },
    'contact supplier sync falls back to record_id',
  );

  // The legacy budget task label has no rule: the line reads the `tasks` row written beside it.
  assert.equal(
    await resolveAuditParent(manager, { table: 'spend_tasks', recordId: OTHER, after: { related_object_id: LINE }, before: null }),
    null,
    'the legacy line task label has no parent',
  );
}

async function testLinkLabelsHaveNoRule() {
  // `record_id` is the line from the line side, the application or technology from the other:
  // no rule may read it, the writers hand the parent explicitly.
  const { manager, queries } = versionManager();
  for (const table of ['application_spend_items', 'application_capex_items', 'technology_spend_items', 'asset_spend_items', 'asset_capex_items']) {
    assert.equal(AUDIT_PARENT_RULES[table], undefined, `${table}: no rule`);
    assert.equal(await resolveAuditParent(manager, { table, recordId: OTHER, after: [LINE], before: [] }), null, `${table}: no parent of its own`);
    assert.deepEqual(
      await resolveAuditParent(manager, { table, recordId: OTHER, after: [], before: [], parent: { table: 'spend_items', id: LINE } }),
      { table: 'spend_items', id: LINE },
      `${table}: the writer's parent`,
    );
  }
  assert.equal(queries.length, 0, 'a link label reads nothing');
}

function testSingleChangedId() {
  assert.equal(singleChangedId([OTHER], [OTHER, LINE]), LINE, 'one added');
  assert.equal(singleChangedId([LINE, OTHER], [OTHER]), LINE, 'one removed');
  assert.equal(singleChangedId({ ids: [OTHER] }, { ids: [OTHER, LINE.toUpperCase()], hidden_kept: 2 }), LINE, 'the asset form, lower case');
  assert.equal(singleChangedId([], [LINE, OTHER]), null, 'two added');
  assert.equal(singleChangedId([LINE], [OTHER]), null, 'one swapped for another');
  assert.equal(singleChangedId([LINE], [LINE]), null, 'nothing changed');
  assert.equal(singleChangedId(null, ['not-a-uuid']), null, 'no uuid');
}

async function testVersionRules() {
  // A version, an amount and an allocation name the version in record_id.
  for (const table of ['spend_versions', 'capex_versions', 'spend_amounts', 'capex_amounts', 'spend_allocations', 'capex_allocations']) {
    const { manager, queries } = versionManager();
    assert.deepEqual(await resolveAuditParent(manager, { table, recordId: VERSION, after: null, before: null }), { table: 'spend_items', id: LINE }, table);
    assert.deepEqual(
      queries,
      [{ sql: 'SELECT spend_item_id FROM spend_versions WHERE tenant_id = app_current_tenant() AND id = $1', params: [VERSION] }],
      `${table}: the version is read by its id, in the transaction's tenant`,
    );
  }

  // A round input names its version in the payload, after or before (a delete).
  for (const [table, after, before] of [
    ['spend_round_inputs', { version_id: VERSION }, null],
    ['capex_round_inputs', null, { version_id: VERSION }],
  ] as const) {
    const { manager, queries } = versionManager();
    assert.deepEqual(await resolveAuditParent(manager, { table, recordId: OTHER, after, before }), { table: 'spend_items', id: LINE }, table);
    assert.deepEqual(queries[0].params, [VERSION], `${table}: the payload version`);
  }
}

async function testExplicitParentWins() {
  const { manager, queries } = versionManager();
  assert.deepEqual(
    await resolveAuditParent(manager, { table: 'spend_amounts', recordId: VERSION, parent: { table: 'spend_items', id: OTHER } }),
    { table: 'spend_items', id: OTHER },
    'the caller knows the line',
  );
  assert.equal(queries.length, 0, 'an explicit parent needs no lookup');
  assert.equal(await resolveAuditParent(manager, { table: 'spend_amounts', recordId: VERSION, parent: { table: 'spend_items', id: 'nope' } }), null, 'an invalid explicit id is dropped');
}

async function testUnknownAndInvalid() {
  const { manager, queries } = versionManager();
  for (const table of ['spend_items', 'capex_items', 'contracts', 'auth', 'tasks']) {
    assert.equal(await resolveAuditParent(manager, { table, recordId: LINE, after: { spend_item_id: LINE } }), null, `${table} has no parent`);
  }
  assert.equal(queries.length, 0, 'a label without a rule reads nothing');

  // A payload value that is not a uuid, an array, a null, or a missing record: no parent.
  assert.equal(await resolveAuditParent(manager, { table: 'spend_links', recordId: OTHER, after: { spend_item_id: 'not-a-uuid' } }), null);
  assert.equal(await resolveAuditParent(manager, { table: 'spend_links', after: ['array'] }), null);
  assert.equal(await resolveAuditParent(manager, { table: 'application_spend_items', parent: { table: 'spend_items', id: 'not-a-uuid' } }), null);
  assert.equal(await resolveAuditParent(manager, { table: 'spend_versions', recordId: null }), null);
  assert.equal(await resolveAuditParent(manager, { table: 'spend_round_inputs', after: { version_id: 'abc' } }), null);
  assert.equal(isAuditUuid(LINE), true);
  assert.equal(isAuditUuid('abc'), false);
  assert.equal(isAuditUuid(null), false);
}

const MIGRATION_TEXT = () => fs.readFileSync(backendPath('src', 'migrations', '1855500000000-audit-log-parent-record.ts'), 'utf8');

/** The sorted unique quoted labels of one block of the migration, found by `pattern`. */
function quotedLabels(block: string | undefined, what: string): string[] {
  assert.ok(block, `the migration declares ${what} in one block`);
  return Array.from(new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (match) => match[1]))).sort();
}

/** The labels of the migration's `LABELS` block: the write rules. */
function migrationLabels(): string[] {
  return quotedLabels(/const LABELS = \{([\s\S]*?)\n\} as const;/.exec(MIGRATION_TEXT())?.[1], 'its rule labels');
}

/** The labels of `LINE_RECORD_LABELS`: the links filled only when `record_id` is a line. */
function migrationLineRecordLabels(): string[] {
  return quotedLabels(/const LINE_RECORD_LABELS = \[([^\]]*)\]/.exec(MIGRATION_TEXT())?.[1], 'its line-record labels');
}

function testMigrationLabelsMatchRules() {
  // The frozen budget migration covers the budget-line rules only; the supplier family copies its
  // own rule in its migration (`audit-log-supplier-contact-parents` spec).
  const spendItemLabels = Object.entries(AUDIT_PARENT_RULES)
    .filter(([, rule]) => rule.parentTable === 'spend_items')
    .map(([label]) => label)
    .sort();
  // `spend_tasks` left the rules (the line reads the `tasks` row the same call writes): the frozen
  // migration still names it, and the rows it filled are not read.
  assert.deepEqual(
    migrationLabels().filter((label) => label !== 'spend_tasks'),
    spendItemLabels,
    'the migration and the line write rules cover the same labels',
  );
  // The links the backfill fills by `record_id` are the explicit-parent labels, minus the asset
  // links whose `record_id` is the asset, and minus the contract, project and request links added
  // by correctifs C: their old rows stay without parent (the payload cannot choose the line
  // safely), so they must not enter the backfill.
  const explicit = RECORD_HISTORY.spend_items.explicitParentLabels
    .filter((label) => !label.startsWith('asset_'))
    .filter((label) => !label.startsWith('contract_'))
    .filter((label) => !label.startsWith('portfolio_project_'))
    .filter((label) => !label.startsWith('portfolio_request_'))
    .sort();
  assert.deepEqual(migrationLineRecordLabels(), explicit, 'the backfill reads record_id for the line-side link labels only');
  for (const label of ['contract_spend_items', 'contract_capex_items', 'portfolio_project_opex', 'portfolio_project_capex', 'portfolio_request_opex', 'portfolio_request_capex']) {
    assert.ok(!migrationLineRecordLabels().includes(label), `${label}: no backfill of existing rows`);
  }
  for (const [label, rule] of Object.entries(AUDIT_PARENT_RULES)) {
    for (const table of auditParentRuleTables(rule)) {
      assert.ok(Object.prototype.hasOwnProperty.call(RECORD_HISTORY, table), `${label}: a record table of the inventory`);
    }
    if (!spendItemLabels.includes(label)) continue;
    assert.equal(rule.parentTable, 'spend_items', `${label}: the physical line table`);
  }
  assert.equal(AUDIT_PARENT_RULES.spend_items, undefined);
  assert.equal(AUDIT_PARENT_RULES.capex_items, undefined);
  assert.deepEqual(payloadParentId({ keys: ['spend_item_id', 'capex_item_id'] }, { capex_item_id: LINE }, null), LINE);
}

async function run() {
  await testPayloadRules();
  await testLinkLabelsHaveNoRule();
  testSingleChangedId();
  await testVersionRules();
  await testExplicitParentWins();
  await testUnknownAndInvalid();
  testMigrationLabelsMatchRules();
  console.log('audit-parent-rules.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
