import { Injectable } from '@nestjs/common';
import { textSortKey, type TextSortKey } from '../../common/list-sort';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from '../asset.entity';
import { parsePagination, Sort } from '../../common/pagination';
import { operatingSystemLabelSql } from '../../technologies/operating-system-codes';
import { AssetsBaseService, ServiceOpts } from './assets-base.service';
import { clusterMembershipsOf, clusterNamesText, realClusterMembershipSql } from '../asset-rules';
import { assertSetFilterModes, bindPositional, compileAgFilterCondition, createParamNameGenerator } from '../../common/ag-grid-filtering';
import { assetCountsForTenantSql, assetVulnerabilityCounts, vulnerabilityCountsEnabled } from '../../vulnerabilities/vulnerability-reach-counts';
import { effectiveAssignmentsSql, ViaCluster } from '../../app-asset-assignments/effective-assignments';
import {
  VULNERABILITIES_LIST_FIELD,
  vulnerabilityFilterPredicateSql,
  vulnerabilityListFields,
  vulnerabilitySortKeySql,
} from '../../vulnerabilities/vulnerability-list-column';

/** The readable operating system, one scalar subquery on the assets alias `a`. */
const ASSET_OS_LABEL = operatingSystemLabelSql('a');

/** The asset list columns that sort alphabetically. */
const ASSET_TEXT_SORTS = new Set(['name', 'asset_reference', 'provider', 'region', 'zone', 'hostname', 'fqdn', 'operating_system', 'location_name', 'sub_location_name']);

/**
 * The value of the Cluster filter that keeps the clusters themselves. `null` keeps the plain
 * assets that are members of no cluster; any other value is a cluster's name.
 */
export const CLUSTER_FILTER_IS_CLUSTER = '__cluster__';

/**
 * The sort value of the Cluster column, one per asset: the first name of its clusters. A cluster
 * and an asset of no cluster have none (they sort with the blanks).
 */
function clusterSortValue(key: TextSortKey): string {
  return key(`(SELECT min(${key('c.name')})
      FROM asset_cluster_members m
      JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id AND c.is_cluster
     WHERE m.tenant_id = a.tenant_id AND m.asset_id = a.id AND NOT COALESCE(a.is_cluster, false))`);
}

/** The sort value of a list column: text alphabetically (case and accents ignored), else as stored. */
async function assetSortField(mg: any, sortFieldMap: Record<string, string>, field: string): Promise<string> {
  if (field === 'cluster') return clusterSortValue(await textSortKey(mg));
  return ASSET_TEXT_SORTS.has(field) && sortFieldMap[field]
    ? (await textSortKey(mg))(sortFieldMap[field])
    : sortFieldMap[field] || 'a.created_at';
}

/**
 * The Cluster set filter: the members of the named clusters, the clusters themselves
 * (`CLUSTER_FILTER_IS_CLUSTER`) and the plain assets of no cluster (`null`), joined by OR.
 */
function clusterSetPredicate(values: unknown[], params: any[]): string {
  const clauses: string[] = [];
  const names = values.filter((v) => v !== null && v !== undefined && v !== CLUSTER_FILTER_IS_CLUSTER);
  if (names.length > 0) {
    const placeholders = names.map((name) => {
      params.push(String(name));
      return `$${params.length}`;
    });
    clauses.push(realClusterMembershipSql('a', `c.name IN (${placeholders.join(', ')})`));
  }
  if (values.includes(CLUSTER_FILTER_IS_CLUSTER)) clauses.push('COALESCE(a.is_cluster, false)');
  if (values.some((v) => v === null || v === undefined)) {
    clauses.push(`(NOT COALESCE(a.is_cluster, false) AND NOT ${realClusterMembershipSql('a')})`);
  }
  return clauses.length > 0 ? `(${clauses.join(' OR ')})` : '1=0';
}

/**
 * The vulnerability counts of the asset `a` (shared module), as `vc.open` and `vc.severe`, for the
 * sort and the filter of the Vulnerabilities column: the counts of every asset of the tenant
 * `tenant` (its placeholder), computed once and joined by id. Joined only when one of them asks for it.
 */
const vulnerabilityCountsJoin = (tenant: string) => `LEFT JOIN (${assetCountsForTenantSql({ tenant })}) vc ON vc.id = a.id`;

/**
 * The sort of the list: the selected sort value and the ORDER BY terms before the id. The
 * Vulnerabilities column sorts by severe count then count, a retired asset last either way; with
 * the feed off it sorts as an unknown column (by creation date).
 */
function listSort(sort: Sort, sortField: string): { value: string; orderBy: string; orderByValue: (value: string) => string; joinsVulnerabilities: boolean } {
  if (sort.field === VULNERABILITIES_LIST_FIELD && vulnerabilityCountsEnabled()) {
    const key = vulnerabilitySortKeySql('vc');
    return { value: key, orderBy: `${key} ${sort.direction} NULLS LAST`, orderByValue: (value) => `${value} ${sort.direction} NULLS LAST`, joinsVulnerabilities: true };
  }
  return { value: sortField, orderBy: `${sortField} ${sort.direction}`, orderByValue: (value) => `${value} ${sort.direction}`, joinsVulnerabilities: false };
}

/**
 * The joins of the list's rows, after `FROM assets a`. A member of two clusters repeats (the rows
 * are distinct by id and sort value, one per asset); only real clusters join.
 */
const LIST_JOINS = `
      LEFT JOIN locations l ON l.id = a.location_id AND l.tenant_id = a.tenant_id
      LEFT JOIN location_sub_items sl ON sl.id = a.sub_location_id AND sl.tenant_id = a.tenant_id
      LEFT JOIN asset_cluster_members acm ON acm.asset_id = a.id AND acm.tenant_id = a.tenant_id
      LEFT JOIN assets cluster_asset ON cluster_asset.id = acm.cluster_id AND cluster_asset.tenant_id = a.tenant_id AND cluster_asset.is_cluster`;

/**
 * The ordered rows of the list and their total in one statement: the distinct `(id, sort value)`
 * rows are read once (a materialized CTE), counted by id, and the page taken from them. The
 * vulnerability counts (`vc`), when joined, are then computed once per display (lot 2,
 * performance: the count and the page each computed them). `columns` adds columns of the rows
 * (`a.asset_reference AS ref`, `vc.open AS vc_open`); `page` holds the placeholders of the limit
 * and the offset.
 */
function orderedRowsSql(p: { columns: string[]; vulnerabilityJoin: string; whereConditions: string; ordering: ReturnType<typeof listSort>; page: string }): string {
  return `
      WITH list_rows AS MATERIALIZED (
        SELECT DISTINCT a.id, ${p.ordering.value} AS sort_value${p.columns.map((column) => `, ${column}`).join('')}
        FROM assets a
        ${LIST_JOINS}
        ${p.vulnerabilityJoin}
        WHERE ${p.whereConditions}
      )
      SELECT lr.*, (SELECT COUNT(DISTINCT id) FROM list_rows)::int AS list_total
      FROM list_rows lr
      ORDER BY ${p.ordering.orderByValue('lr.sort_value')}, lr.id ASC
      ${p.page}
    `;
}

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
    const { whereConditions, params, joinsVulnerabilities, tenantParam } = this.buildFilterWhereConditions(filters, q, undefined, tenantId);

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
      admin_zone: 'a.admin_zone',
      operating_system: ASSET_OS_LABEL,
      is_cluster: 'COALESCE(a.is_cluster, false)::text',
      created_at: 'a.created_at',
      updated_at: 'a.updated_at',
      location_name: 'l.name',
      hosting_type: 'l.hosting_type',
      sub_location_name: 'sl.name',
    };
    // Text alphabetically, case and accents ignored; the id breaks ties.
    const sortField = await assetSortField(mg, sortFieldMap, sort.field);
    const ordering = listSort(sort, sortField);
    const vulnerabilityJoin = joinsVulnerabilities || ordering.joinsVulnerabilities ? vulnerabilityCountsJoin(tenantParam) : '';

    const countsJoined = vulnerabilityJoin !== '';
    const paginatedIds: Array<{ id: string; list_total: number; vc_open?: number | null; vc_severe?: number | null }> = await mg.query(
      orderedRowsSql({
        columns: countsJoined ? ['vc.open AS vc_open', 'vc.severe AS vc_severe'] : [],
        vulnerabilityJoin,
        whereConditions,
        ordering,
        page: `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      }),
      [...params, limit, skip],
    );
    const ids = paginatedIds.map((r) => r.id);

    if (ids.length === 0) {
      // A page past the end (or an empty list): no row carries the total.
      const total = skip > 0 ? await this.countRows(mg, whereConditions, params, joinsVulnerabilities ? vulnerabilityCountsJoin(tenantParam) : '') : 0;
      return { items: [], total, page, limit };
    }
    const total = Number(paginatedIds[0].list_total) || 0;
    // The counts of the page's rows when the list joined them, else read for the page.
    const joinedCounts = countsJoined
      ? new Map(paginatedIds.map((r) => [r.id, { open: r.vc_open == null ? null : Number(r.vc_open), severe: r.vc_severe == null ? null : Number(r.vc_severe) }]))
      : null;

    // Fetch full data for paginated IDs
    const itemsQuery = `
      SELECT
        a.id, a.tenant_id, a.name, a.asset_reference, a.kind, a.provider, a.environment,
        a.region, a.zone, a.hostname, a.domain, a.admin_zone, a.fqdn, a.aliases,
        a.ip_addresses, a.is_cluster, ${ASSET_OS_LABEL} AS operating_system,
        a.location_id, a.sub_location_id, a.status, a.notes, a.created_at, a.updated_at,
        a.go_live_date::text AS go_live_date, a.end_of_life_date::text AS end_of_life_date,
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
    const itemsMap = new Map<string, any>(itemsRaw.map((item: any) => [item.id, item]));
    const items = ids.map((id: string) => itemsMap.get(id)).filter(Boolean);

    // Enrich with cluster names and assignment counts
    await this.enrichListItems(items, ids, mg, tenantId, joinedCounts);

    return { items, total, page, limit };
  }

  /** The number of assets the filters keep (the list's rows counted by id). */
  private async countRows(mg: any, whereConditions: string, params: any[], vulnerabilityJoin: string): Promise<number> {
    const rows = await mg.query(
      `SELECT COUNT(DISTINCT a.id)::int as count
      FROM assets a
      ${LIST_JOINS}
      ${vulnerabilityJoin}
      WHERE ${whereConditions}`,
      params,
    );
    return Number(rows[0]?.count) || 0;
  }

  /**
   * Return ordered list of matching asset IDs for navigation.
   * Uses raw SQL to support filtering on enriched fields.
   */
  async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const mg = this.getManager(opts);
    const { sort, q, filters } = parsePagination(query);

    const tenantId = this.ensureTenantId(opts?.tenantId);
    const { whereConditions, params, joinsVulnerabilities, tenantParam } = this.buildFilterWhereConditions(filters, q, undefined, tenantId);

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
      admin_zone: 'a.admin_zone',
      operating_system: ASSET_OS_LABEL,
      is_cluster: 'COALESCE(a.is_cluster, false)::text',
      created_at: 'a.created_at',
      updated_at: 'a.updated_at',
      location_name: 'l.name',
      hosting_type: 'l.hosting_type',
      sub_location_name: 'sl.name',
    };
    // Text alphabetically, case and accents ignored; the id breaks ties.
    const sortField = await assetSortField(mg, sortFieldMap, sort.field);
    const ordering = listSort(sort, sortField);
    const vulnerabilityJoin = joinsVulnerabilities || ordering.joinsVulnerabilities ? vulnerabilityCountsJoin(tenantParam) : '';

    // Need a subquery to properly order by sort field
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const rows: Array<{ id: string; ref: string | null; list_total: number }> = await mg.query(
      orderedRowsSql({ columns: ['a.asset_reference AS ref'], vulnerabilityJoin, whereConditions, ordering, page: `LIMIT $${params.length + 1}` }),
      [...params, limit],
    );
    const total = rows.length > 0 ? Number(rows[0].list_total) || 0 : 0;
    const ids = rows.map((r) => r.id);
    const refs = rows.map((r) => r.ref || r.id);
    return { ids, refs, total };
  }

  /**
   * Enrich list items with assignment counts, location info, and cluster names.
   */
  private async enrichListItems(
    items: Asset[],
    ids: string[],
    mg: any,
    tenantId: string,
    joinedCounts: Map<string, { open: number | null; severe: number | null }> | null,
  ): Promise<void> {
    // Get assignment counts: effective, a member counting what its clusters carry.
    const assignmentRows: Array<{ asset_id: string; c: string }> = await mg.query(
      `SELECT e.asset_id, COUNT(*)::text as c FROM (${effectiveAssignmentsSql({ tenant: '$2', assets: '$1' })}) e GROUP BY e.asset_id`,
      [ids, tenantId],
    );
    const assignmentMap = Object.fromEntries(assignmentRows.map((r) => [r.asset_id, Number(r.c)]));
    for (const item of items) {
      (item as any).assignments_count = assignmentMap[item.id] || 0;
    }

    // Vulnerabilities to review and severe ones (null retired or feed off): those the list joined,
    // else one batch for the page.
    const vulnerabilityCounts = joinedCounts ?? await assetVulnerabilityCounts(mg, tenantId, ids);
    for (const item of items) {
      Object.assign(item as any, vulnerabilityListFields(vulnerabilityCounts.get(item.id)));
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

    // The names of the asset's real clusters, by name; never the legacy `assets.cluster` text.
    const memberships = await clusterMembershipsOf(mg, tenantId, ids);
    for (const item of items) {
      (item as any).cluster = clusterNamesText(memberships.get(item.id));
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
      operating_system: ASSET_OS_LABEL,
      status: 'a.status',
      hostname: 'a.hostname',
      fqdn: 'a.fqdn',
      admin_zone: 'a.admin_zone',
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
      const { whereConditions, params, joinsVulnerabilities, tenantParam } = this.buildFilterWhereConditions(filters, q, field, tenantId);
      const keptRows = `
        FROM assets a
        ${LIST_JOINS}
        ${joinsVulnerabilities ? vulnerabilityCountsJoin(tenantParam) : ''}
        WHERE ${whereConditions}`;

      // The Cluster column: the names of the real clusters the kept assets belong to, then
      // `CLUSTER_FILTER_IS_CLUSTER` when a cluster is kept, then null for a plain asset of no cluster.
      const distinctQuery = field === 'cluster'
        ? `
        WITH kept AS MATERIALIZED (SELECT DISTINCT a.id, a.tenant_id, COALESCE(a.is_cluster, false) AS is_cluster ${keptRows})
        SELECT value FROM (
          SELECT DISTINCT c.name AS value, 0 AS bucket
            FROM kept k
            JOIN asset_cluster_members m ON m.tenant_id = k.tenant_id AND m.asset_id = k.id
            JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id AND c.is_cluster
           WHERE NOT k.is_cluster
          UNION
          SELECT '${CLUSTER_FILTER_IS_CLUSTER}', 1 FROM kept k WHERE k.is_cluster
          UNION
          SELECT NULL, 2 FROM kept k
           WHERE NOT k.is_cluster
             AND NOT EXISTS (
               SELECT 1 FROM asset_cluster_members m
                 JOIN assets c ON c.tenant_id = m.tenant_id AND c.id = m.cluster_id AND c.is_cluster
                WHERE m.tenant_id = k.tenant_id AND m.asset_id = k.id)
        ) v
        ORDER BY bucket, value ASC
      `
        : `
        SELECT DISTINCT ${expression} as value
        ${keptRows}
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
  ): { whereConditions: string; params: any[]; joinsVulnerabilities: boolean; tenantParam: string } {
    let whereConditions = '1=1';
    let joinsVulnerabilities = false;
    const params: any[] = [];
    const filters: Record<string, any> = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
    assertSetFilterModes(filters);

    const shouldSkip = (field: string) => field === skipField;

    // Map frontend field names to SQL expressions
    const fieldExpressions: Record<string, string> = {
      name: 'a.name',
      kind: 'a.kind',
      asset_reference: 'a.asset_reference',
      environment: 'a.environment',
      provider: 'a.provider',
      region: 'a.region',
      zone: 'a.zone',
      operating_system: ASSET_OS_LABEL,
      status: 'a.status',
      hostname: 'a.hostname',
      fqdn: 'a.fqdn',
      admin_zone: 'a.admin_zone',
      is_cluster: 'COALESCE(a.is_cluster, false)::text',
      location_name: 'l.name',
      hosting_type: 'l.hosting_type',
      sub_location_name: 'sl.name',
      network_segment: "a.ip_addresses->0->>'network_segment'",
      cluster: 'cluster_asset.name',
    };

    // Date filters (date models by day, blank checks; a text model answers 400): the shared compiler.
    const dateExpressions: Record<string, string> = {
      created_at: 'a.created_at',
      go_live_date: 'a.go_live_date',
      end_of_life_date: 'a.end_of_life_date',
    };
    const nextDateParam = createParamNameGenerator('asset_date_');

    // Number filters: the assignment count the list shows (`enrichListItems`), effective.
    const numberExpressions: Record<string, string> = {
      assignments_count: `(SELECT COUNT(*) FROM (${effectiveAssignmentsSql({ tenant: 'a.tenant_id', assets: 'ARRAY[a.id]' })}) aaa)`,
    };
    const numberOperators: Record<string, string> = {
      equals: '=', notEqual: '<>', greaterThan: '>', greaterThanOrEqual: '>=', lessThan: '<', lessThanOrEqual: '<=',
    };

    // Apply set and text filters
    for (const [field, model] of Object.entries(filters)) {
      if (shouldSkip(field)) continue;
      // The Vulnerabilities column: severe, any or none, on the counts the list joins as `vc`.
      if (field === VULNERABILITIES_LIST_FIELD) {
        const predicate = vulnerabilityFilterPredicateSql(model, 'vc');
        if (predicate) {
          whereConditions += ` AND ${predicate}`;
          joinsVulnerabilities = joinsVulnerabilities || predicate !== '1=0';
        }
        continue;
      }
      const numberExpression = numberExpressions[field];
      if (numberExpression) {
        const value = Number(model?.filter);
        if (model?.filterType !== 'number' || !Number.isFinite(value)) continue;
        if (model.type === 'inRange' && Number.isFinite(Number(model.filterTo))) {
          params.push(value, Number(model.filterTo));
          whereConditions += ` AND ${numberExpression} BETWEEN $${params.length - 1} AND $${params.length}`;
        } else if (numberOperators[model.type ?? 'equals']) {
          params.push(value);
          whereConditions += ` AND ${numberExpression} ${numberOperators[model.type ?? 'equals']} $${params.length}`;
        }
        continue;
      }
      const dateExpression = dateExpressions[field];
      if (dateExpression) {
        const compiled = compileAgFilterCondition(model, { expression: dateExpression, dataType: 'date' }, nextDateParam);
        if (compiled) whereConditions += ` AND (${bindPositional(compiled, params)})`;
        continue;
      }
      const expression = fieldExpressions[field];
      if (!expression) continue;
      if (field === 'cluster' && model?.filterType === 'set' && Array.isArray(model.values)) {
        whereConditions += ` AND ${clusterSetPredicate(model.values, params)}`;
        continue;
      }

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

    // The tenant's placeholder, also read by the vulnerability counts join (the session's tenant without one).
    let tenantParam = 'app_current_tenant()';
    if (tenantId) {
      params.push(tenantId);
      tenantParam = `$${params.length}`;
      whereConditions += ` AND a.tenant_id = ${tenantParam}`;
    }

    return { whereConditions, params, joinsVulnerabilities, tenantParam };
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

    // Effective: a member lists what its clusters carry too (`inherited`, `via_clusters`).
    const assignedRows: Array<{ app_id: string; app_name: string; environment: string; inherited: boolean; via_clusters: ViaCluster[] }> = await mg.query(
      `SELECT a.id AS app_id, a.name AS app_name, ai.environment, e.inherited, e.via_clusters
       FROM (${effectiveAssignmentsSql({ tenant: '$2', assets: 'ARRAY[$1::uuid]' })}) e
       JOIN app_instances ai ON ai.id = e.app_instance_id AND ai.tenant_id = e.tenant_id
       JOIN applications a ON a.id = ai.application_id AND a.tenant_id = ai.tenant_id
       ORDER BY array_position(ARRAY['prod','pre_prod','qa','test','dev','sandbox'], ai.environment), a.name ASC, e.inherited`,
      [id, asset.tenant_id],
    );

    const assigned_applications = assignedRows.map((row) => ({
      id: row.app_id,
      name: row.app_name,
      environment: row.environment,
      inherited: !!row.inherited,
      via_clusters: row.via_clusters ?? [],
    }));

    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      environment: asset.environment,
      operating_system: (await mg.query(
        `SELECT ${ASSET_OS_LABEL} AS operating_system FROM assets a WHERE a.tenant_id = $1 AND a.id = $2`,
        [tenantId, asset.id],
      ))[0]?.operating_system ?? null,
      ip_addresses: asset.ip_addresses,
      location_reference,
      location_name,
      assigned_applications,
      is_cluster: !!asset.is_cluster,
    };
  }
}
