import { DataSource } from 'typeorm';
import { DefaultChartOutcome, TenantBaselineService } from './tenant-baseline.service';
import { TenantsService } from './tenants.service';

const DEFAULT_CHART_LOG: Record<DefaultChartOutcome, string> = {
  provisioned: 'Default chart of accounts created',
  skipped: 'Default chart of accounts not created: no global template is marked to load by default',
  failed: 'Default chart of accounts not created: provisioning failed (see the warning above)',
};

/**
 * First start of a single-tenant installation: creates the tenant when no tenant has its slug
 * yet, with the tenant defaults and the default global chart of accounts (the one a cloud tenant
 * receives at activation), in one transaction. An existing installation is never changed.
 * Returns whether the tenant was created.
 */
export async function createSingleTenantOnFirstStart(
  dataSource: DataSource,
  tenants: TenantsService,
  baseline: TenantBaselineService,
  params: { slug: string; name: string },
): Promise<boolean> {
  const existing = await dataSource.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [params.slug]);
  if (existing?.[0]) return false;
  const chart = await dataSource.transaction(async (manager) => {
    const tenant = await tenants.createTenant(params, { manager });
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
    return baseline.provisionDefaultGlobalCoa(manager);
  });
  // eslint-disable-next-line no-console
  (chart === 'provisioned' ? console.log : console.warn)(`[on-prem] ${DEFAULT_CHART_LOG[chart]}`);
  return true;
}
