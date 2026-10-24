import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateTenantPurgeConfiguration } from '../src/admin/tenants/tenant-purge.inventory';
import { assertSafeDatabaseRole } from '../src/common/database-role-safety';
import { EXEMPT_TABLES, TENANT_SCOPED_TABLES } from '../src/common/tenant-isolation.inventory';

type TenantScopedClassification = {
  kind: 'tenant_scoped';
};

type ExemptClassification = {
  kind: 'exempt';
  reason: string;
};

type TableClassification = TenantScopedClassification | ExemptClassification;

type TenantTableRow = {
  table_name: string;
  rls_enabled: boolean | 't' | 'f';
  force_rls: boolean | 't' | 'f';
};

type PolicyRow = {
  tablename: string;
  policyname: string;
  has_using: boolean | 't' | 'f';
  has_with_check: boolean | 't' | 'f';
};

function toBoolean(value: boolean | 't' | 'f'): boolean {
  return value === true || value === 't';
}

function canonicalPolicyName(table: string): string {
  return `${table}_tenant_isolation`;
}

function formatNames(names: string[]): string {
  return names.length === 0 ? 'no policies' : names.join(', ');
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function buildClassifications(): Map<string, TableClassification> {
  const classifications = new Map<string, TableClassification>();

  for (const table of TENANT_SCOPED_TABLES) {
    if (classifications.has(table)) {
      throw new Error(`Duplicate tenant isolation classification for ${table}`);
    }
    classifications.set(table, { kind: 'tenant_scoped' });
  }

  for (const [table, reason] of Object.entries(EXEMPT_TABLES)) {
    if (classifications.has(table)) {
      throw new Error(`Duplicate tenant isolation classification for ${table}`);
    }
    classifications.set(table, { kind: 'exempt', reason });
  }

  return classifications;
}

async function loadTenantTables(ds: DataSource): Promise<Map<string, TenantTableRow>> {
  const rows = await ds.query(
    `SELECT cols.table_name,
            cls.relrowsecurity AS rls_enabled,
            cls.relforcerowsecurity AS force_rls
     FROM information_schema.columns cols
     JOIN information_schema.tables tbl
       ON tbl.table_schema = cols.table_schema
      AND tbl.table_name = cols.table_name
      AND tbl.table_type = 'BASE TABLE'
     JOIN pg_namespace ns
       ON ns.nspname = cols.table_schema
     JOIN pg_class cls
       ON cls.relnamespace = ns.oid
      AND cls.relname = cols.table_name
     WHERE cols.table_schema = 'public'
       AND cols.column_name = 'tenant_id'
     ORDER BY cols.table_name`,
  ) as TenantTableRow[];

  return new Map(rows.map((row) => [row.table_name, row]));
}

async function loadPolicies(ds: DataSource): Promise<Map<string, PolicyRow[]>> {
  const rows = await ds.query(
    `SELECT tablename,
            policyname,
            qual IS NOT NULL AS has_using,
            with_check IS NOT NULL AS has_with_check
     FROM pg_policies
     WHERE schemaname = 'public'
       -- Tenant policies target PUBLIC; the data-access policies (kanap_data_limited only, spec
       -- §6.4) are checked by data-access/__tests__/data-access-tables-inventory.spec.ts.
       AND roles = '{public}'::name[]
     ORDER BY tablename, policyname`,
  ) as PolicyRow[];

  const policiesByTable = new Map<string, PolicyRow[]>();
  for (const row of rows) {
    const existing = policiesByTable.get(row.tablename) ?? [];
    existing.push(row);
    policiesByTable.set(row.tablename, existing);
  }

  return policiesByTable;
}

function auditTenantScopedTable(table: string, tableState: TenantTableRow, policies: PolicyRow[]): string[] {
  const failures: string[] = [];
  const expectedPolicyName = canonicalPolicyName(table);
  const policyNames = policies.map((policy) => policy.policyname).sort();

  if (!toBoolean(tableState.rls_enabled)) {
    failures.push(`${table}: RLS is not enabled`);
  }

  if (!toBoolean(tableState.force_rls)) {
    failures.push(`${table}: FORCE RLS is not enabled`);
  }

  if (policyNames.length !== 1 || policyNames[0] !== expectedPolicyName) {
    failures.push(
      `${table}: expected exactly one policy named ${expectedPolicyName}; found ${formatNames(policyNames)}`,
    );
  }

  const canonicalPolicy = policies.find((policy) => policy.policyname === expectedPolicyName);
  if (!canonicalPolicy) {
    return failures;
  }

  if (!toBoolean(canonicalPolicy.has_using)) {
    failures.push(`${table}: canonical policy ${expectedPolicyName} is missing USING`);
  }

  if (!toBoolean(canonicalPolicy.has_with_check)) {
    failures.push(`${table}: canonical policy ${expectedPolicyName} is missing WITH CHECK`);
  }

  return failures;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(2);
  }

  const ds = new DataSource({ type: 'postgres', url, ssl: false } as any);
  await ds.initialize();
  const roleState = await assertSafeDatabaseRole(ds, 'Tenant isolation audit');
  console.log(`[Tenant Isolation Audit] Connected as PostgreSQL role "${roleState.currentUser}" with native RLS enforcement`);
  let exitCode = 0;

  try {
    const classifications = buildClassifications();
    const tenantTables = await loadTenantTables(ds);
    const policiesByTable = await loadPolicies(ds);

    const failures: string[] = [];
    const exemptSummaries: string[] = [];
    let tenantScopedCount = 0;
    let exemptCount = 0;

    failures.push(...validateTenantPurgeConfiguration());

    for (const [table, tableState] of tenantTables.entries()) {
      const classification = classifications.get(table);
      if (!classification) {
        failures.push(`${table}: missing explicit tenant isolation classification`);
        continue;
      }

      if (classification.kind === 'exempt') {
        exemptCount += 1;
        exemptSummaries.push(`${table}: ${classification.reason}`);
        continue;
      }

      tenantScopedCount += 1;
      const policies = policiesByTable.get(table) ?? [];
      failures.push(...auditTenantScopedTable(table, tableState, policies));
    }

    console.log(`Tenant isolation audit checked ${tenantTables.size} public ${pluralize(tenantTables.size, 'table', 'tables')} with tenant_id.`);
    console.log(`Tenant-scoped tables: ${tenantScopedCount}`);
    console.log(`Exempt tables: ${exemptCount}`);
    for (const exemptSummary of exemptSummaries) {
      console.log(`EXEMPT ${exemptSummary}`);
    }

    const staleClassifications = [...classifications.keys()].filter((table) => !tenantTables.has(table));
    for (const table of staleClassifications) {
      console.log(`NOTE classification entry has no matching public tenant_id table: ${table}`);
    }

    if (failures.length > 0) {
      console.error(`Tenant isolation audit failed with ${failures.length} ${pluralize(failures.length, 'issue', 'issues')}:`);
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      exitCode = 1;
    } else {
      console.log('Tenant isolation audit passed.');
    }
  } finally {
    await ds.destroy();
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main().catch((error) => {
  console.error('Tenant isolation audit crashed');
  console.error(error);
  process.exit(1);
});
