import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../../common/__tests__/backend-root';
import { TENANT_SCOPED_TABLES } from '../../../common/tenant-isolation.inventory';
import { TENANT_PURGE_ATTACHMENT_TABLES } from '../tenant-purge.inventory';

// The operator's tenant export (scripts/tenant-export.sh) either exports or excludes, with a
// reason, every tenant-scoped table: a new tenant table fails here until it is placed on one side.
// The script keeps its own lists (bash and psql only on the servers); this spec keeps them equal
// to the inventory.

const EXPORT_SCRIPT = path.join(backendPath(), '..', 'scripts', 'tenant-export.sh');

const TABLE_NAME = /^[a-z][a-z0-9_]*$/;
const REASON_ENTRY = /^\[([a-z][a-z0-9_]*)\]="([^"]*)"$/;

type ParsedArray = { entries: string[]; reasons: Record<string, string>; failures: string[] };

/** Reads one bash array of the script: `NAME=(` (or `declare -A NAME=(`) up to a line `)`. */
function readArray(script: string, name: string, kind: 'list' | 'reasons'): ParsedArray {
  const lines = script.split('\n');
  const opening = kind === 'list' ? `${name}=(` : `declare -A ${name}=(`;
  const start = lines.findIndex((line) => line.trim() === opening);
  const result: ParsedArray = { entries: [], reasons: {}, failures: [] };
  if (start < 0) {
    result.failures.push(`tenant export script has no ${name} list (a line "${opening}")`);
    return result;
  }
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === ')') return result;
    if (!line || line.startsWith('#')) continue;
    if (kind === 'list') {
      if (TABLE_NAME.test(line)) result.entries.push(line);
      else result.failures.push(`${name} has an unreadable line: ${line}`);
    } else {
      const match = REASON_ENTRY.exec(line);
      if (!match) {
        result.failures.push(`${name} has an unreadable line: ${line}`);
        continue;
      }
      result.entries.push(match[1]);
      result.reasons[match[1]] = match[2];
    }
  }
  result.failures.push(`${name} is not closed by a line ")"`);
  return result;
}

/** True when the script loops over every entry of the list (its keys for an associative array). */
function walksThrough(script: string, name: string, keys = false): boolean {
  const expansion = keys ? `"\\$\\{!${name}\\[@\\]\\}"` : `"\\$\\{${name}\\[@\\]\\}"`;
  return new RegExp(`^\\s*for [a-z_]+ in ${expansion}; do\\s*$`, 'm').test(script);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function validateTenantExportScript(
  script: string,
  scopedTables: readonly string[] = TENANT_SCOPED_TABLES,
  attachmentTables: readonly string[] = TENANT_PURGE_ATTACHMENT_TABLES,
): string[] {
  const exported = readArray(script, 'TENANT_TABLES', 'list');
  const excluded = readArray(script, 'EXCLUDED_TABLES', 'reasons');
  const attachments = readArray(script, 'ATTACHMENT_TABLES', 'list');
  const failures = [...exported.failures, ...excluded.failures, ...attachments.failures];

  // A list only counts when the script uses it: the tables it exports, the files it lists and
  // the exclusions it writes to export-metadata.json.
  if (!walksThrough(script, 'TENANT_TABLES')) failures.push('tenant export does not loop over TENANT_TABLES');
  if (!walksThrough(script, 'ATTACHMENT_TABLES')) failures.push('tenant export does not loop over ATTACHMENT_TABLES');
  if (!walksThrough(script, 'EXCLUDED_TABLES', true)) failures.push('tenant export does not loop over EXCLUDED_TABLES');

  const scoped = new Set(scopedTables);
  const exportedSet = new Set(exported.entries);
  const excludedSet = new Set(excluded.entries);

  for (const table of duplicates(exported.entries)) failures.push(`tenant export lists ${table} twice`);
  for (const table of duplicates(excluded.entries)) failures.push(`tenant export excludes ${table} twice`);
  for (const table of duplicates(attachments.entries)) failures.push(`tenant export lists the files of ${table} twice`);

  for (const table of exportedSet) {
    if (!scoped.has(table)) failures.push(`tenant export exports ${table}, which is not a tenant-scoped table`);
    if (excludedSet.has(table)) failures.push(`tenant export both exports and excludes ${table}`);
  }
  for (const table of excludedSet) {
    if (!scoped.has(table)) failures.push(`tenant export excludes ${table}, which is not a tenant-scoped table`);
    if (!String(excluded.reasons[table] ?? '').trim()) failures.push(`tenant export excludes ${table} without a reason`);
  }
  for (const table of scoped) {
    if (!exportedSet.has(table) && !excludedSet.has(table)) {
      failures.push(`tenant export neither exports nor excludes tenant-scoped table ${table}`);
    }
  }

  const attachmentSet = new Set(attachments.entries);
  for (const table of attachmentTables) {
    if (!attachmentSet.has(table)) failures.push(`tenant export does not list the files of ${table}`);
  }
  for (const table of attachmentSet) {
    if (!attachmentTables.includes(table)) {
      failures.push(`tenant export lists the files of ${table}, which is not an attachment table`);
    }
    if (!exportedSet.has(table)) failures.push(`tenant export lists the files of ${table} without exporting it`);
  }

  return failures;
}

function readScript(): string {
  return fs.readFileSync(EXPORT_SCRIPT, 'utf8');
}

function testScriptCoversEveryTenantTable() {
  assert.deepEqual(validateTenantExportScript(readScript()), []);
}

function testDerivedAndShortLivedTablesStayOut() {
  // Rebuilt by tenant-import.sh or meaningless on another installation.
  const script = readScript();
  const excluded = readArray(script, 'EXCLUDED_TABLES', 'reasons').entries;
  for (const table of [
    'refresh_tokens',
    'password_reset_tokens',
    'search_index',
    'spend_version_totals',
    'capex_version_totals',
  ]) {
    assert.ok(excluded.includes(table), `${table} is excluded from the tenant export`);
  }
}

function testValidatorReportsGaps() {
  const script = readScript();

  const withoutIncidents = script.replace(/^\s*incidents\n/m, '');
  assert.notEqual(withoutIncidents, script);
  assert.match(
    validateTenantExportScript(withoutIncidents).join('\n'),
    /neither exports nor excludes tenant-scoped table incidents/,
  );

  const withUnknownTable = script.replace(/^TENANT_TABLES=\($/m, 'TENANT_TABLES=(\n  export_spec_unknown');
  assert.match(
    validateTenantExportScript(withUnknownTable).join('\n'),
    /exports export_spec_unknown, which is not a tenant-scoped table/,
  );

  const withEmptyReason = script.replace(/^(\s*\[refresh_tokens\]=)"[^"]*"$/m, '$1""');
  assert.notEqual(withEmptyReason, script);
  assert.match(validateTenantExportScript(withEmptyReason).join('\n'), /excludes refresh_tokens without a reason/);

  assert.match(
    validateTenantExportScript(script, [...TENANT_SCOPED_TABLES, 'export_spec_new_table']).join('\n'),
    /neither exports nor excludes tenant-scoped table export_spec_new_table/,
  );
  assert.match(
    validateTenantExportScript(script, TENANT_SCOPED_TABLES, [...TENANT_PURGE_ATTACHMENT_TABLES, 'export_spec_files']).join('\n'),
    /does not list the files of export_spec_files/,
  );
  assert.match(validateTenantExportScript('#!/usr/bin/env bash\n').join('\n'), /has no TENANT_TABLES list/);
}

function testValidatorReportsUnusedLists() {
  const script = readScript();
  for (const [name, expansion] of [
    ['TENANT_TABLES', '"${TENANT_TABLES[@]}"'],
    ['ATTACHMENT_TABLES', '"${ATTACHMENT_TABLES[@]}"'],
    ['EXCLUDED_TABLES', '"${!EXCLUDED_TABLES[@]}"'],
  ]) {
    const loop = new RegExp(`^(\\s*for [a-z_]+ in )${expansion.replace(/[$!{}[\]@]/g, '\\$&')}; do$`, 'm');
    assert.match(script, loop, `the script loops over ${name}`);
    const unused = script.replace(loop, '$1accounts; do');
    assert.notEqual(unused, script);
    assert.match(
      validateTenantExportScript(unused).join('\n'),
      new RegExp(`does not loop over ${name}`),
      `a script that no longer loops over ${name} is reported`,
    );
  }
}

function run() {
  testScriptCoversEveryTenantTable();
  testDerivedAndShortLivedTablesStayOut();
  testValidatorReportsGaps();
  testValidatorReportsUnusedLists();
  console.log('tenant-export-coverage.spec: ok');
}

run();
