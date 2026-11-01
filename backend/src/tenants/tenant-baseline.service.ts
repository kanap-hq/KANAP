import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ChartOfAccountsService } from '../accounts/chart-of-accounts.service';
import { CompaniesService } from '../companies/companies.service';
import { StatusState } from '../common/status';
import { withSavepoint } from '../common/savepoint.util';
import { SeedLanguage, tenantSeedLanguage } from '../analytics/recommended-dimensions.seed';
import { ensureStartingPortfolioClassification } from '../portfolio/starting-classification.seed';
import { TechnologyCatalogService } from '../technologies/catalog/technology-catalog.service';
import { TenantsService } from './tenants.service';

/** What happened to the default global chart of accounts: created, no template to create it from, or failed. */
export type DefaultChartOutcome = 'provisioned' | 'skipped' | 'failed';

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
 * Base currency of the starting company, from its country. Euro-area members use EUR.
 * Any country not listed is left empty, for the user to choose.
 */
const STARTING_COMPANY_CURRENCY: Readonly<Record<string, string>> = {
  AT: 'EUR', BE: 'EUR', BG: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR', LV: 'EUR',
  MT: 'EUR', NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR',
  GB: 'GBP',
  CH: 'CHF',
  US: 'USD',
};

/** ISO 4217 code for the country, or null when the map has none. Blank and unknown codes are null. */
export function baseCurrencyForCountry(countryIso: string | null | undefined): string | null {
  const code = (countryIso ?? '').trim().toUpperCase();
  if (!code) return null;
  return STARTING_COMPANY_CURRENCY[code] ?? null;
}

/**
 * Stored city of a starting company. The column is NOT NULL and company creation refuses a blank
 * city, so this placeholder stays. The company record and the companies list do not show it
 * (`displayedCompanyCity` in the frontend).
 */
export const STARTING_COMPANY_CITY = 'Unknown';

/**
 * Catalog keys of the technologies a workspace starts with: almost every IT estate runs them, and
 * an empty technology list reads as a broken screen. The catalog gives them their CPE
 * identifiers (end of support and vulnerability feeds) and leaves their vulnerability alerts off,
 * as for any operating system.
 */
export const STARTING_TECHNOLOGY_KEYS = ['windows-server', 'ubuntu'] as const;

/**
 * The state of a tenant right after a trial activation, apart from its users and subscription:
 * the tenant defaults (TenantsService.seedTenantDefaults), the default global chart of accounts,
 * the starting company with its standard calendar, the starting technologies and the starting
 * portfolio classification. Trial activation, the reset to that state
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
    private readonly technologyCatalog: TechnologyCatalogService,
  ) {}

  /**
   * The tenant defaults, then the default global chart of accounts, then the starting company,
   * then the starting technologies and portfolio classification.
   * `language` names the seeded dimensions (English when absent). Returns what happened to the
   * chart of accounts.
   */
  async ensureBaseline(
    manager: EntityManager,
    tenantId: string,
    company: StartingCompany,
    opts?: { language?: SeedLanguage },
  ): Promise<{ chartOfAccounts: DefaultChartOutcome }> {
    await this.tenants.seedTenantDefaults(manager, tenantId, { language: opts?.language });
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const chartOfAccounts = await this.provisionDefaultGlobalCoa(manager);
    await this.createStartingCompany(manager, company);
    await this.adoptStartingTechnologies(manager, tenantId, opts?.language);
    await this.seedStartingClassification(manager, tenantId, opts?.language);
    return { chartOfAccounts };
  }

  /**
   * Adopts the `STARTING_TECHNOLOGY_KEYS` from the catalog (a technology already there is kept).
   * Under its own savepoint, like the chart of accounts: a failure is logged and leaves the
   * caller's transaction usable, so activation, reset and first start go on without them.
   */
  async adoptStartingTechnologies(manager: EntityManager, tenantId: string, language?: SeedLanguage): Promise<void> {
    try {
      await withSavepoint(manager, async () => {
        // The descriptions are written in the seed language.
        const descriptionLanguage = await this.seedLanguage(manager, tenantId, language);
        for (const key of STARTING_TECHNOLOGY_KEYS) {
          await this.technologyCatalog.adopt(key, { manager, tenantId, userId: null, language: descriptionLanguage, audit: { source: 'system' } });
        }
      });
    } catch (e) {
      console.warn('[provisioning] Starting technologies skipped:', (e as Error)?.message);
    }
  }

  /**
   * The starting request sources and categories of the portfolio, in the seed language
   * (`STARTING_PORTFOLIO_SOURCES`, `STARTING_PORTFOLIO_CATEGORIES`); a value of the same name is
   * kept. Under its own savepoint, logged and skipped on failure, like the technologies.
   */
  async seedStartingClassification(manager: EntityManager, tenantId: string, language?: SeedLanguage): Promise<void> {
    try {
      await withSavepoint(manager, async () => {
        await ensureStartingPortfolioClassification(manager, tenantId, await this.seedLanguage(manager, tenantId, language));
      });
    } catch (e) {
      console.warn('[provisioning] Starting portfolio classification skipped:', (e as Error)?.message);
    }
  }

  /** The language given, else the tenant's own seed language. */
  private async seedLanguage(manager: EntityManager, tenantId: string, language?: SeedLanguage): Promise<SeedLanguage> {
    if (language) return language;
    const [tenant] = await manager.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
    return tenantSeedLanguage(tenant?.metadata);
  }

  /**
   * Creates the tenant's chart of accounts from the single global template marked
   * loaded_by_default, set as the default and consolidation chart. Under its own savepoint: a
   * failure (a SQL error included) undoes the whole chart and leaves the caller's transaction
   * usable, so the caller (trial activation, reset, single-tenant first start) goes on without
   * it. Returns `provisioned`, `skipped` (no such template) or `failed` (logged, never thrown).
   */
  async provisionDefaultGlobalCoa(manager: EntityManager): Promise<DefaultChartOutcome> {
    try {
      return await withSavepoint(manager, async (): Promise<DefaultChartOutcome> => {
        const rows: Array<{ id: string; template_code: string; template_name: string }>
          = await manager.query(`SELECT id, template_code, template_name FROM coa_templates WHERE is_global = true AND loaded_by_default = true LIMIT 1`);
        const tmpl = rows?.[0];
        if (!tmpl) return 'skipped';
        // Create tenant CoA from a global template with GLOBAL scope (no country), not country-default
        const created = await this.coas.create({ code: tmpl.template_code, name: tmpl.template_name, scope: 'GLOBAL', is_default: false }, null, { manager });
        // Copy accounts into CoA
        await this.coas.loadTemplateIntoCoa(created.id, tmpl.id, { dryRun: false, userId: null, overwrite: true }, { manager });
        // Mark as global default and consolidation chart for the tenant
        await this.coas.setGlobalDefault(created.id, null, { manager });
        await this.coas.setConsolidation(created.id, null, { manager });
        return 'provisioned';
      });
    } catch (e) {
      // Swallow provisioning issues to not block tenant creation, but log
      console.warn('[provisioning] Default global CoA provisioning skipped:', (e as Error)?.message);
      return 'failed';
    }
  }

  /**
   * The starting company: it takes the default chart of accounts and creates its standard calendar.
   * The base currency follows the country. The city stays the placeholder `STARTING_COMPANY_CITY`.
   */
  async createStartingCompany(manager: EntityManager, company: StartingCompany) {
    await this.companies.create({
      name: company.companyName,
      country_iso: company.countryIso,
      city: STARTING_COMPANY_CITY,
      base_currency: baseCurrencyForCountry(company.countryIso),
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
