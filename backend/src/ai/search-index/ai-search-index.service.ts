import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';

/**
 * Maintains the denormalized `search_index` table (migration 1853000000000).
 *
 * Row triggers keep entries fresh when source rows change, but related-entity
 * renames (user display name, company name, …) are not trigger-cascaded:
 * this service is the freshness backstop. `reindexTenant` re-runs every
 * per-type `search_index_refresh_<type>()` SQL function for one tenant;
 * `reindexAllTenants` loops every tenant (daily scheduled task).
 *
 * Searchable fields per entity type live in the SQL refresh functions — see
 * the maintenance contract in 1853000000000-ai-search-index.ts.
 */

export const SEARCH_INDEX_ENTITY_TYPES = [
  'accounts',
  'analytics_categories',
  'applications',
  'assets',
  'business_processes',
  'capex_items',
  'chart_of_accounts',
  'companies',
  'connections',
  'contacts',
  'contracts',
  'departments',
  'documents',
  'incidents',
  'interfaces',
  'locations',
  'projects',
  'requests',
  'spend_items',
  'suppliers',
  'tasks',
  'technologies',
  'users',
] as const;

export type SearchIndexReindexSummary = {
  tenantsProcessed: number;
  entityTypes: number;
  errors: string[];
};

@Injectable()
export class AiSearchIndexService {
  private readonly logger = new Logger(AiSearchIndexService.name);

  constructor(private readonly dataSource: DataSource) {}

  async reindexTenant(manager: EntityManager, tenantId: string): Promise<{ entity_types: number }> {
    for (const type of SEARCH_INDEX_ENTITY_TYPES) {
      await manager.query(`SELECT search_index_refresh_${type}($1, NULL)`, [tenantId]);
    }
    return { entity_types: SEARCH_INDEX_ENTITY_TYPES.length };
  }

  async reindexAllTenants(): Promise<SearchIndexReindexSummary> {
    const summary: SearchIndexReindexSummary = {
      tenantsProcessed: 0,
      entityTypes: SEARCH_INDEX_ENTITY_TYPES.length,
      errors: [],
    };

    const tenants: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM tenants ORDER BY id ASC`,
    );

    for (const tenant of tenants) {
      try {
        await withTenantExecution(this.dataSource, tenant.id, async (tenantManager) => {
          await tenantManager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
          await this.reindexTenant(tenantManager, tenant.id);
          return true;
        });
        summary.tenantsProcessed += 1;
      } catch (error: any) {
        summary.errors.push(`Tenant ${tenant.id}: ${error?.message || String(error)}`);
      }
    }

    this.logger.log(
      `[ai-search-index] Reindex done: ${summary.tenantsProcessed} tenants, ${summary.entityTypes} entity types`
        + (summary.errors.length ? `, ${summary.errors.length} errors` : ''),
    );

    return summary;
  }
}
