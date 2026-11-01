import { DataSource } from 'typeorm';
import { resolveSeedLanguage, SeedLanguage } from '../analytics/recommended-dimensions.seed';
import { DefaultChartOutcome, TenantBaselineService } from './tenant-baseline.service';
import { TenantsService } from './tenants.service';

const DEFAULT_CHART_LOG: Record<DefaultChartOutcome, string> = {
  provisioned: 'Default chart of accounts created',
  skipped: 'Default chart of accounts not created: no global template is marked to load by default',
  failed: 'Default chart of accounts not created: provisioning failed (see the warning above)',
};

/**
 * The language of the recommended dimensions a single-tenant installation starts with:
 * `DEFAULT_TENANT_LANGUAGE` (en, fr, de or es; a locale such as `fr-FR` counts), English otherwise.
 * Read at the first start only, then stored with the tenant.
 */
export function defaultTenantLanguage(env: NodeJS.ProcessEnv = process.env): SeedLanguage {
  return resolveSeedLanguage(env.DEFAULT_TENANT_LANGUAGE);
}

/**
 * First start of a single-tenant installation: creates the tenant when no tenant has its slug
 * yet, with the tenant defaults (the recommended dimensions in `language`, from
 * `DEFAULT_TENANT_LANGUAGE`), the default global chart of accounts (the one a cloud tenant
 * receives at activation) and the starting technologies and portfolio classification, in one transaction. An existing installation is never changed.
 * Returns whether the tenant was created.
 */
export async function createSingleTenantOnFirstStart(
  dataSource: DataSource,
  tenants: TenantsService,
  baseline: TenantBaselineService,
  params: { slug: string; name: string; language?: SeedLanguage },
): Promise<boolean> {
  const existing = await dataSource.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [params.slug]);
  if (existing?.[0]) return false;
  const chart = await dataSource.transaction(async (manager) => {
    const tenant = await tenants.createTenant(params, { manager });
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
    const outcome = await baseline.provisionDefaultGlobalCoa(manager);
    await baseline.adoptStartingTechnologies(manager, tenant.id, params.language);
    await baseline.seedStartingClassification(manager, tenant.id, params.language);
    return outcome;
  });
  // eslint-disable-next-line no-console
  (chart === 'provisioned' ? console.log : console.warn)(`[on-prem] ${DEFAULT_CHART_LOG[chart]}`);
  return true;
}
