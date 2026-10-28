import * as assert from 'node:assert/strict';
import { AUDIT_PARENT_RULES } from '../audit-parent-rules';
import { DATA_ACCESS_TABLES } from '../../data-access/data-access-tables.inventory';
import { RESOURCES } from '../../permissions/permissions.service';
import {
  RECORD_HISTORY,
  recordHistoryChildKind,
  recordHistoryModules,
} from '../record-history.inventory';
import { FAMILY_KEYS, FAMILY_MODULES } from '../record-history.service';
import { RECORD_HISTORY_TABLES } from '../../../../frontend/src/components/history/recordHistoryTables';

// The inventory of record histories (lot 1B): the entries, the parent rules and the data-access
// tables of the line family agree both ways. A record family added later without its child rules,
// or a data-access table that follows a line without a history or an exclusion, fails here.

function testEntries() {
  const entries = Object.values(RECORD_HISTORY);
  assert.ok(entries.length > 0, 'the inventory declares a record');
  let childReads = 0;
  for (const [key, entry] of Object.entries(RECORD_HISTORY)) {
    assert.equal(key, entry.table, `${key}: the route key is the record table`);
    assert.ok((RESOURCES as readonly string[]).includes(entry.module), `${key}: ${entry.module} is a permission resource`);
    assert.equal(entry.level, 'reader', `${key}: opening the record's page is a read`);
    assert.deepEqual(entry.auditLabels, Array.from(new Set(entry.auditLabels)), `${key}: audit labels are unique`);
    assert.ok(entry.auditLabels.length > 0, `${key}: the record has an audit label`);
    assert.ok(FAMILY_KEYS.includes(entry.family), `${key}: ${entry.family} is a reference family`);
    assert.equal(entry.module, FAMILY_MODULES[entry.family], `${key}: the record module reads its reference family`);
    assert.ok(entry.exclusions.every((exclusion) => exclusion.reason.trim().length > 0), `${key}: an exclusion has its reason`);
    assert.ok(entry.explicitParentLabels.every((label) => recordHistoryChildKind(entry, label) !== null), `${key}: an explicit parent is a child label`);
    for (const label of Object.keys(entry.children)) {
      assert.ok(!entry.auditLabels.includes(label), `${key}: ${label} is not both the record's own label and a child`);
    }
    for (const [label, mode] of Object.entries(entry.childReads ?? {})) {
      assert.ok(recordHistoryChildKind(entry, label) !== null, `${key}: childReads.${label} is a child label`);
      if (mode !== 'record') {
        assert.equal(typeof mode.payloadKey, 'string', `${key}: childReads.${label} names a payload key`);
        assert.match(mode.payloadKey, /^[a-z_]+$/, `${key}: childReads.${label} payload key is a plain identifier`);
      }
      childReads += 1;
    }
  }
  assert.deepEqual(recordHistoryModules(), ['accounts', 'budget', 'cost_centers', 'infrastructure'], 'the modules of the route guard');
  // Every reference family has a reader module (people are the only exception, `null`), and the
  // module is a permission resource: a family declared ahead of its record page is already checked.
  for (const family of FAMILY_KEYS) {
    const module = FAMILY_MODULES[family];
    assert.ok(
      module === null || (RESOURCES as readonly string[]).includes(module),
      `${family}: ${module} is a permission resource`,
    );
  }
  console.log(`  ${entries.length} record entries, ${childReads} child read modes, ${FAMILY_KEYS.length} families with a module: OK`);
}

/** The frontend declares the tables whose page shows a history; the two lists are one set. */
function testFrontendTables() {
  assert.deepEqual(
    [...RECORD_HISTORY_TABLES].sort(),
    Object.keys(RECORD_HISTORY).sort(),
    'the frontend record tables and the backend inventory are the same set',
  );
  console.log(`  ${RECORD_HISTORY_TABLES.length} frontend tables match the inventory: OK`);
}

function testParentRulesAgree() {
  const children = new Set<string>();
  const explicit = new Set<string>();
  for (const entry of Object.values(RECORD_HISTORY)) {
    for (const label of Object.keys(entry.children)) children.add(label);
    for (const label of entry.explicitParentLabels) explicit.add(label);
  }

  // Every child has a rule, its write hands the record as an explicit parent, or its rows name the
  // record in `record_id` (the `record` read mode, where `parent_*` is not needed).
  for (const entry of Object.values(RECORD_HISTORY)) {
    for (const label of Object.keys(entry.children)) {
      if (entry.childReads?.[label] === 'record') continue;
      if (explicit.has(label)) {
        assert.equal(AUDIT_PARENT_RULES[label], undefined, `${label}: an explicit parent carries no label rule`);
        continue;
      }
      assert.ok(AUDIT_PARENT_RULES[label], `${label}: a child label needs a parent rule (or explicitParentLabels)`);
    }
  }
  // Every rule is a child of a declared record: a rule whose rows no history reads would be dead.
  for (const [label, rule] of Object.entries(AUDIT_PARENT_RULES)) {
    assert.ok(Object.prototype.hasOwnProperty.call(RECORD_HISTORY, rule.parentTable), `${label}: ${rule.parentTable} is a record table`);
    assert.ok(children.has(label), `${label}: a parent rule outside the inventory's children`);
    assert.ok(
      Object.values(RECORD_HISTORY).some((entry) => recordHistoryChildKind(entry, label) !== null),
      `${label}: a child kind`,
    );
  }
  console.log(`  ${children.size} child labels, ${Object.keys(AUDIT_PARENT_RULES).length} parent rules: OK`);
}

function testDataAccessTablesAreDeclared() {
  const followed = DATA_ACCESS_TABLES
    .filter((table) => table.cls === 'follows_line' || table.cls === 'link_to_line')
    .map((table) => table.table)
    .sort();
  const declared = new Set<string>();
  for (const entry of Object.values(RECORD_HISTORY)) {
    for (const label of Object.keys(entry.children)) {
      // The OPEX label is the physical table name; the CAPEX labels rename the same tables
      // (`auditTableOf`, budget-nature.ts), which the data-access inventory lists once.
      declared.add(label);
    }
    for (const exclusion of entry.exclusions) declared.add(exclusion.table);
  }
  const missing = followed.filter((table) => !declared.has(table));
  assert.deepEqual(missing, [], 'every follows_line and link_to_line table is a child or an exclusion');
  const dataAccess = new Map(DATA_ACCESS_TABLES.map((table) => [table.table, table]));
  for (const entry of Object.values(RECORD_HISTORY)) {
    for (const exclusion of entry.exclusions) {
      const table = dataAccess.get(exclusion.table);
      // A family may also exclude a table it follows outside the data-access inventory (an asset's
      // application assignments, an incident's links). A scoped table may only be excluded when it
      // follows or links to a line.
      if (!table) continue;
      assert.ok(
        table.cls === 'follows_line' || table.cls === 'link_to_line',
        `${exclusion.table}: an exclusion of a scoped table is a follows_line or link_to_line table`,
      );
    }
  }
  console.log(`  ${followed.length} follows_line/link_to_line tables declared: OK`);
}

function run() {
  console.log('record history inventory');
  testEntries();
  testFrontendTables();
  testParentRulesAgree();
  testDataAccessTablesAreDeclared();
  console.log('record-history-inventory.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
