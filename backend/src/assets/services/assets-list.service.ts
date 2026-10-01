import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from '../asset.entity';
import { parsePagination } from '../../common/pagination';
import { AssetsBaseService, ServiceOpts } from './assets-base.service';

/**
 * Service for listing and filtering assets.
 */
@Injectable()
export class AssetsListService extends AssetsBaseService {
  constructor(
    @InjectRepository(Asset) assetRepo: Repository<Asset>,
  ) {
    super(assetRepo);
  }

  /**
   * List assets with filtering, sorting, and pagination.
   * Uses raw SQL to support filtering on enriched fields (location_name, hosting_type, network_segment, cluster).
   */
  async list(query: any, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const { page, limit, skip, sort, q, filters } = parsePagination(query);

    const tenantId = this.ensureTenantId(opts?.tenantId);
    const { whereConditions, params } = this.buildFilterWhereConditions(filters, q, undefined, tenantId);

    // Sort field mapping
    const sortFieldMap: Record<string, string> = {
      name: 'a.name',
      asset_reference: 'a.asset_reference',
      environment: 'a.environment',
      kind: 'a.kind',
      provider: 'a.provider',
      status: 'a.status',
      region: 'a.region',
      zone: 'a.zone',
      hostname: 'a.hostname',
      fqdn: 'a.fqdn',
      operating_system: 'a.operating_system',
      is_cluster: 'COALESCE(a.is_cluster, false)::text',
      created_at: 'a.created_at',
      updated_at: 'a.updated_at',
      location_name: 'l.name',
      hosting_type: 'l.hosting_type',
      sub_location_name: 'sl.name',
      cluster: 'cluster_asset.name',
    };
    const sortField = sortFieldMap[sort.field] || 'a.created_at';

    // Count query
    const countQuery = `
      SELECT COUNT(DISTINCT a.id)::int as count
      FROM assets a
      LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
      LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
      LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id
      WHERE ${whereConditions}
    `;
    const countResult = await mg.query(countQuery, params);
    const total = countResult[0]?.count || 0;

    // Data query with pagination
    const dataQuery = `
      SELECT DISTINCT ON (a.id)
        a.id, a.tenant_id, a.name, a.asset_reference, a.kind, a.provider, a.environment,
        a.region, a.zone, a.hostname, a.domain, a.fqdn, a.aliases,
        a.ip_addresses, a.cluster, a.is_cluster, a.operating_system,
        a.location_id, a.sub_location_id, a.status, a.notes, a.created_at, a.updated_at,
        l.name AS location_name,
        l.hosting_type AS hosting_type,
        sl.name AS sub_location_name,
        a.ip_addresses->0->>'network_segment' AS network_segment
      FROM assets a
      LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
      LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
      LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id
      WHERE ${whereConditions}
      ORDER BY a.id, ${sortField} ${sort.direction}
    `;

    // Get all matching IDs first, then apply pagination
    const allIdsQuery = `
      SELECT DISTINCT a.id, ${sortField} as sort_value
      FROM assets a
      LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
      LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
      LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id
      WHERE ${whereConditions}
      ORDER BY ${sortField} ${sort.direction}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const paginatedIds = await mg.query(allIdsQuery, [...params, limit, skip]);
    const ids = paginatedIds.map((r: any) => r.id);

    if (ids.length === 0) {
      return { items: [], total, page, limit };
    }

    // Fetch full data for paginated IDs
    const itemsQuery = `
      SELECT
        a.id, a.tenant_id, a.name, a.asset_reference, a.kind, a.provider, a.environment,
        a.region, a.zone, a.hostname, a.domain, a.fqdn, a.aliases,
        a.ip_addresses, a.cluster, a.is_cluster, a.operating_system,
        a.location_id, a.sub_location_id, a.status, a.notes, a.created_at, a.updated_at,
        l.name AS location_name,
        l.hosting_type AS hosting_type,
        sl.name AS sub_location_name,
        a.ip_addresses->0->>'network_segment' AS network_segment
      FROM assets a
      LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
      LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      WHERE a.id = ANY($1) AND a.tenant_id = $2
    `;
    const itemsRaw = await mg.query(itemsQuery, [ids, tenantId]);

    // Maintain sort order from paginated query
    const itemsMap = new Map(itemsRaw.map((item: any) => [item.id, item]));
    const items = ids.map((id: string) => itemsMap.get(id)).filter(Boolean);

    // Enrich with cluster names and assignment counts
    await this.enrichListItems(items, ids, mg, tenantId);

    return { items, total, page, limit };
  }

  /**
   * Return ordered list of matching asset IDs for navigation.
   * Uses raw SQL to support filtering on enriched fields.
   */
  async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const mg = this.getManager(opts);
    const { sort, q, filters } = parsePagination(query);

    const tenantId = this.ensureTenantId(opts?.tenantId);
    const { whereConditions, params } = this.buildFilterWhereConditions(filters, q, undefined, tenantId);

    // Sort field mapping
    const sortFieldMap: Record<string, string> = {
      name: 'a.name',
      asset_reference: 'a.asset_reference',
      environment: 'a.environment',
      kind: 'a.kind',
      provider: 'a.provider',
      status: 'a.status',
      region: 'a.region',
      zone: 'a.zone',
      hostname: 'a.hostname',
      fqdn: 'a.fqdn',
      operating_system: 'a.operating_system',
      is_cluster: 'COALESCE(a.is_cluster, false)::text',
      created_at: 'a.created_at',
      updated_at: 'a.updated_at',
      location_name: 'l.name',
      hosting_type: 'l.hosting_type',
      sub_location_name: 'sl.name',
      cluster: 'cluster_asset.name',
    };
    const sortField = sortFieldMap[sort.field] || 'a.created_at';

    const countQuery = `
      SELECT COUNT(DISTINCT a.id)::int as count
      FROM assets a
      LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
      LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
      LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id
      WHERE ${whereConditions}
    `;
    const countResult = await mg.query(countQuery, params);
    const total = Number(countResult[0]?.count) || 0;

    // Need a subquery to properly order by sort field
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const orderedIdsQuery = `
      SELECT DISTINCT a.id, a.asset_reference as ref, ${sortField} as sort_value
      FROM assets a
      LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
      LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
      LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id
      WHERE ${whereConditions}
      ORDER BY ${sortField} ${sort.direction}
      LIMIT $${params.length + 1}
    `;

    const rows: Array<{ id: string; ref: string | null }> = await mg.query(orderedIdsQuery, [...params, limit]);
    const ids = rows.map((r) => r.id);
    const refs = rows.map((r) => r.ref || r.id);
    return { ids, refs, total };
  }

  /**
   * Enrich list items with assignment counts, location info, and cluster names.
   */
  private async enrichListItems(items: Asset[], ids: string[], mg: any, tenantId: string): Promise<void> {
    // Get assignment counts
    const assignmentRows: Array<{ asset_id: string; c: string }> = await mg.query(
      `SELECT asset_id, COUNT(*)::text as c FROM app_asset_assignments WHERE asset_id = ANY($1) AND tenant_id = $2 GROUP BY asset_id`,
      [ids, tenantId],
    );
    const assignmentMap = Object.fromEntries(assignmentRows.map((r) => [r.asset_id, Number(r.c)]));
    for (const item of items) {
      (item as any).assignments_count = assignmentMap[item.id] || 0;
    }

    // Get location info for grid display
    const locationRows: Array<{ id: string; location_name: string; hosting_type: string; sub_location_name: string | null }> = await mg.query(
      `SELECT a.id, l.name AS location_name, l.hosting_type, sl.name AS sub_location_name
       FROM assets a
       LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
       LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
       WHERE a.id = ANY($1) AND a.tenant_id = $2`,
      [ids, tenantId],
    );
    const locationMap = new Map(locationRows.map((r) => [r.id, { location_name: r.location_name, hosting_type: r.hosting_type, sub_location_name: r.sub_location_name }]));
    for (const item of items) {
      const loc = locationMap.get(item.id);
      (item as any).location_name = loc?.location_name ?? null;
      (item as any).hosting_type = loc?.hosting_type ?? null;
      (item as any).sub_location_name = loc?.sub_location_name ?? null;
    }

    // Populate cluster names for member assets
    const memberRows: Array<{ asset_id: string; cluster_name: string }> = await mg.query(
      `SELECT acm.asset_id, c.name AS cluster_name
       FROM asset_cluster_members acm
       JOIN assets c ON c.id = acm.cluster_id
       WHERE acm.asset_id = ANY($1) AND acm.tenant_id = $2 AND c.tenant_id = $2`,
      [ids, tenantId],
    );
    if (memberRows.length > 0) {
      const clusterMap = new Map<string, string[]>();
      for (const row of memberRows) {
        const list = clusterMap.get(row.asset_id) || [];
        if (row.cluster_name) list.push(row.cluster_name);
        clusterMap.set(row.asset_id, list);
      }
      for (const item of items) {
        const names = clusterMap.get(item.id);
        if (names && names.length > 0) {
          (item as any).cluster = names.join(', ');
        }
      }
    }
  }

  /**
   * Return distinct filter values for checkbox set filters.
   * Applies current filters and search (excluding the requesting column) to scope values.
   */
  async listFilterValues(query: any, opts?: ServiceOpts): Promise<Record<string, Array<string | null>>> {
    const mg = this.getManager(opts);
    const { q, filters } = parsePagination(query);
    const tenantId = this.ensureTenantId(opts?.tenantId);

    const rawFields = String(query.fields || query.field || '').split(',').map((f) => f.trim()).filter(Boolean);

    // Map of allowed fields to their SQL expressions
    const FILTER_VALUE_FIELDS: Record<string, string> = {
      kind: 'a.kind',
      asset_reference: 'a.asset_reference',
      environment: 'a.environment',
      provider: 'a.provider',
      region: 'a.region',
      zone: 'a.zone',
      operating_system: 'a.operating_system',
      status: 'a.status',
      hostname: 'a.hostname',
      fqdn: 'a.fqdn',
      is_cluster: 'COALESCE(a.is_cluster, false)::text',
      location_name: 'l.name',
      hosting_type: 'l.hosting_type',
      sub_location_name: 'sl.name',
      network_segment: "a.ip_addresses->0->>'network_segment'",
      cluster: 'cluster_asset.name',
    };

    const fields = rawFields.filter((field) => Object.prototype.hasOwnProperty.call(FILTER_VALUE_FIELDS, field));
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | null>> = {};

    for (const field of fields) {
      const expression = FILTER_VALUE_FIELDS[field];
      const { whereConditions, params } = this.buildFilterWhereConditions(filters, q, field, tenantId);

      // For cluster field, we need a different join strategy
      const clusterJoin = field === 'cluster'
        ? `LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
           LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id`
        : `LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
           LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id`;

      const distinctQuery = `
        SELECT DISTINCT ${expression} as value
        FROM assets a
        LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
        LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
        ${clusterJoin}
        WHERE ${whereConditions}
        ORDER BY value ASC NULLS LAST
      `;

      const rows: Array<{ value: string | null }> = await mg.query(distinctQuery, params);
      results[field] = rows.map((row) => row.value);
    }

    return results;
  }

  /**
   * Build WHERE conditions for filter-values query.
   * Excludes the skipField from filters so users can see alternative options.
   */
  private buildFilterWhereConditions(
    rawFilters: any,
    q?: string,
    skipField?: string,
    tenantId?: string,
  ): { whereConditions: string; params: any[] } {
    let whereConditions = '1=1';
    const params: any[] = [];
    const filters: Record<string, any> = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};

    const shouldSkip = (field: string) => field === skipField;

    // Map frontend field names to SQL expressions
    const fieldExpressions: Record<string, string> = {
      kind: 'a.kind',
      asset_reference: 'a.asset_reference',
      environment: 'a.environment',
      provider: 'a.provider',
      region: 'a.region',
      zone: 'a.zone',
      operating_system: 'a.operating_system',
      status: 'a.status',
      hostname: 'a.hostname',
      fqdn: 'a.fqdn',
      is_cluster: 'COALESCE(a.is_cluster, false)::text',
      location_name: 'l.name',
      hosting_type: 'l.hosting_type',
      sub_location_name: 'sl.name',
      network_segment: "a.ip_addresses->0->>'network_segment'",
      cluster: 'cluster_asset.name',
      // The Created column's text filter reads the timestamp as text, as connections and applications do.
      created_at: 'CAST(a.created_at AS TEXT)',
    };

    // Apply set and text filters
    for (const [field, model] of Object.entries(filters)) {
      if (shouldSkip(field)) continue;
      const expression = fieldExpressions[field];
      if (!expression) continue;

      if (model && model.filterType === 'set' && Array.isArray(model.values)) {
        if (model.values.length === 0) {
          whereConditions += ' AND 1=0';
          continue;
        }
        const nonNullValues = model.values.filter((v: any) => v !== null && v !== undefined);
        const hasNull = model.values.some((v: any) => v === null || v === undefined);
        const clauses: string[] = [];
        if (nonNullValues.length > 0) {
          const placeholders = nonNullValues.map((value: any) => {
            params.push(value);
            return `$${params.length}`;
          });
          clauses.push(`${expression} IN (${placeholders.join(', ')})`);
        }
        if (hasNull) clauses.push(`${expression} IS NULL`);
        if (clauses.length > 0) {
          whereConditions += ` AND (${clauses.join(' OR ')})`;
        }
      } else if (model && model.filterType === 'text' && model.filter) {
        const filterText = String(model.filter);
        const type = model.type || 'contains';
        if (type === 'contains') {
          params.push(`%${filterText}%`);
          whereConditions += ` AND ${expression} ILIKE $${params.length}`;
        } else if (type === 'equals') {
          params.push(filterText);
          whereConditions += ` AND ${expression} = $${params.length}`;
        } else if (type === 'startsWith') {
          params.push(`${filterText}%`);
          whereConditions += ` AND ${expression} ILIKE $${params.length}`;
        } else if (type === 'endsWith') {
          params.push(`%${filterText}`);
          whereConditions += ` AND ${expression} ILIKE $${params.length}`;
        } else if (type === 'blank') {
          whereConditions += ` AND (${expression} IS NULL OR ${expression} = '')`;
        } else if (type === 'notBlank') {
          whereConditions += ` AND ${expression} IS NOT NULL AND ${expression} != ''`;
        }
      }
    }

    // Apply search filter
    if (q) {
      params.push(`%${q}%`);
      const qIdx = params.length;
      whereConditions += ` AND (
        a.name ILIKE $${qIdx}
        OR a.asset_reference ILIKE $${qIdx}
        OR a.hostname ILIKE $${qIdx}
        OR a.ip_addresses::text ILIKE $${qIdx}
        OR cluster_asset.name ILIKE $${qIdx}
        OR a.fqdn ILIKE $${qIdx}
        OR sl.name ILIKE $${qIdx}
      )`;
    }

    if (tenantId) {
      params.push(tenantId);
      whereConditions += ` AND a.tenant_id = $${params.length}`;
    }

    return { whereConditions, params };
  }

  /**
   * Lightweight projection for map side panels.
   */
  async mapSummary(id: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const asset = await this.ensureAsset(id, mg, tenantId);

    let location_reference: string | null = null;
    let location_name: string | null = null;
    if (asset.location_id) {
      const locRows: Array<{ location_reference: string; name: string }> = await mg.query(
        `SELECT location_reference, name FROM locations WHERE id = $1 LIMIT 1`,
        [asset.location_id],
      );
      location_reference = locRows[0]?.location_reference || null;
      location_name = locRows[0]?.name || null;
    }

    const assignedRows: Array<{ app_id: string; app_name: string; environment: string }> = await mg.query(
      `SELECT a.id AS app_id, a.name AS app_name, ai.environment
       FROM app_asset_assignments aaa
       JOIN app_instances ai ON ai.id = aaa.app_instance_id
       JOIN applications a ON a.id = ai.application_id
       WHERE aaa.asset_id = $1
         AND a.tenant_id = $2
       ORDER BY array_position(ARRAY['prod','pre_prod','qa','test','dev','sandbox'], ai.environment), a.name ASC`,
      [id, asset.tenant_id],
    );

    const assigned_applications = assignedRows.map((row) => ({
      id: row.app_id,
      name: row.app_name,
      environment: row.environment,
    }));

    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      environment: asset.environment,
      operating_system: asset.operating_system,
      ip_addresses: asset.ip_addresses,
      location_reference,
      location_name,
      assigned_applications,
      is_cluster: !!asset.is_cluster,
    };
  }
}
