import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ChartOfAccountsService } from '../accounts/chart-of-accounts.service';
import { CompaniesService } from '../companies/companies.service';
import { StatusState } from '../common/status';
import { withSavepoint } from '../common/savepoint.util';
import { TenantsService } from './tenants.service';

/** The company a new tenant starts with, and the user recorded as its creator. */
export type StartingCompany = {
  companyName: string;
  countryIso: string;
  actorId: string | null;
};

/** The starting company's name from a trial sign-up: the organization name, else the slug, capitalized. */
export function buildStartingCompanyName(signup: { org_name?: string | null; slug?: string | null }): string {
  if (signup.org_name && signup.org_name.trim().length > 0) return signup.org_name.trim();
  const source = signup.slug ?? 'Tenant';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/**
 * The state of a tenant right after a trial activation, apart from its users and subscription:
 * the tenant defaults (TenantsService.seedTenantDefaults), the default global chart of accounts,
 * and the starting company with its standard calendar. Trial activation, the reset to that state
 * and the first start of a single-tenant installation share these steps.
 *
 * Every step runs on the given manager, inside the caller's transaction, with
 * `app.current_tenant` set to the tenant.
 */
@Injectable()
export class TenantBaselineService {
  constructor(
    private readonly tenants: TenantsService,
    private readonly coas: ChartOfAccountsService,
    private readonly companies: CompaniesService,
  ) {}

  /** The tenant defaults, then the default global chart of accounts, then the starting company. */
  async ensureBaseline(manager: EntityManager, tenantId: string, company: StartingCompany) {
    await this.tenants.seedTenantDefaults(manager, tenantId);
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await this.provisionDefaultGlobalCoa(manager);
    await this.createStartingCompany(manager, company);
  }

  // Create a tenant CoA from the single global template marked loaded_by_default, if present.
  // Under its own savepoint: a failure (a SQL error included) undoes the whole chart and leaves
  // the signup transaction usable, so tenant creation goes on without it.
  async provisionDefaultGlobalCoa(manager: EntityManager) {
    try {
      await withSavepoint(manager, async () => {
        const rows: Array<{ id: string; template_code: string; template_name: string }>
          = await manager.query(`SELECT id, template_code, template_name FROM coa_templates WHERE is_global = true AND loaded_by_default = true LIMIT 1`);
        const tmpl = rows?.[0];
        if (!tmpl) return;
        // Create tenant CoA from a global template with GLOBAL scope (no country), not country-default
        const created = await this.coas.create({ code: tmpl.template_code, name: tmpl.template_name, scope: 'GLOBAL', is_default: false }, null, { manager });
        // Copy accounts into CoA
        await this.coas.loadTemplateIntoCoa(created.id, tmpl.id, { dryRun: false, userId: null, overwrite: true }, { manager });
        // Mark as global default and consolidation chart for the tenant
        await this.coas.setGlobalDefault(created.id, null, { manager });
        await this.coas.setConsolidation(created.id, null, { manager });
      });
    } catch (e) {
      // Swallow provisioning issues to not block tenant creation, but log
      console.warn('[provisioning] Default global CoA provisioning skipped:', (e as Error)?.message);
    }
  }

  /** The starting company: it takes the default chart of accounts and creates its standard calendar. */
  async createStartingCompany(manager: EntityManager, company: StartingCompany) {
    await this.companies.create({
      name: company.companyName,
      country_iso: company.countryIso,
      city: 'Unknown',
      status: StatusState.ENABLED,
    }, company.actorId ?? undefined, { manager });
  }

  /**
   * The starting company of an existing tenant: from its trial sign-up when one exists for its
   * slug (as at activation), otherwise the tenant name in France.
   */
  async resolveStartingCompany(
    manager: EntityManager,
    tenant: { slug: string; name: string },
  ): Promise<{ companyName: string; countryIso: string }> {
    const rows: Array<{ org_name: string | null; slug: string; country_iso: string | null }> = await manager.query(
      `SELECT org_name, slug, country_iso FROM trial_signups WHERE slug = $1 LIMIT 1`,
      [tenant.slug],
    );
    const signup = rows?.[0];
    if (signup) {
      return { companyName: buildStartingCompanyName(signup), countryIso: signup.country_iso || 'FR' };
    }
    return { companyName: tenant.name, countryIso: 'FR' };
  }
}
