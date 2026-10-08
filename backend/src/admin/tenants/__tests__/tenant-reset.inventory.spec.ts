import * as assert from 'node:assert/strict';
import { TENANT_SCOPED_TABLES } from '../../../common/tenant-isolation.inventory';
import { TENANT_PURGE_TABLES } from '../tenant-purge.inventory';
import {
  TENANT_RESET_KEEP_TABLES,
  TENANT_RESET_PURGE_TABLES,
  validateTenantResetConfiguration,
} from '../tenant-reset.inventory';

// The reset to the post-activation state either keeps or purges every tenant table: a new
// tenant-scoped table fails here until it is placed on one side.

const EXPECTED_KEEP = [
  'subscriptions',
  'roles',
  'role_permissions',
  'users',
  'user_roles',
  'user_page_roles',
  'refresh_tokens',
  'password_reset_tokens',
  'user_notification_preferences',
  'user_dashboard_config',
  'ai_settings',
  'ai_api_keys',
  'ai_model_configs',
  'ai_external_mcp_servers',
  'ai_external_mcp_tool_snapshots',
  'audit_log',
];

function testConfigurationCoversEveryTenantTable() {
  assert.deepEqual(validateTenantResetConfiguration(), []);
  const covered = new Set([...Object.keys(TENANT_RESET_KEEP_TABLES), ...TENANT_RESET_PURGE_TABLES]);
  assert.deepEqual([...covered].sort(), [...TENANT_SCOPED_TABLES].sort());
}

function testKeptTablesAndReasons() {
  assert.deepEqual(Object.keys(TENANT_RESET_KEEP_TABLES).sort(), [...EXPECTED_KEEP].sort());
  for (const [table, reason] of Object.entries(TENANT_RESET_KEEP_TABLES)) {
    assert.ok(reason.trim().length > 0, `${table} has a reason`);
  }
}

function testPurgeKeepsThePurgeOrder() {
  const keep = new Set(Object.keys(TENANT_RESET_KEEP_TABLES));
  assert.deepEqual([...TENANT_RESET_PURGE_TABLES], TENANT_PURGE_TABLES.filter((table) => !keep.has(table)));
}

function testValidatorCatchesGaps() {
  // A tenant-scoped table on neither side, a kept table outside the inventory, a kept table
  // without a reason: each one is reported.
  const scoped = TENANT_SCOPED_TABLES as unknown as string[];
  const keep = TENANT_RESET_KEEP_TABLES as Record<string, string>;
  scoped.push('reset_spec_new_table');
  try {
    assert.match(validateTenantResetConfiguration().join('\n'), /neither keeps nor purges tenant-scoped table reset_spec_new_table/);
  } finally {
    scoped.pop();
  }
  keep.reset_spec_unknown = 'A table the inventory does not know.';
  try {
    assert.match(validateTenantResetConfiguration().join('\n'), /keeps reset_spec_unknown, which is not a tenant-scoped table/);
  } finally {
    delete keep.reset_spec_unknown;
  }
  const savedReason = keep.audit_log;
  keep.audit_log = ' ';
  try {
    assert.match(validateTenantResetConfiguration().join('\n'), /keeps audit_log without a reason/);
  } finally {
    keep.audit_log = savedReason;
  }
  assert.deepEqual(validateTenantResetConfiguration(), []);
}

function run() {
  testConfigurationCoversEveryTenantTable();
  testKeptTablesAndReasons();
  testPurgeKeepsThePurgeOrder();
  testValidatorCatchesGaps();
  console.log('tenant-reset.inventory.spec: ok');
}

run();
