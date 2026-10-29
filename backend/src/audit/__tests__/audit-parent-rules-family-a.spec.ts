import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { AUDIT_PARENT_RULES } from '../audit-parent-rules';
import { RECORD_HISTORY } from '../record-history.inventory';

// The parent rules of family A (companies, departments, analytics dimensions) are copied in SQL by
// migration `1855700000000`: a migration is frozen and must not import the module. This spec reads
// the migration's RULES block and checks that both lists agree, label by label and key by key.

const FAMILY_PARENTS = new Set(['analytics_axes', 'companies', 'departments']);

const MIGRATION = () => fs.readFileSync(
  backendPath('src', 'migrations', '1855700000000-audit-log-parent-family-a.ts'),
  'utf8',
);

type Triple = { label: string; parentTable: string; payloadKey: string };

function migrationRules(): Triple[] {
  const block = /const RULES: readonly Rule\[\] = \[([\s\S]*?)\n\];/.exec(MIGRATION())?.[1];
  assert.ok(block, 'the migration declares its RULES block');
  return Array.from(
    block.matchAll(/\{ label: '([a-z_]+)', parentTable: '([a-z_]+)', payloadKey: '([a-z_]+)' \}/g),
    (match) => ({ label: match[1], parentTable: match[2], payloadKey: match[3] }),
  );
}

function expectedRules(): Triple[] {
  const rules: Triple[] = [];
  for (const [label, rule] of Object.entries(AUDIT_PARENT_RULES)) {
    if (!rule.parentTable || !FAMILY_PARENTS.has(rule.parentTable)) continue;
    assert.equal(rule.from, 'payload', `${label}: familles A rules read the payload`);
    assert.equal(rule.keys.length, 1, `${label}: one payload key`);
    rules.push({ label, parentTable: rule.parentTable, payloadKey: rule.keys[0] });
  }
  return rules;
}

function sortRules(rules: Triple[]): Triple[] {
  return rules.slice().sort((a, b) => a.label.localeCompare(b.label));
}

function run() {
  const expected = sortRules(expectedRules());
  const migrated = sortRules(migrationRules());
  assert.deepEqual(migrated, expected, 'the migration and the write rules cover the same labels and keys');

  // Each rule is a child of its parent's record, with the kind its history shows.
  for (const rule of expected) {
    const parent = RECORD_HISTORY[rule.parentTable as keyof typeof RECORD_HISTORY];
    assert.ok(parent, `${rule.label}: ${rule.parentTable} is a record table`);
    assert.ok(
      (parent.children as Record<string, string>)[rule.label],
      `${rule.label}: a child of ${rule.parentTable}`,
    );
  }

  const text = MIGRATION();
  assert.equal((text.match(/^export /gm) ?? []).length, 1, 'the file exports its migration class only');
  assert.match(text, /export class AuditLogParentFamilyA1855700000000 implements MigrationInterface/);
  assert.match(text, /set_config\('app\.current_tenant'/);
  assert.doesNotMatch(text, /ROW LEVEL SECURITY|row_security/i, 'the migration never touches RLS');
  assert.match(text, /const BATCH_SIZE = 50000;/);
  console.log('  family A parent rules and migration 1855700000000 agree: OK');
  console.log('audit-parent-rules-family-a.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
