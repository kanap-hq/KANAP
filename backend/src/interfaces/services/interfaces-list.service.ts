import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interface-middleware-application.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { Application } from '../../applications/application.entity';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { classificationRankSql } from '../../it-ops-settings/classification-catalog';
import { parsePagination } from '../../common/pagination';
import { compileAgFilterCondition, createParamNameGenerator, FilterTargetConfig } from '../../common/ag-grid-filtering';
import { normalizeBindingLifecycle } from '../../interface-bindings/interface-bindings.service';
import {
  InterfacesBaseService,
  ServiceOpts,
  RouteType,
} from './interfaces-base.service';

/** Grid columns the interfaces list filters on, by the SQL each one reads. */
const INTERFACE_FILTER_TARGETS: Record<string, FilterTargetConfig> = {
  interface_reference: { expression: 'i.interface_reference' },
  interface_id: { expression: 'i.interface_id' },
  name: { expression: 'i.name' },
  source_application_name: { expression: 'sa.name' },
  target_application_name: { expression: 'ta.name' },
  business_process_id: { expression: 'i.business_process_id', textExpression: 'CAST(i.business_process_id AS TEXT)' },
  business_process_name: { expression: 'bp.name' },
  lifecycle: { expression: 'i.lifecycle' },
  criticality: { expression: 'i.criticality' },
  data_category: { expression: 'i.data_category' },
  data_class: { expression: 'i.data_class' },
  integration_route_type: { expression: 'i.integration_route_type' },
  contains_pii: { expression: 'i.contains_pii', dataType: 'boolean' },
  created_at: { expression: 'i.created_at', textExpression: 'CAST(i.created_at AS TEXT)' },
};

/** Columns filtering on the environments of the interface's bindings. */
const ENVIRONMENT_FILTER_FIELDS = new Set(['environment', 'binding_environments']);

/**
 * Sort keys. Criticality sorts by its rank in the tenant catalog, from the least severe up,
 * as the connections list does; a value outside the catalog has no rank and sorts last.
 */
const INTERFACE_SORT_EXPRESSIONS: Record<string, string> = {
  interface_reference: 'i.interface_reference',
  interface_id: 'i.interface_id',
  name: 'i.name',
  lifecycle: 'i.lifecycle',
  criticality: classificationRankSql('i.criticality', 'sortCritCodes', 'sortCritRanks'),
  created_at: 'i.created_at',
  updated_at: 'i.updated_at',
};

/**
 * Service for listing, filtering, and querying interfaces.
 */
@Injectable()
export class InterfacesListService extends InterfacesBaseService {
  constructor(
    @InjectRepository(InterfaceEntity) repo: Repository<InterfaceEntity>,
    @InjectRepository(InterfaceLeg) legs: Repository<InterfaceLeg>,
    @InjectRepository(InterfaceMiddlewareApplication) middlewareApps: Repository<InterfaceMiddlewareApplication>,
    @InjectRepository(Application) apps: Repository<Application>,
    @InjectRepository(InterfaceBinding) bindings: Repository<InterfaceBinding>,
    itOpsSettings: ItOpsSettingsService,
  ) {
    super(repo, legs, middlewareApps, apps, bindings, itOpsSettings);
  }

  /**
   * The interfaces of the current tenant matching the quick search and the grid's filter model.
   * `list` and `listIds` both start from it, so the rows and the prev/next ids always agree.
   */
  private buildFilteredQuery(repo: Repository<InterfaceEntity>, q: string | undefined, filters: any): SelectQueryBuilder<InterfaceEntity> {
    const qb = repo.createQueryBuilder('i');
    qb.leftJoin('applications', 'sa', 'sa.id = i.source_application_id AND sa.tenant_id = i.tenant_id');
    qb.leftJoin('applications', 'ta', 'ta.id = i.target_application_id AND ta.tenant_id = i.tenant_id');
    qb.leftJoin('business_processes', 'bp', 'bp.id = i.business_process_id AND bp.tenant_id = i.tenant_id');
    qb.where('i.tenant_id = app_current_tenant()');

    if (q) {
      qb.andWhere(
        new Brackets((expr) => {
          expr.where('i.name ILIKE :q OR i.interface_reference ILIKE :q OR i.interface_id ILIKE :q OR i.business_purpose ILIKE :q', {
            q: `%${q}%`,
          });
        }),
      );
    }

    if (!filters || typeof filters !== 'object') return qb;
    const nextParam = createParamNameGenerator('ifl');
    for (const [field, model] of Object.entries(filters)) {
      if (ENVIRONMENT_FILTER_FIELDS.has(field)) {
        // An interface matches when one of its bindings matches.
        const condition = compileAgFilterCondition(model, { expression: 'b.environment' }, nextParam);
        if (condition) {
          qb.andWhere(
            `EXISTS (
              SELECT 1
              FROM interface_bindings b
              WHERE b.tenant_id = i.tenant_id
                AND b.interface_id = i.id
                AND (${condition.sql})
            )`,
            condition.params,
          );
        }
        continue;
      }
      const target = INTERFACE_FILTER_TARGETS[field];
      if (!target) continue;
      const condition = compileAgFilterCondition(model, target, nextParam);
      // Parenthesized, so no condition can widen the tenant predicate above.
      if (condition) qb.andWhere(`(${condition.sql})`, condition.params);
    }
    return qb;
  }

  /** Orders a query built by buildFilteredQuery; the id breaks ties so pages never overlap. */
  private async applySort(qb: SelectQueryBuilder<InterfaceEntity>, sort: { field: string; direction: string }, mg: EntityManager): Promise<void> {
    const field = INTERFACE_SORT_EXPRESSIONS[sort.field] ? sort.field : 'interface_reference';
    const direction = sort.direction === 'ASC' ? 'ASC' : 'DESC';
    if (field === 'criticality') {
      // The rows all belong to the session tenant (see buildFilteredQuery): rank with its catalog.
      const rows: Array<{ tenant_id: string | null }> = await mg.query(`SELECT app_current_tenant() AS tenant_id`);
      const tenantId = rows[0]?.tenant_id;
      const levels = tenantId ? (await this.itOpsSettings.getClassificationCatalog(tenantId, { manager: mg })).businessCriticalityLevels : [];
      qb.setParameters({ sortCritCodes: levels.map((level) => level.code), sortCritRanks: levels.map((level) => level.rank) });
    }
    // Parenthesized: TypeORM would take a bare `i.name` for the entity column and rename it.
    qb.addSelect(`(${INTERFACE_SORT_EXPRESSIONS[field]})`, 'list_sort_key');
    qb.orderBy('list_sort_key', direction, 'NULLS LAST').addOrderBy('i.id', 'ASC');
  }

  /**
   * List interfaces with filtering, sorting, and pagination.
   */
  async list(query: any, opts?: ServiceOpts) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, q, filters } = parsePagination(query);
    const qb = this.buildFilteredQuery(repo, q, filters);
    qb.addSelect('sa.name', 'source_name');
    qb.addSelect('ta.name', 'target_name');
    qb.addSelect('bp.name', 'business_process_name');

    const total = await qb.clone().getCount();
    await this.applySort(qb, sort, opts?.manager ?? repo.manager);
    qb.skip(skip).take(limit);

    const { raw, entities } = await qb.getRawAndEntities();
    const pageIds = entities.map((e) => e.id);
    let bindingsAgg: Record<string, { total: number; environments: number; envs: string[] }> = {};
    if (pageIds.length > 0) {
      const rows: Array<{ interface_id: string; total: string; environments: string; envs: string | null }> =
        await (opts?.manager ?? repo.manager).query(
          `SELECT b.interface_id,
                  COUNT(*)::text as total,
                  COUNT(DISTINCT b.environment)::text as environments,
                  STRING_AGG(DISTINCT b.environment, ',') as envs
           FROM interface_bindings b
           WHERE b.tenant_id = app_current_tenant()
             AND b.interface_id = ANY($1)
           GROUP BY b.interface_id`,
          [pageIds],
        );
      bindingsAgg = Object.fromEntries(
        rows.map((r) => {
          const envList =
            (r.envs || '')
              .split(',')
              .map((e) => e.trim())
              .filter((e) => e.length > 0) || [];
          return [
            r.interface_id,
            {
              total: Number(r.total),
              environments: Number(r.environments),
              envs: envList,
            },
          ];
        }),
      );
    }

    const items = entities.map((entity, idx) => {
      const base: any = { ...entity };
      const r = (raw[idx] || {}) as any;
      base.source_application_name = r.source_name || null;
      base.target_application_name = r.target_name || null;
      base.business_process_name = r.business_process_name || null;
      const agg = bindingsAgg[entity.id];
      base.bindings_count = agg?.total ?? 0;
      base.environment_coverage = agg?.environments ?? 0;
      base.binding_environments = agg?.envs ?? [];
      return base;
    });

    return { items, total, page, limit };
  }

  async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const { sort, q, filters } = parsePagination(query);
    const qb = this.buildFilteredQuery(repo, q, filters).select('i.id', 'id').addSelect('i.interface_reference', 'ref');
    const total = await qb.clone().getCount();
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    await this.applySort(qb, sort, opts?.manager ?? repo.manager);
    const rows = await qb
      // limit, not take: with joins TypeORM only applies take through its entity paging.
      .limit(limit)
      .getRawMany<{ id: string; ref: string | null }>();
    const navRows = rows.filter((row) => Boolean(row.id));
    const ids = navRows.map((row) => row.id);
    const refs = navRows.map((row) => row.ref || row.id);
    return { ids, refs, total };
  }

  /**
   * Values of the business process filter: the processes the tenant's interfaces use, by name,
   * and null when some interface has none. Read with the interfaces permission, so a reader
   * of interfaces needs no access to the business processes list.
   */
  async businessProcessFilterValues(opts?: ServiceOpts): Promise<Array<{ value: string | null; label: string | null }>> {
    const mg = opts?.manager ?? this.repo.manager;
    const rows: Array<{ id: string | null; name: string | null }> = await mg.query(
      `SELECT DISTINCT i.business_process_id AS id, bp.name
       FROM interfaces i
       LEFT JOIN business_processes bp ON bp.id = i.business_process_id AND bp.tenant_id = i.tenant_id
       WHERE i.tenant_id = app_current_tenant()
         AND (i.business_process_id IS NULL OR bp.id IS NOT NULL)
       ORDER BY bp.name NULLS FIRST`,
    );
    return rows.map((row) => ({ value: row.id, label: row.id ? row.name : null }));
  }

  /**
   * List interfaces by application.
   */
  async listByApplication(applicationId: string, tenantId: string, opts?: ServiceOpts) {
    if (!tenantId) throw new Error('Tenant context is required');
    const appId = this.normalizeRequiredText(applicationId, 'applicationId');
    const mg = opts?.manager ?? this.repo.manager;

    // Ensure the application exists (re-uses existing helper)
    await this.ensureApplication(appId, mg);

    const rows: Array<{
      interface_id: string;
      interface_reference: string;
      interface_code: string;
      interface_name: string;
      environment: string;
      integration_route_type: string;
      source_application_id: string | null;
      source_application_name: string | null;
      target_application_id: string | null;
      target_application_name: string | null;
      middleware_application_ids: string[] | null;
      middleware_application_names: string[] | null;
      via_middleware: boolean;
      is_middleware: boolean;
      is_integration_tool: boolean;
    }> = await mg.query(
      `SELECT DISTINCT ON (i.id, b.environment)
         i.id AS interface_id,
         i.interface_reference,
         i.interface_id AS interface_code,
         i.name AS interface_name,
         b.environment,
         i.integration_route_type,
         sa.id AS source_application_id,
         sa.name AS source_application_name,
         ta.id AS target_application_id,
         ta.name AS target_application_name,
         ARRAY(
           SELECT mw.application_id::text
           FROM interface_middleware_applications mw
           JOIN applications mwa ON mwa.id = mw.application_id AND mwa.tenant_id = mw.tenant_id
           WHERE mw.interface_id = i.id
             AND mw.tenant_id = i.tenant_id
           ORDER BY mwa.name ASC
         ) AS middleware_application_ids,
         ARRAY(
           SELECT mwa.name
           FROM interface_middleware_applications mw
           JOIN applications mwa ON mwa.id = mw.application_id AND mwa.tenant_id = mw.tenant_id
           WHERE mw.interface_id = i.id
             AND mw.tenant_id = i.tenant_id
           ORDER BY mwa.name ASC
         ) AS middleware_application_names,
         (i.integration_route_type = 'via_middleware') AS via_middleware,
         EXISTS (
           SELECT 1
           FROM interface_middleware_applications mw
           WHERE mw.interface_id = i.id
             AND mw.application_id = $2
         ) AS is_middleware,
         EXISTS (
           SELECT 1
           FROM interface_bindings b2
           WHERE b2.interface_id = i.id
             AND b2.integration_tool_application_id = $2
         ) AS is_integration_tool
       FROM interface_bindings b
       JOIN interfaces i ON i.id = b.interface_id
       JOIN interface_legs l ON l.id = b.interface_leg_id
       JOIN app_instances si ON si.id = b.source_instance_id
       JOIN app_instances ti ON ti.id = b.target_instance_id
       LEFT JOIN applications sa ON sa.id = i.source_application_id
       LEFT JOIN applications ta ON ta.id = i.target_application_id
       WHERE i.tenant_id = $1
         AND (
           i.source_application_id = $2
           OR i.target_application_id = $2
           OR EXISTS (
             SELECT 1
             FROM interface_middleware_applications mw2
             WHERE mw2.interface_id = i.id
               AND mw2.application_id = $2
           )
           OR b.integration_tool_application_id = $2
         )
       ORDER BY i.id, b.environment, b.created_at ASC`,
      [tenantId, appId],
    );

    const items = rows.map((row) => ({
      id: row.interface_id,
      interface_reference: row.interface_reference,
      interface_id: row.interface_code,
      name: row.interface_name,
      environment: row.environment,
      source_application_id: row.source_application_id,
      source_application_name: row.source_application_name,
      target_application_id: row.target_application_id,
      target_application_name: row.target_application_name,
      middleware_application_ids: row.middleware_application_ids || [],
      middleware_application_names: row.middleware_application_names || [],
      via_middleware: !!(row.via_middleware || row.is_middleware || row.is_integration_tool),
    }));

    return { items };
  }

  /**
   * Get map data for interface visualization.
   */
  async getMap(query: any, tenantId: string, opts?: ServiceOpts) {
    if (!tenantId) {
      throw new Error('Tenant context is required');
    }
    const manager = opts?.manager ?? this.repo.manager;
    const environment = this.normalizeEnvironment(query?.environment);
    const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
    const allowedLifecycles = (settings.lifecycleStates || []).map((item) => item.code);
    const lifecycleFilters = this.normalizeLifecycleFilters(query?.lifecycles, allowedLifecycles);
    const includeBindings = String(query?.includeBindings ?? 'true').toLowerCase() !== 'false';

    const bindingRows: Array<any> = await manager.query(
      `SELECT
         b.id AS binding_id,
         b.interface_id,
         b.interface_leg_id,
         l.leg_type,
         l.from_role,
         l.to_role,
         b.environment,
         b.source_instance_id,
         b.target_instance_id,
         si.application_id AS binding_source_application_id,
         ti.application_id AS binding_target_application_id,
         b.integration_tool_application_id,
         b.status AS binding_status,
         b.source_endpoint,
         b.target_endpoint,
         b.trigger_details,
         b.env_job_name,
         b.authentication_mode,
         b.monitoring_url,
         b.env_notes,
         i.interface_id AS interface_code,
         i.interface_reference,
         i.name AS interface_name,
         i.lifecycle AS interface_lifecycle,
         i.criticality AS interface_criticality,
         i.classification_incomplete,
         i.data_category,
         i.contains_pii,
         i.integration_route_type,
         i.source_application_id AS logical_source_application_id,
         i.target_application_id AS logical_target_application_id
       FROM interface_bindings b
       JOIN interfaces i ON i.id = b.interface_id
       JOIN interface_legs l ON l.id = b.interface_leg_id
       JOIN app_instances si ON si.id = b.source_instance_id
       JOIN app_instances ti ON ti.id = b.target_instance_id
       WHERE i.tenant_id = $1
         AND b.environment = $2
         AND i.lifecycle = ANY($3::text[])`,
      [tenantId, environment, lifecycleFilters],
    );

    if (bindingRows.length === 0) {
      return {
        environment,
        lifecycles: lifecycleFilters,
        nodes: [],
        interfaces: [],
        bindings: includeBindings ? [] : undefined,
      };
    }

    type InterfaceAccumulator = {
      id: string;
      interface_code: string;
      interface_reference: string;
      name: string;
      lifecycle: string;
      criticality: string | null;
      classification_incomplete: boolean;
      data_category: string;
      contains_pii: boolean;
      integration_route_type: RouteType;
      source_application_id: string;
      target_application_id: string;
      bindingsCount: number;
      middlewareIds: Set<string>;
    };

    const interfacesById = new Map<string, InterfaceAccumulator>();
    const bindingsForResponse: any[] = [];
    const applicationIds = new Set<string>();

    for (const row of bindingRows) {
      const existing = interfacesById.get(row.interface_id);
      if (!existing) {
        interfacesById.set(row.interface_id, {
          id: row.interface_id,
          interface_code: row.interface_code,
          interface_reference: row.interface_reference,
          name: row.interface_name,
          lifecycle: row.interface_lifecycle,
          criticality: row.interface_criticality,
          classification_incomplete: !!row.classification_incomplete,
          data_category: row.data_category,
          contains_pii: !!row.contains_pii,
          integration_route_type: row.integration_route_type as RouteType,
          source_application_id: row.logical_source_application_id,
          target_application_id: row.logical_target_application_id,
          bindingsCount: 0,
          middlewareIds: new Set<string>(),
        });
      }
      const acc = interfacesById.get(row.interface_id)!;
      acc.bindingsCount += 1;
      if (row.integration_tool_application_id) {
        acc.middlewareIds.add(row.integration_tool_application_id);
      }

      if (row.logical_source_application_id) {
        applicationIds.add(row.logical_source_application_id);
      }
      if (row.logical_target_application_id) {
        applicationIds.add(row.logical_target_application_id);
      }
      if (row.integration_tool_application_id) {
        applicationIds.add(row.integration_tool_application_id);
      }

      if (includeBindings) {
        bindingsForResponse.push({
          id: row.binding_id,
          interface_id: row.interface_id,
          leg_id: row.interface_leg_id,
          leg_type: row.leg_type,
          from_role: row.from_role,
          to_role: row.to_role,
          environment: row.environment,
          source_instance_id: row.source_instance_id,
          target_instance_id: row.target_instance_id,
          source_application_id: row.binding_source_application_id,
          target_application_id: row.binding_target_application_id,
          integration_tool_application_id: row.integration_tool_application_id,
          status: normalizeBindingLifecycle(row.binding_status),
          source_endpoint: row.source_endpoint,
          target_endpoint: row.target_endpoint,
          trigger_details: row.trigger_details,
          env_job_name: row.env_job_name,
          authentication_mode: row.authentication_mode,
          monitoring_url: row.monitoring_url,
          env_notes: row.env_notes,
        });
      }
    }

    const interfaceIds = Array.from(interfacesById.keys());
    if (interfaceIds.length > 0) {
      const middlewareRows: Array<{ interface_id: string; application_id: string }> = await manager.query(
        `SELECT interface_id, application_id
         FROM interface_middleware_applications
         WHERE tenant_id = $1
           AND interface_id = ANY($2::uuid[])`,
        [tenantId, interfaceIds],
      );
      for (const mw of middlewareRows) {
        const acc = interfacesById.get(mw.interface_id);
        if (!acc) continue;
        if (mw.application_id) {
          acc.middlewareIds.add(mw.application_id);
          applicationIds.add(mw.application_id);
        }
      }
    }

    const middlewareNodeIds = new Set<string>();
    for (const acc of interfacesById.values()) {
      for (const mid of acc.middlewareIds) {
        middlewareNodeIds.add(mid);
      }
    }

    const interfacePayload = Array.from(interfacesById.values()).map((acc) => ({
      id: acc.id,
      interface_id: acc.interface_code,
      interface_reference: acc.interface_reference,
      name: acc.name,
      source_application_id: acc.source_application_id,
      target_application_id: acc.target_application_id,
      lifecycle: acc.lifecycle,
      criticality: acc.criticality,
      classification_incomplete: acc.classification_incomplete,
      data_category: acc.data_category,
      contains_pii: acc.contains_pii,
      integration_route_type: acc.integration_route_type,
      bindings_count: acc.bindingsCount,
      has_middleware: acc.middlewareIds.size > 0,
      middleware_application_ids: Array.from(acc.middlewareIds),
    }));

    const degreeByApp = new Map<string, { in: number; out: number }>();
    for (const acc of interfacePayload) {
      const sourceStats = degreeByApp.get(acc.source_application_id) ?? { in: 0, out: 0 };
      sourceStats.out += 1;
      degreeByApp.set(acc.source_application_id, sourceStats);
      const targetStats = degreeByApp.get(acc.target_application_id) ?? { in: 0, out: 0 };
      targetStats.in += 1;
      degreeByApp.set(acc.target_application_id, targetStats);
    }

    type MapNodeResponse = {
      id: string;
      name: string;
      lifecycle: string;
      criticality: string | null;
      external_facing: boolean;
      is_middleware: boolean;
      in_degree: number;
      out_degree: number;
      total_interfaces: number;
    };

    const appIds = Array.from(applicationIds).filter(Boolean);
    const nodes: MapNodeResponse[] = [];
    if (appIds.length > 0) {
      const appRepo = this.getAppRepo(manager);
      const apps = await appRepo.findBy({ id: In(appIds) });
      const appsById = new Map(apps.map((app) => [app.id, app]));
      for (const id of appIds) {
        const app = appsById.get(id);
        if (!app) continue;
        const degree = degreeByApp.get(id) ?? { in: 0, out: 0 };
        nodes.push({
          id: app.id,
          name: app.name,
          lifecycle: app.lifecycle,
          criticality: app.criticality,
          external_facing: !!app.external_facing,
          is_middleware: middlewareNodeIds.has(app.id),
          in_degree: degree.in,
          out_degree: degree.out,
          total_interfaces: degree.in + degree.out,
        });
      }
    }

    return {
      environment,
      lifecycles: lifecycleFilters,
      nodes,
      interfaces: interfacePayload,
      bindings: includeBindings ? bindingsForResponse : undefined,
    };
  }
}
