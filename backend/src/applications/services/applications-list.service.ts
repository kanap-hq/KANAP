import { classificationSqlExpressions } from '../../it-ops-settings/classification-sql';
import { linkedLineOf } from '../../spend/budget-nature';
import { catalogFromMetadata } from '../../it-ops-settings/classification-catalog';
import { classificationReadState } from './application-classification';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Application } from '../application.entity';
import { parsePagination } from '../../common/pagination';
import {
  applicationParticipantCondition,
  applyApplicationParticipantScope,
} from '../../auth/business-contributor-scope';
import {
  buildQuickSearchConditions,
  compileAgFilterCondition,
  createParamNameGenerator,
  FilterTargetConfig,
  CompiledCondition,
  normalizeAgFilterModel,
  assertSetFilterModes,
} from '../../common/ag-grid-filtering';
import { ApplicationsBaseService, ServiceOpts } from './applications-base.service';
import { buildDerivedUsersByApp } from './derived-users';

export type ClassificationSummary = {
  total: number; reviewed: number; stale: number; incomplete: number;
  /** Points a compliance owner acts on, against the active catalog extremes. */
  attention: { critical_without_recent_test: number; critical_without_wave: number; restricted_data_low_cyber: number };
  /** Codes behind the attention counts, so the client can deep-link the filtered lists. */
  levels: { critical: string[]; restricted_data: string[]; low_cyber: string[] };
};

const classificationSql = classificationSqlExpressions('a');
const classificationTargets: Record<string, FilterTargetConfig> = {
  ...Object.fromEntries(['rto_minutes', 'rpo_minutes'].map((field) => [field, { expression: `a.${field}`, numericExpression: `a.${field}`, dataType: 'number' as const }])),
  ...Object.fromEntries(['cyber_criticality', 'recovery_wave', 'classification_justification'].map((field) => [field, { expression: `a.${field}`, dataType: 'string' as const }])),
  ...Object.fromEntries(Object.entries(classificationSql).map(([field, expression]) => [field, { expression, numericExpression: expression, dataType: field.includes('rank') || field.endsWith('_order') ? 'number' as const : 'string' as const }])),
};
const classificationSort: Record<string, string> = { ...classificationSql, criticality: classificationSql.criticality_rank, cyber_criticality: classificationSql.cyber_criticality_rank, data_class: classificationSql.data_class_rank, recovery_wave: classificationSql.recovery_wave_order };

type ParamNameFactory = () => string;
type SetFilterModel = { filterType: 'set'; values: any[] };
type OwnerScope = { ownerUserId?: string; ownerTeamId?: string };

const normalizeScopeValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseOwnerScope = (query: any): OwnerScope => ({
  ownerUserId: normalizeScopeValue(query?.ownerUserId),
  ownerTeamId: normalizeScopeValue(query?.ownerTeamId),
});

const parseIncludeInactive = (query: any): boolean => {
  const raw = query?.include_inactive;
  if (raw === true || raw === 'true' || raw === '1') return true;
  return false;
};

const applyOwnerScopeCondition = (qb: SelectQueryBuilder<Application>, scope: OwnerScope) => {
  const ownerUserId = scope.ownerUserId;
  const ownerTeamId = scope.ownerTeamId;
  if (!ownerUserId && !ownerTeamId) return;

  if (ownerUserId && ownerTeamId) {
    qb.andWhere(
      `EXISTS (
        SELECT 1
        FROM application_owners ao
        WHERE ao.application_id = a.id
          AND ao.tenant_id = a.tenant_id
          AND (
            ao.user_id = :ownerUserId
            OR ao.user_id IN (
              SELECT tmc.user_id
              FROM portfolio_team_member_configs tmc
              WHERE tmc.team_id = :ownerTeamId
            )
          )
      )`,
      { ownerUserId, ownerTeamId },
    );
    return;
  }

  if (ownerUserId) {
    qb.andWhere(
      `EXISTS (
        SELECT 1
        FROM application_owners ao
        WHERE ao.application_id = a.id
          AND ao.tenant_id = a.tenant_id
          AND ao.user_id = :ownerUserId
      )`,
      { ownerUserId },
    );
    return;
  }

  qb.andWhere(
    `EXISTS (
      SELECT 1
      FROM application_owners ao
      WHERE ao.application_id = a.id
        AND ao.tenant_id = a.tenant_id
        AND ao.user_id IN (
          SELECT tmc.user_id
          FROM portfolio_team_member_configs tmc
          WHERE tmc.team_id = :ownerTeamId
        )
    )`,
    { ownerTeamId },
  );
};

const applyExplicitTenantConstraint = (
  qb: SelectQueryBuilder<Application>,
  tenantId?: string,
) => {
  if (!tenantId) return;
  qb.andWhere('a.tenant_id = :tenantId', { tenantId });
};

const normalizeSetFilterModel = (model: any): SetFilterModel | null => {
  const normalized = normalizeAgFilterModel(model);
  if (normalized && normalized.filterType === 'set' && Array.isArray(normalized.values)) {
    return normalized as SetFilterModel;
  }
  return null;
};

const buildActiveInstanceCondition = (alias = 'ai') => {
  const lifecycle = `NULLIF(${alias}.lifecycle, '')`;
  const status = `NULLIF(${alias}.status, '')`;
  return `(
    (${lifecycle} IS NOT NULL AND ${lifecycle} = 'active')
    OR (${lifecycle} IS NULL AND ${status} IS NOT NULL AND ${status} = 'enabled')
    OR (${lifecycle} IS NULL AND ${status} IS NULL AND (${alias}.disabled_at IS NULL OR ${alias}.disabled_at > NOW()))
  )`;
};

const buildApplicationOwnerNamesSql = (ownerType: 'business' | 'it', alias = 'a'): string => `COALESCE((
  SELECT string_agg(owner.name, ', ' ORDER BY owner.name)
  FROM (
    SELECT DISTINCT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS name
    FROM application_owners o
    LEFT JOIN users u ON u.id = o.user_id AND u.tenant_id = ${alias}.tenant_id
    WHERE o.application_id = ${alias}.id
      AND o.tenant_id = ${alias}.tenant_id
      AND o.owner_type = '${ownerType}'
  ) owner
), '')`;

/**
 * Fields whose filter the compilers below read rather than `compileAgFilterCondition`: they take a set
 * model's `values` as the ticked values, so an exclude model answers 400 there (`assertSetFilterModes`).
 */
const CUSTOM_SET_FILTER_FIELDS = new Set(['environments', 'hosting_types', 'linked_project_name', 'owners_business', 'owners_it']);

const compileEnvironmentsSetFilter = (model: any, nextParam: ParamNameFactory): CompiledCondition | null => {
  const normalized = normalizeSetFilterModel(model);
  if (!normalized) return null;
  const values = normalized.values.filter((v: any) => v !== null && v !== undefined && v !== '');
  if (values.length === 0) return { sql: '1=0', params: {} };
  const param = nextParam();
  const activeCondition = buildActiveInstanceCondition('ai');
  return {
    sql: `EXISTS (
      SELECT 1 FROM app_instances ai
      WHERE ai.application_id = a.id
        AND ai.tenant_id = a.tenant_id
        AND ${activeCondition}
        AND ai.environment IN (:...${param})
    )`,
    params: { [param]: values },
  };
};

const compileHostingTypesSetFilter = (model: any, nextParam: ParamNameFactory): CompiledCondition | null => {
  const normalized = normalizeSetFilterModel(model);
  if (!normalized) return null;
  const values = normalized.values.filter((v: any) => v !== null && v !== undefined && v !== '');
  if (values.length === 0) return { sql: '1=0', params: {} };
  const param = nextParam();
  return {
    sql: `EXISTS (
      SELECT 1
      FROM app_instances ai
      JOIN app_asset_assignments aaa ON aaa.app_instance_id = ai.id AND aaa.tenant_id = ai.tenant_id
      JOIN assets ast ON ast.id = aaa.asset_id AND ast.tenant_id = ai.tenant_id
      LEFT JOIN locations l ON l.id = ast.location_id AND l.tenant_id = ai.tenant_id
      WHERE ai.application_id = a.id
        AND ai.tenant_id = a.tenant_id
        AND l.hosting_type IN (:...${param})
    )`,
    params: { [param]: values },
  };
};

const compileLinkedProjectTextFilter = (model: any, nextParam: ParamNameFactory): CompiledCondition | null => {
  const normalized = normalizeAgFilterModel(model);
  if (!normalized || typeof normalized !== 'object') return null;
  const filterText = String(normalized.filter ?? normalized.value ?? '').trim();
  if (!filterText) return null;

  const type = String(normalized.type || 'contains');
  const param = nextParam();
  const refExpr = `('PRJ-' || p_link.item_number::text)`;
  let predicate = '';
  let value = filterText;

  switch (type) {
    case 'equals':
      predicate = `(p_link.name = :${param} OR ${refExpr} = :${param})`;
      break;
    case 'startsWith':
      value = `${filterText}%`;
      predicate = `(p_link.name ILIKE :${param} OR ${refExpr} ILIKE :${param})`;
      break;
    case 'endsWith':
      value = `%${filterText}`;
      predicate = `(p_link.name ILIKE :${param} OR ${refExpr} ILIKE :${param})`;
      break;
    case 'contains':
    default:
      value = `%${filterText}%`;
      predicate = `(p_link.name ILIKE :${param} OR ${refExpr} ILIKE :${param})`;
      break;
  }

  return {
    sql: `EXISTS (
      SELECT 1
      FROM application_projects ap
      JOIN portfolio_projects p_link ON p_link.id = ap.project_id AND p_link.tenant_id = a.tenant_id
      WHERE ap.application_id = a.id
        AND ap.tenant_id = a.tenant_id
        AND ${predicate}
    )`,
    params: { [param]: value },
  };
};

const compileOwnerNameFilter = (
  ownerType: 'business' | 'it',
  model: any,
  nextParam: ParamNameFactory,
): CompiledCondition | null => {
  const setModel = normalizeSetFilterModel(model);
  const displayExpr = `COALESCE(NULLIF(TRIM(CONCAT(u_owner.first_name, ' ', u_owner.last_name)), ''), u_owner.email)`;

  if (setModel) {
    const values = setModel.values.filter((value: any) => value !== null && value !== undefined && value !== '');
    if (values.length === 0) {
      return { sql: '1=0', params: {} };
    }
    const param = nextParam();
    return {
      sql: `EXISTS (
        SELECT 1
        FROM application_owners ao
        JOIN users u_owner ON u_owner.id = ao.user_id AND u_owner.tenant_id = a.tenant_id
        WHERE ao.application_id = a.id
          AND ao.tenant_id = a.tenant_id
          AND ao.owner_type = '${ownerType}'
          AND ${displayExpr} IN (:...${param})
      )`,
      params: { [param]: values },
    };
  }

  const normalized = normalizeAgFilterModel(model);
  if (!normalized || typeof normalized !== 'object') return null;
  const filterText = String(normalized.filter ?? normalized.value ?? '').trim();
  if (!filterText) return null;

  const param = nextParam();
  const type = String(normalized.type || 'contains');
  let predicate = '';
  let value = filterText;

  switch (type) {
    case 'equals':
      predicate = `${displayExpr} = :${param}`;
      break;
    case 'startsWith':
      value = `${filterText}%`;
      predicate = `${displayExpr} ILIKE :${param}`;
      break;
    case 'endsWith':
      value = `%${filterText}`;
      predicate = `${displayExpr} ILIKE :${param}`;
      break;
    case 'notContains':
      value = `%${filterText}%`;
      predicate = `${displayExpr} NOT ILIKE :${param}`;
      break;
    case 'contains':
    default:
      value = `%${filterText}%`;
      predicate = `${displayExpr} ILIKE :${param}`;
      break;
  }

  return {
    sql: `EXISTS (
      SELECT 1
      FROM application_owners ao
      JOIN users u_owner ON u_owner.id = ao.user_id AND u_owner.tenant_id = a.tenant_id
      WHERE ao.application_id = a.id
        AND ao.tenant_id = a.tenant_id
        AND ao.owner_type = '${ownerType}'
        AND ${predicate}
    )`,
    params: { [param]: value },
  };
};

/**
 * Service for listing and filtering applications.
 */
@Injectable()
export class ApplicationsListService extends ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) appRepo: Repository<Application>,
  ) {
    super(appRepo);
  }

  /**
   * List applications with filtering, sorting, and pagination.
   */
  /**
   * Everything the grid can filter on, compiled once and shared by the list, the ids export and the
   * classification summary so the three always agree: tenant, supplier join, inactive rows, participant
   * scope, owner scope, default lifecycle rule, AG Grid filters and quick search.
   */
  private buildFilteredScope(query: any, opts: ServiceOpts | undefined, sortField?: string) {
    const tenantId = String(opts?.tenantId || '').trim();
    const { q, filters } = parsePagination(query, { field: 'created_at', direction: 'DESC' });
    assertSetFilterModes(filters, (field) => !CUSTOM_SET_FILTER_FIELDS.has(field));
    const ownerScope = parseOwnerScope(query);
    const includeInactive = parseIncludeInactive(query);
    const includeRaw = String(query?.include || '').trim();
    const include = new Set(includeRaw.split(',').map((s) => s.trim()).filter(Boolean));
    const fm = (filters && typeof filters === 'object') ? filters : undefined;

    // Define filter targets for AG Grid model -> SQL translation
    type Target = FilterTargetConfig;
    const targets: Record<string, Target> = {
      ...classificationTargets,
      id: { expression: 'a.id', dataType: 'string' },
      sequential_id: { expression: 'a.sequential_id', dataType: 'string' },
      name: { expression: 'a.name', dataType: 'string' },
      supplier_id: { expression: 'a.supplier_id', dataType: 'string' },
      category: { expression: 'a.category', dataType: 'string' },
      editor: { expression: 'a.editor', dataType: 'string' },
      environment: { expression: 'a.environment', dataType: 'string' },
      lifecycle: { expression: 'a.lifecycle', dataType: 'string' },
      criticality: { expression: 'a.criticality', dataType: 'string' },
      data_class: { expression: 'a.data_class', dataType: 'string' },
      hosting_model: { expression: 'a.hosting_model', dataType: 'string' },
      external_facing: { expression: 'a.external_facing', numericExpression: 'COALESCE(a.external_facing, false)', dataType: 'boolean' },
      is_suite: { expression: 'a.is_suite', dataType: 'boolean' },
      retired_date: { expression: 'a.retired_date', textExpression: 'CAST(a.retired_date AS TEXT)', dataType: 'string' },
      last_dr_test: { expression: 'a.last_dr_test', textExpression: 'CAST(a.last_dr_test AS TEXT)', dataType: 'string' },
      sso_enabled: { expression: 'a.sso_enabled', numericExpression: 'COALESCE(a.sso_enabled, false)', dataType: 'boolean' },
      mfa_supported: { expression: 'a.mfa_supported', numericExpression: 'COALESCE(a.mfa_supported, false)', dataType: 'boolean' },
      etl_enabled: { expression: 'a.etl_enabled', numericExpression: 'COALESCE(a.etl_enabled, false)', dataType: 'boolean' },
      contains_pii: { expression: 'a.contains_pii', numericExpression: 'COALESCE(a.contains_pii, false)', dataType: 'boolean' },
      users_mode: { expression: 'a.users_mode', dataType: 'string' },
      users_year: { expression: 'a.users_year', numericExpression: 'a.users_year', dataType: 'number' },
      users_override: { expression: 'a.users_override', numericExpression: 'a.users_override', dataType: 'number' },
      status: { expression: 'a.status', textExpression: 'CAST(a.status AS TEXT)', dataType: 'string' },
      disabled_at: { expression: 'a.disabled_at', textExpression: 'CAST(a.disabled_at AS TEXT)', dataType: 'string' },
      created_at: { expression: 'a.created_at', textExpression: 'CAST(a.created_at AS TEXT)', dataType: 'string' },
      updated_at: { expression: 'a.updated_at', textExpression: 'CAST(a.updated_at AS TEXT)', dataType: 'string' },
    };

    // Environment summary based on instances
    targets['environments'] = {
      expression: 'a.id',
      textExpression:
        `COALESCE((SELECT string_agg(ai.environment, ',') ` +
        `FROM app_instances ai ` +
        `WHERE ai.application_id = a.id AND ai.tenant_id = a.tenant_id), '')`,
      dataType: 'string',
    };

    if (include.has('supplier') || (fm && Object.prototype.hasOwnProperty.call(fm, 'supplier_name')) || sortField === 'supplier_name') {
      targets['supplier_name'] = { expression: 's.name', dataType: 'string' };
    }

    // Derived filter targets
    targets['spend_count'] = { expression: 'a.id', numericExpression: `(SELECT COUNT(*) FROM application_spend_items l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id${linkedLineOf('l.tenant_id', 'l.spend_item_id', 'opex')})`, dataType: 'number' };
    targets['capex_count'] = { expression: 'a.id', numericExpression: `(SELECT COUNT(*) FROM application_spend_items l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id${linkedLineOf('l.tenant_id', 'l.spend_item_id', 'capex')})`, dataType: 'number' };
    targets['contracts_count'] = { expression: 'a.id', numericExpression: `(SELECT COUNT(*) FROM application_contracts l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id)`, dataType: 'number' };
    targets['suites_count'] = { expression: 'a.id', numericExpression: `(SELECT COUNT(*) FROM application_suites l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id)`, dataType: 'number' };
    targets['components_count'] = { expression: 'a.id', numericExpression: `(SELECT COUNT(*) FROM application_suites l WHERE l.suite_id = a.id AND l.tenant_id = a.tenant_id)`, dataType: 'number' };
    targets['owners_business'] = { expression: 'a.id', textExpression: buildApplicationOwnerNamesSql('business'), dataType: 'string' };
    targets['owners_it'] = { expression: 'a.id', textExpression: buildApplicationOwnerNamesSql('it'), dataType: 'string' };
    targets['data_residency'] = { expression: 'a.id', textExpression: `COALESCE((SELECT string_agg(dr.country_iso, ',') FROM application_data_residency dr WHERE dr.application_id = a.id AND dr.tenant_id = a.tenant_id), '')`, dataType: 'string' };
    targets['hosting_types'] = {
      expression: 'a.id',
      textExpression: `COALESCE((SELECT string_agg(DISTINCT l.hosting_type, ',')
        FROM app_instances ai
        JOIN app_asset_assignments aaa ON aaa.app_instance_id = ai.id AND aaa.tenant_id = ai.tenant_id
        JOIN assets ast ON ast.id = aaa.asset_id AND ast.tenant_id = ai.tenant_id
        LEFT JOIN locations l ON l.id = ast.location_id AND l.tenant_id = ai.tenant_id
        WHERE ai.application_id = a.id AND ai.tenant_id = a.tenant_id AND l.hosting_type IS NOT NULL), '')`,
      dataType: 'string',
    };
    const lifecycleFilterPresent = !!(fm && Object.prototype.hasOwnProperty.call(fm, 'lifecycle'));

    const nextParam = createParamNameGenerator('p');
    const compiledFilters: CompiledCondition[] = [];
    if (fm) {
      for (const [field, model] of Object.entries(fm)) {
        if (field === 'environments') {
          const custom = compileEnvironmentsSetFilter(model, nextParam);
          if (custom) {
            compiledFilters.push(custom);
            continue;
          }
        }
        if (field === 'hosting_types') {
          const custom = compileHostingTypesSetFilter(model, nextParam);
          if (custom) {
            compiledFilters.push(custom);
            continue;
          }
        }
        if (field === 'linked_project_name') {
          const custom = compileLinkedProjectTextFilter(model, nextParam);
          if (custom) {
            compiledFilters.push(custom);
            continue;
          }
        }
        if (field === 'owners_business') {
          const custom = compileOwnerNameFilter('business', model, nextParam);
          if (custom) {
            compiledFilters.push(custom);
            continue;
          }
        }
        if (field === 'owners_it') {
          const custom = compileOwnerNameFilter('it', model, nextParam);
          if (custom) {
            compiledFilters.push(custom);
            continue;
          }
        }
        const target = targets[field];
        if (!target) continue;
        const cond = compileAgFilterCondition(model, target, nextParam);
        if (cond) compiledFilters.push(cond);
      }
    }
    const quickSearch = q ? buildQuickSearchConditions(q, ['a.name', buildApplicationOwnerNamesSql('it')], nextParam) : [];

    const applyCompiledFilters = (builder: SelectQueryBuilder<Application>) => {
      compiledFilters.forEach((c) => {
        builder.andWhere(new Brackets((qb) => qb.where(c.sql, c.params)));
      });
    };

    const applyQuickSearch = (builder: SelectQueryBuilder<Application>) => {
      if (quickSearch.length === 0) return;
      builder.andWhere(
        new Brackets((sub) => {
          quickSearch.forEach((cond, idx) => {
            if (idx === 0) sub.where(cond.sql, cond.params);
            else sub.orWhere(cond.sql, cond.params);
          });
        }),
      );
    };

    const needsSupplierJoin = include.has('supplier') || (fm && Object.prototype.hasOwnProperty.call(fm, 'supplier_name')) || sortField === 'supplier_name';

    const applyTo = (builder: SelectQueryBuilder<Application>, options?: { selectSupplier?: boolean }) => {
      applyExplicitTenantConstraint(builder, tenantId);
      if (needsSupplierJoin) {
        builder.leftJoin('suppliers', 's', 's.id = a.supplier_id AND s.tenant_id = a.tenant_id');
        if (options?.selectSupplier) builder.addSelect('s.name', 's_name');
      }
      if (!includeInactive) builder.andWhere('(a.disabled_at IS NULL OR a.disabled_at > NOW())');
      applyApplicationParticipantScope(builder, opts?.accessScope, 'a');
      applyOwnerScopeCondition(builder, ownerScope);
      if (!includeInactive && !lifecycleFilterPresent) builder.andWhere(`a.lifecycle <> 'retired'`);
      applyCompiledFilters(builder);
      applyQuickSearch(builder);
    };
    return { tenantId, include, needsSupplierJoin, applyTo };
  }

  async list(query: any, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(Application);
    const { page, limit, skip, sort } = parsePagination(query, { field: 'created_at', direction: 'DESC' });
    const { include, needsSupplierJoin, applyTo } = this.buildFilteredScope(query, opts, sort.field);

    // Count query
    const qbBase = repo.createQueryBuilder('a');
    applyTo(qbBase);
    const total = await qbBase.getCount();

    // Page query
    const qb = repo.createQueryBuilder('a');
    applyTo(qb, { selectSupplier: true });

    // Sorting
    const appFields = new Set([
      ...Object.keys(classificationTargets),
      'id', 'name', 'supplier_id', 'category', 'editor', 'environment', 'lifecycle', 'criticality',
      'data_class', 'hosting_model', 'external_facing', 'is_suite', 'last_dr_test', 'sso_enabled',
      'mfa_supported', 'etl_enabled', 'contains_pii', 'users_mode', 'users_year', 'users_override',
      'status', 'disabled_at', 'created_at', 'updated_at',
    ]);
    const direction: 'ASC' | 'DESC' = (String(sort.direction).toUpperCase() === 'ASC' ? 'ASC' : 'DESC');
    if (classificationSort[sort.field]) {
      qb.addSelect(classificationSort[sort.field], 'classification_sort_value');
      qb.orderBy('classification_sort_value', direction, 'NULLS LAST');
    } else if (sort.field === 'supplier_name' && needsSupplierJoin) {
      qb.addOrderBy('s.name', direction);
    } else if (include.has('counts') && sort.field === 'spend_count') {
      qb.addOrderBy(`(SELECT COUNT(*) FROM application_spend_items l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id${linkedLineOf('l.tenant_id', 'l.spend_item_id', 'opex')})`, direction, direction === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST');
    } else if (include.has('counts') && sort.field === 'capex_count') {
      qb.addOrderBy(`(SELECT COUNT(*) FROM application_spend_items l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id${linkedLineOf('l.tenant_id', 'l.spend_item_id', 'capex')})`, direction, direction === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST');
    } else if (include.has('counts') && sort.field === 'contracts_count') {
      qb.addOrderBy(`(SELECT COUNT(*) FROM application_contracts l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id)`, direction, direction === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST');
    } else if (include.has('structure') && sort.field === 'suites_count') {
      qb.addOrderBy(`(SELECT COUNT(*) FROM application_suites l WHERE l.application_id = a.id AND l.tenant_id = a.tenant_id)`, direction, direction === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST');
    } else if (include.has('structure') && sort.field === 'components_count') {
      qb.addOrderBy(`(SELECT COUNT(*) FROM application_suites l WHERE l.suite_id = a.id AND l.tenant_id = a.tenant_id)`, direction, direction === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST');
    } else if (appFields.has(sort.field)) {
      qb.orderBy(classificationTargets[sort.field]?.expression ?? `a.${sort.field}`, direction, 'NULLS LAST');
    } else {
      qb.orderBy('a.created_at', 'DESC');
    }
    qb.addOrderBy('a.id', 'ASC');
    qb.skip(skip).take(limit);

    const { raw, entities } = await qb.getRawAndEntities();
    const pageIds = entities.map((e) => e.id);

    // Prepare expansions
    const expansions = await this.buildExpansions(pageIds, include, mg);
    // Batched: one set of queries for the whole page instead of 2-5 per application.
    const derivedUsersByApp = await buildDerivedUsersByApp(entities, mg);

    const tenantRows = await mg.query('SELECT metadata FROM tenants WHERE id = app_current_tenant()');
    const catalog = catalogFromMetadata(tenantRows[0]?.metadata?.it_ops);
    // Compute derived users per row and attach expansions
    const items = await Promise.all(
      entities.map(async (app, idx) => {
        const base: any = { ...app, ...classificationReadState(app) };
        for (const [field, options, output, rankField] of [
          ['criticality', catalog.businessCriticalityLevels, 'business_criticality_label', 'business_criticality_rank'],
          ['cyber_criticality', catalog.cyberCriticalityLevels, 'cyber_criticality_label', 'cyber_criticality_rank'],
          ['data_class', catalog.dataClasses, 'data_class_label', 'data_class_rank'],
          ['recovery_wave', catalog.recoveryWaves, 'recovery_wave_label', 'recovery_wave_order'],
        ] as const) {
          const option = options.find((item) => item.code === base[field]);
          base[output] = option?.label ?? base[field] ?? null;
          base[rankField] = option ? ('rank' in option ? option.rank : option.order) : null;
        }
        if (include.has('supplier')) {
          const r = (raw[idx] || {}) as any;
          base.supplier_name = r.s_name || null;
        }
        if (include.has('owners')) {
          const ow = expansions.ownersByApp[app.id] || { business: [], it: [] };
          base.owners_business = ow.business;
          base.owners_it = ow.it;
        }
        if (include.has('residency')) {
          base.data_residency = expansions.residencyByApp[app.id] || [];
        }
        if (include.has('hosting')) {
          base.hosting_types = expansions.hostingByApp[app.id] || [];
        }
        if (include.has('counts')) {
          const s = expansions.spendAgg[app.id];
          const cpx = expansions.capexAgg[app.id];
          const ct = expansions.contractAgg[app.id];
          base.spend_count = s?.c || 0;
          base.spend_first_name = s?.first_name || null;
          base.capex_count = cpx?.c || 0;
          base.capex_first_description = cpx?.first_description || null;
          base.contracts_count = ct?.c || 0;
          base.contracts_first_name = ct?.first_name || null;
        }
        if (include.has('structure')) {
          const su = expansions.suitesAgg[app.id];
          const co = expansions.componentsAgg[app.id];
          base.suites_count = su?.c || 0;
          base.first_suite_name = su?.first_name || null;
          base.components_count = co?.c || 0;
          base.first_component_name = co?.first_name || null;
        }
        if (include.has('instances')) {
          base.instances = expansions.instancesByApp[app.id] || [];
        }
        if (include.has('deployments')) {
          base.deployments = expansions.instancesByApp[app.id] || [];
        }
        base.derived_total_users = derivedUsersByApp[app.id] ?? 0;
        return base;
      }),
    );

    return { items, total, page, limit };
  }

  /**
   * Return ordered list of matching application IDs for navigation.
   */
  async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(Application);
    const { sort } = parsePagination(query, { field: 'created_at', direction: 'DESC' });
    const { applyTo } = this.buildFilteredScope(query, opts, sort.field);

    // Same filters and scope as the grid, ids only
    const qb = repo.createQueryBuilder('a').select('a.id').addSelect('a.sequential_id', 'ref');
    applyTo(qb);

    // Sorting
    const appFields = new Set([
      ...Object.keys(classificationTargets),
      'id', 'name', 'supplier_id', 'category', 'editor', 'environment', 'lifecycle', 'criticality',
      'data_class', 'hosting_model', 'external_facing', 'is_suite', 'sso_enabled', 'mfa_supported',
      'etl_enabled', 'contains_pii', 'users_mode', 'users_year', 'users_override', 'status',
      'created_at', 'updated_at',
    ]);
    const direction: 'ASC' | 'DESC' = (String(sort.direction).toUpperCase() === 'ASC' ? 'ASC' : 'DESC');
    if (classificationSort[sort.field]) {
      qb.addSelect(classificationSort[sort.field], 'classification_sort_value');
      qb.orderBy('classification_sort_value', direction, 'NULLS LAST');
    } else if (appFields.has(sort.field)) {
      qb.orderBy(classificationTargets[sort.field]?.expression ?? `a.${sort.field}`, direction, 'NULLS LAST');
    } else {
      qb.orderBy('a.created_at', 'DESC');
    }

    qb.addOrderBy('a.id', 'ASC');
    const total = await qb.clone().getCount();
    const limit = query?.__classificationExport === true ? undefined : Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const rows: Array<{ a_id: string; ref: string | null }> = await qb.take(limit).getRawMany();
    const ids = rows.map((r) => r.a_id);
    const refs = rows.map((r) => r.ref || r.a_id);

    return { ids, refs, total };
  }

  /**
   * Classification campaign counters for the current grid selection: one aggregate query on the same
   * filters and scope as the list, no sorting, no pagination, always integers. `attention` adds the
   * points a compliance owner acts on, computed against the active catalog extremes.
   */
  async classificationSummary(query: any, opts?: ServiceOpts): Promise<ClassificationSummary> {
    const mg = this.getManager(opts);
    const { tenantId, applyTo } = this.buildFilteredScope(query, opts);
    const tenantRows = tenantId ? await mg.query('SELECT metadata FROM tenants WHERE id = $1', [tenantId]) : await mg.query('SELECT metadata FROM tenants WHERE id = app_current_tenant()');
    const catalog = catalogFromMetadata(tenantRows[0]?.metadata?.it_ops);
    const activeRanks = (levels: Array<{ rank: number; deprecated?: boolean }>) => levels.filter((level) => !level.deprecated).map((level) => level.rank);
    const topBusiness = Math.max(-1, ...activeRanks(catalog.businessCriticalityLevels));
    const topData = Math.max(-1, ...activeRanks(catalog.dataClasses));
    const lowCyber = Math.min(Number.MAX_SAFE_INTEGER, ...activeRanks(catalog.cyberCriticalityLevels));
    const state = classificationSql.classification_review_state;
    const critical = `(${classificationSql.business_criticality_rank}) = :topBusiness`;
    const qb = mg.getRepository(Application).createQueryBuilder('a')
      .select('COUNT(*)::int', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE ${state} = 'reviewed')::int`, 'reviewed')
      .addSelect(`COUNT(*) FILTER (WHERE ${state} = 'stale')::int`, 'stale')
      .addSelect(`COUNT(*) FILTER (WHERE ${state} = 'incomplete')::int`, 'incomplete')
      .addSelect(`COUNT(*) FILTER (WHERE ${critical} AND (a.last_dr_test IS NULL OR a.last_dr_test <= (CURRENT_DATE - INTERVAL '1 year')))::int`, 'critical_without_recent_test')
      .addSelect(`COUNT(*) FILTER (WHERE ${critical} AND a.recovery_wave IS NULL)::int`, 'critical_without_wave')
      .addSelect(`COUNT(*) FILTER (WHERE (${classificationSql.data_class_rank}) = :topData AND (${classificationSql.cyber_criticality_rank}) = :lowCyber)::int`, 'restricted_data_low_cyber')
      .setParameters({ topBusiness, topData, lowCyber });
    applyTo(qb);
    const row = (await qb.getRawOne()) || {};
    const int = (value: unknown) => Number(value) || 0;
    return {
      total: int(row.total), reviewed: int(row.reviewed), stale: int(row.stale), incomplete: int(row.incomplete),
      attention: { critical_without_recent_test: int(row.critical_without_recent_test), critical_without_wave: int(row.critical_without_wave), restricted_data_low_cyber: int(row.restricted_data_low_cyber) },
      levels: {
        critical: catalog.businessCriticalityLevels.filter((level) => !level.deprecated && level.rank === topBusiness).map((level) => level.code),
        restricted_data: catalog.dataClasses.filter((level) => !level.deprecated && level.rank === topData).map((level) => level.code),
        low_cyber: catalog.cyberCriticalityLevels.filter((level) => !level.deprecated && level.rank === lowCyber).map((level) => level.code),
      },
    };
  }

  /**
   * Interfaces (not retired nor deprecated) linking this application to an application restored in a later
   * recovery wave: both must be up for the flow to work, the plan owner judges. One query, tenant-filtered.
   */
  async listRecoveryDependencies(id: string, opts?: ServiceOpts): Promise<{ items: Array<{ interface_id: string; interface_reference: string | null; interface_name: string; direction: 'source' | 'target'; application_id: string; application_ref: string | null; application_name: string; recovery_wave: string }> }> {
    const mg = this.getManager(opts);
    const appId = await this.resolveApplicationIdentifier(id, mg);
    await this.assertVisible(appId, opts?.accessScope, mg);
    const tenantId = await this.getCurrentTenantId(mg);
    const own = classificationSqlExpressions('a').recovery_wave_order;
    const other = classificationSqlExpressions('o').recovery_wave_order;
    const rows = await mg.query(
      `SELECT i.id AS interface_id, i.interface_reference, i.name AS interface_name,
              CASE WHEN i.source_application_id = a.id THEN 'source' ELSE 'target' END AS direction,
              o.id AS application_id, o.sequential_id AS application_ref, o.name AS application_name, o.recovery_wave
       FROM applications a
       JOIN interfaces i ON i.tenant_id = a.tenant_id AND (i.source_application_id = a.id OR i.target_application_id = a.id)
       JOIN applications o ON o.tenant_id = a.tenant_id AND o.id = CASE WHEN i.source_application_id = a.id THEN i.target_application_id ELSE i.source_application_id END
       WHERE a.tenant_id = $1 AND a.id = $2 AND o.id <> a.id
         AND COALESCE(i.lifecycle, '') NOT IN ('retired', 'deprecated')
         AND a.recovery_wave IS NOT NULL AND o.recovery_wave IS NOT NULL
         AND (${other}) > (${own})
       ORDER BY i.interface_reference ASC NULLS LAST, i.name ASC`,
      [tenantId, appId],
    );
    return { items: rows };
  }

  /**
   * Return scoped filter values for checkbox set filters.
   */
  async listFilterValues(query: any, opts?: ServiceOpts): Promise<Record<string, Array<string | boolean | null>>> {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(Application);
    const tenantId = String(opts?.tenantId || '').trim();
    const { q, filters } = parsePagination(query, { field: 'created_at', direction: 'DESC' });
    assertSetFilterModes(filters, (field) => !CUSTOM_SET_FILTER_FIELDS.has(field));
    const ownerScope = parseOwnerScope(query);
    const includeInactive = parseIncludeInactive(query);
    const fm = (filters && typeof filters === 'object') ? filters : undefined;

    const rawFields = String(query?.fields || query?.field || '').split(',').map((f) => f.trim()).filter(Boolean);
    const allowed = new Set([
      ...Object.keys(classificationTargets),
      'category',
      'editor',
      'environment',
      'status',
      'environments',
      'lifecycle',
      'criticality',
      'hosting_model',
      'hosting_types',
      'supplier_name',
      'owners_business',
      'owners_it',
      'data_residency',
      'external_facing',
      'is_suite',
      'sso_enabled',
      'mfa_supported',
      'etl_enabled',
      'data_class',
      'contains_pii',
      'users_mode',
    ]);
    const fields = rawFields.filter((field) => allowed.has(field));
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | boolean | null>> = {};

    const baseTargets: Record<string, FilterTargetConfig> = {
      ...classificationTargets,
      id: { expression: 'a.id', dataType: 'string' },
      name: { expression: 'a.name', dataType: 'string' },
      supplier_id: { expression: 'a.supplier_id', dataType: 'string' },
      category: { expression: 'a.category', dataType: 'string' },
      editor: { expression: 'a.editor', dataType: 'string' },
      environment: { expression: 'a.environment', dataType: 'string' },
      lifecycle: { expression: 'a.lifecycle', dataType: 'string' },
      criticality: { expression: 'a.criticality', dataType: 'string' },
      data_class: { expression: 'a.data_class', dataType: 'string' },
      hosting_model: { expression: 'a.hosting_model', dataType: 'string' },
      external_facing: { expression: 'a.external_facing', numericExpression: 'COALESCE(a.external_facing, false)', dataType: 'boolean' },
      is_suite: { expression: 'a.is_suite', dataType: 'boolean' },
      retired_date: { expression: 'a.retired_date', textExpression: 'CAST(a.retired_date AS TEXT)', dataType: 'string' },
      last_dr_test: { expression: 'a.last_dr_test', textExpression: 'CAST(a.last_dr_test AS TEXT)', dataType: 'string' },
      sso_enabled: { expression: 'a.sso_enabled', numericExpression: 'COALESCE(a.sso_enabled, false)', dataType: 'boolean' },
      mfa_supported: { expression: 'a.mfa_supported', numericExpression: 'COALESCE(a.mfa_supported, false)', dataType: 'boolean' },
      etl_enabled: { expression: 'a.etl_enabled', numericExpression: 'COALESCE(a.etl_enabled, false)', dataType: 'boolean' },
      contains_pii: { expression: 'a.contains_pii', numericExpression: 'COALESCE(a.contains_pii, false)', dataType: 'boolean' },
      users_mode: { expression: 'a.users_mode', dataType: 'string' },
      status: { expression: 'a.status', textExpression: 'CAST(a.status AS TEXT)', dataType: 'string' },
      disabled_at: { expression: 'a.disabled_at', textExpression: 'CAST(a.disabled_at AS TEXT)', dataType: 'string' },
      created_at: { expression: 'a.created_at', textExpression: 'CAST(a.created_at AS TEXT)', dataType: 'string' },
      updated_at: { expression: 'a.updated_at', textExpression: 'CAST(a.updated_at AS TEXT)', dataType: 'string' },
      supplier_name: { expression: 's.name', dataType: 'string' },
      owners_business: {
        expression: 'a.id',
        textExpression: buildApplicationOwnerNamesSql('business'),
        dataType: 'string',
      },
      owners_it: {
        expression: 'a.id',
        textExpression: buildApplicationOwnerNamesSql('it'),
        dataType: 'string',
      },
      environments: {
        expression: 'a.id',
        textExpression:
          `COALESCE((SELECT string_agg(ai.environment, ',') ` +
          `FROM app_instances ai ` +
          `WHERE ai.application_id = a.id AND ai.tenant_id = a.tenant_id), '')`,
        dataType: 'string',
      },
      hosting_types: {
        expression: 'a.id',
        textExpression: `COALESCE((SELECT string_agg(DISTINCT l.hosting_type, ',')
          FROM app_instances ai
          JOIN app_asset_assignments aaa ON aaa.app_instance_id = ai.id AND aaa.tenant_id = ai.tenant_id
          JOIN assets ast ON ast.id = aaa.asset_id AND ast.tenant_id = ai.tenant_id
          LEFT JOIN locations l ON l.id = ast.location_id AND l.tenant_id = ai.tenant_id
          WHERE ai.application_id = a.id AND ai.tenant_id = a.tenant_id AND l.hosting_type IS NOT NULL), '')`,
        dataType: 'string',
      },
    };

    const applyCompiledFilters = (builder: ReturnType<typeof repo.createQueryBuilder>, compiled: CompiledCondition[]) => {
      compiled.forEach((c) => {
        builder.andWhere(new Brackets((qb) => qb.where(c.sql, c.params)));
      });
    };

    const applyQuickSearch = (builder: ReturnType<typeof repo.createQueryBuilder>, quickSearch: CompiledCondition[]) => {
      if (quickSearch.length === 0) return;
      builder.andWhere(
        new Brackets((sub) => {
          quickSearch.forEach((cond, idx) => {
            if (idx === 0) sub.where(cond.sql, cond.params);
            else sub.orWhere(cond.sql, cond.params);
          });
        }),
      );
    };

    const buildBaseQuery = (
      filtersForField: any,
      lifecycleFilterPresent: boolean,
      skipLifecycleDefault: boolean,
      needsSupplierJoin: boolean,
    ) => {
      const qb = repo.createQueryBuilder('a');
      if (tenantId) {
        qb.andWhere('a.tenant_id = :tenantId', { tenantId });
      }
      if (needsSupplierJoin) {
        qb.leftJoin('suppliers', 's', 's.id = a.supplier_id AND s.tenant_id = a.tenant_id');
      }
      if (!includeInactive) {
        qb.andWhere('(a.disabled_at IS NULL OR a.disabled_at > NOW())');
      }
      applyApplicationParticipantScope(qb, opts?.accessScope, 'a');
      applyOwnerScopeCondition(qb, ownerScope);
      if (!includeInactive && !lifecycleFilterPresent && !skipLifecycleDefault) qb.andWhere(`a.lifecycle <> 'retired'`);
      return qb;
    };

    for (const field of fields) {
      const filtersForField = fm ? { ...fm } : {};
      if (filtersForField && Object.prototype.hasOwnProperty.call(filtersForField, field)) {
        delete filtersForField[field];
      }

      const lifecycleFilterPresent = !!(filtersForField && Object.prototype.hasOwnProperty.call(filtersForField, 'lifecycle'));
      const needsSupplierJoin = field === 'supplier_name' || (filtersForField && Object.prototype.hasOwnProperty.call(filtersForField, 'supplier_name'));
      const nextParam = createParamNameGenerator('p');
      const compiledFilters: CompiledCondition[] = [];

      if (filtersForField) {
        for (const [filterField, model] of Object.entries(filtersForField)) {
          if (filterField === 'environments') {
            const custom = compileEnvironmentsSetFilter(model, nextParam);
            if (custom) {
              compiledFilters.push(custom);
              continue;
            }
          }
          if (filterField === 'hosting_types') {
            const custom = compileHostingTypesSetFilter(model, nextParam);
            if (custom) {
              compiledFilters.push(custom);
              continue;
            }
          }
          if (filterField === 'owners_business') {
            const custom = compileOwnerNameFilter('business', model, nextParam);
            if (custom) {
              compiledFilters.push(custom);
              continue;
            }
          }
          if (filterField === 'owners_it') {
            const custom = compileOwnerNameFilter('it', model, nextParam);
            if (custom) {
              compiledFilters.push(custom);
              continue;
            }
          }
          const target = baseTargets[filterField];
          if (!target) continue;
          const cond = compileAgFilterCondition(model, target, nextParam);
          if (cond) compiledFilters.push(cond);
        }
      }

      const quickSearch = q ? buildQuickSearchConditions(q, ['a.name', buildApplicationOwnerNamesSql('it')], nextParam) : [];
      const baseQb = buildBaseQuery(filtersForField, lifecycleFilterPresent, field === 'lifecycle', needsSupplierJoin);
      applyCompiledFilters(baseQb, compiledFilters);
      applyQuickSearch(baseQb, quickSearch);

      if (field === 'environments') {
        const qb = baseQb.clone();
        qb.innerJoin('app_instances', 'ai', 'ai.application_id = a.id AND ai.tenant_id = a.tenant_id');
        qb.andWhere(buildActiveInstanceCondition('ai'));
        qb.select('DISTINCT ai.environment', 'value');
        qb.orderBy('value', 'ASC');
        const rows = await qb.getRawMany();
        results[field] = rows.map((r: any) => r.value);
        continue;
      }

      if (field === 'hosting_types') {
        const qb = baseQb.clone();
        qb.innerJoin('app_instances', 'ai', 'ai.application_id = a.id AND ai.tenant_id = a.tenant_id');
        qb.innerJoin('app_asset_assignments', 'aaa', 'aaa.app_instance_id = ai.id AND aaa.tenant_id = a.tenant_id');
        qb.innerJoin('assets', 'ast', 'ast.id = aaa.asset_id AND ast.tenant_id = a.tenant_id');
        qb.leftJoin('locations', 'l', 'l.id = ast.location_id AND l.tenant_id = a.tenant_id');
        qb.andWhere('l.hosting_type IS NOT NULL');
        qb.select('DISTINCT l.hosting_type', 'value');
        qb.orderBy('value', 'ASC');
        const rows = await qb.getRawMany();
        results[field] = rows.map((r: any) => r.value);
        continue;
      }

      if (field === 'owners_it') {
        const qb = baseQb.clone();
        qb.innerJoin('application_owners', 'ao', `ao.application_id = a.id AND ao.tenant_id = a.tenant_id AND ao.owner_type = 'it'`);
        qb.innerJoin('users', 'u_owner', 'u_owner.id = ao.user_id AND u_owner.tenant_id = a.tenant_id');
        qb.select(`DISTINCT COALESCE(NULLIF(TRIM(CONCAT(u_owner.first_name, ' ', u_owner.last_name)), ''), u_owner.email)`, 'value');
        qb.orderBy('value', 'ASC');
        const rows = await qb.getRawMany();
        results[field] = rows.map((r: any) => r.value);
        continue;
      }

      if (field === 'owners_business') {
        const qb = baseQb.clone();
        qb.innerJoin('application_owners', 'ao', `ao.application_id = a.id AND ao.tenant_id = a.tenant_id AND ao.owner_type = 'business'`);
        qb.innerJoin('users', 'u_owner', 'u_owner.id = ao.user_id AND u_owner.tenant_id = a.tenant_id');
        qb.select(`DISTINCT COALESCE(NULLIF(TRIM(CONCAT(u_owner.first_name, ' ', u_owner.last_name)), ''), u_owner.email)`, 'value');
        qb.orderBy('value', 'ASC');
        const rows = await qb.getRawMany();
        results[field] = rows.map((r: any) => r.value);
        continue;
      }

      let expression = '';
      switch (field) {
        case 'category':
          expression = 'a.category';
          break;
        case 'editor':
          expression = 'a.editor';
          break;
        case 'environment':
          expression = 'a.environment';
          break;
        case 'status':
          expression = 'a.status';
          break;
        case 'lifecycle':
          expression = 'a.lifecycle';
          break;
        case 'criticality':
          expression = 'a.criticality';
          break;
        case 'hosting_model':
          expression = 'a.hosting_model';
          break;
        case 'data_class':
          expression = 'a.data_class';
          break;
        case 'supplier_name':
          expression = 's.name';
          break;
        case 'external_facing':
          expression = 'COALESCE(a.external_facing, false)';
          break;
        case 'is_suite':
          expression = 'COALESCE(a.is_suite, false)';
          break;
        case 'sso_enabled':
          expression = 'COALESCE(a.sso_enabled, false)';
          break;
        case 'mfa_supported':
          expression = 'COALESCE(a.mfa_supported, false)';
          break;
        case 'etl_enabled':
          expression = 'COALESCE(a.etl_enabled, false)';
          break;
        case 'contains_pii':
          expression = 'COALESCE(a.contains_pii, false)';
          break;
        case 'users_mode':
          expression = 'a.users_mode';
          break;
        case 'data_residency':
          expression = `(SELECT string_agg(DISTINCT dr.country_iso, ',')
            FROM application_data_residency dr
            WHERE dr.application_id = a.id AND dr.tenant_id = a.tenant_id)`;
          break;
        default:
          expression = classificationTargets[field]?.expression ?? '';
      }

      if (!expression) {
        results[field] = [];
        continue;
      }

      const qb = baseQb.clone();
      qb.select(`DISTINCT ${expression}`, 'value');
      qb.orderBy('value', 'ASC');
      const rows = await qb.getRawMany();
      results[field] = rows.map((r: any) => r.value);
    }

    return results;
  }

  /**
   * Build expansions for list items.
   */
  private async buildExpansions(pageIds: string[], include: Set<string>, mg: any) {
    let ownersByApp: Record<string, { business: string[]; it: string[] }> = {};
    if (include.has('owners') && pageIds.length > 0) {
      const rows: Array<{ application_id: string; first_name: string | null; last_name: string | null; email: string; owner_type: 'business' | 'it' }> =
        await mg.query(
          `SELECT o.application_id, u.first_name, u.last_name, u.email, o.owner_type
           FROM application_owners o
           LEFT JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
           WHERE o.application_id = ANY($1)
           ORDER BY o.owner_type ASC, u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.email ASC NULLS LAST`,
          [pageIds],
        );
      const map: Record<string, { business: string[]; it: string[] }> = {};
      for (const r of rows) {
        const key = r.application_id;
        if (!map[key]) map[key] = { business: [], it: [] };
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email;
        if (r.owner_type === 'business') map[key].business.push(name);
        else map[key].it.push(name);
      }
      ownersByApp = map;
    }

    let residencyByApp: Record<string, string[]> = {};
    if (include.has('residency') && pageIds.length > 0) {
      const rows: Array<{ application_id: string; country_iso: string }> = await mg.query(
        `SELECT application_id, country_iso FROM application_data_residency WHERE application_id = ANY($1)`,
        [pageIds],
      );
      const map: Record<string, string[]> = {};
      for (const r of rows) {
        if (!map[r.application_id]) map[r.application_id] = [];
        map[r.application_id].push((r.country_iso || '').toUpperCase());
      }
      residencyByApp = map;
    }

    let hostingByApp: Record<string, string[]> = {};
    if (include.has('hosting') && pageIds.length > 0) {
      const hostingRows: Array<{ application_id: string; hosting_type: string }> = await mg.query(
        `SELECT DISTINCT ai.application_id, l.hosting_type
         FROM app_instances ai
         JOIN app_asset_assignments aaa ON aaa.app_instance_id = ai.id AND aaa.tenant_id = ai.tenant_id
         JOIN assets ast ON ast.id = aaa.asset_id AND ast.tenant_id = ai.tenant_id
         LEFT JOIN locations l ON l.id = ast.location_id AND l.tenant_id = ai.tenant_id
         WHERE ai.application_id = ANY($1) AND l.hosting_type IS NOT NULL
         ORDER BY l.hosting_type ASC`,
        [pageIds],
      );
      const map: Record<string, string[]> = {};
      for (const r of hostingRows) {
        if (!map[r.application_id]) map[r.application_id] = [];
        if (!map[r.application_id].includes(r.hosting_type)) {
          map[r.application_id].push(r.hosting_type);
        }
      }
      hostingByApp = map;
    }

    let instancesByApp: Record<string, Array<any>> = {};
    if ((include.has('instances') || include.has('deployments')) && pageIds.length > 0) {
      const rows = await mg.query(
        `SELECT id, application_id, environment, lifecycle, status, base_url, region, zone, notes, sso_enabled, mfa_supported, disabled_at, created_at, updated_at
         FROM app_instances
         WHERE application_id = ANY($1)
         ORDER BY environment ASC, created_at ASC`,
        [pageIds],
      );
      const grouped: typeof instancesByApp = {};
      for (const row of rows) {
        const list = grouped[row.application_id] || [];
        list.push({
          id: row.id,
          environment: row.environment,
          lifecycle: row.lifecycle,
          status: row.status,
          base_url: row.base_url,
          region: row.region,
          zone: row.zone,
          notes: row.notes,
          sso_enabled: row.sso_enabled,
          mfa_supported: row.mfa_supported,
          disabled_at: row.disabled_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
        grouped[row.application_id] = list;
      }
      instancesByApp = grouped;
    }

    let spendAgg: Record<string, { c: number; first_name: string | null }> = {};
    let capexAgg: Record<string, { c: number; first_description: string | null }> = {};
    let contractAgg: Record<string, { c: number; first_name: string | null }> = {};
    let suitesAgg: Record<string, { c: number; first_name: string | null }> = {};
    let componentsAgg: Record<string, { c: number; first_name: string | null }> = {};

    if (include.has('counts') && pageIds.length > 0) {
      const spendRows: Array<{ application_id: string; c: string; first_name: string | null }> = await mg.query(
        `SELECT l.application_id, COUNT(*)::text as c, MIN(si.product_name) as first_name
         FROM application_spend_items l
         JOIN spend_items si ON si.id = l.spend_item_id AND si.tenant_id = l.tenant_id AND si.nature = 'opex'
         WHERE l.application_id = ANY($1)
         GROUP BY l.application_id`,
        [pageIds],
      );
      const capexRows: Array<{ application_id: string; c: string; first_description: string | null }> = await mg.query(
        `SELECT l.application_id, COUNT(*)::text as c, MIN(cx.product_name) as first_description
         FROM application_spend_items l
         JOIN spend_items cx ON cx.id = l.spend_item_id AND cx.tenant_id = l.tenant_id AND cx.nature = 'capex'
         WHERE l.application_id = ANY($1)
         GROUP BY l.application_id`,
        [pageIds],
      );
      const contractRows: Array<{ application_id: string; c: string; first_name: string | null }> = await mg.query(
        `SELECT l.application_id, COUNT(*)::text as c, MIN(ct.name) as first_name
         FROM application_contracts l
         JOIN contracts ct ON ct.id = l.contract_id AND ct.tenant_id = l.tenant_id
         WHERE l.application_id = ANY($1)
         GROUP BY l.application_id`,
        [pageIds],
      );
      spendAgg = Object.fromEntries(spendRows.map((r) => [r.application_id, { c: Number(r.c), first_name: r.first_name }]));
      capexAgg = Object.fromEntries(capexRows.map((r) => [r.application_id, { c: Number(r.c), first_description: r.first_description }]));
      contractAgg = Object.fromEntries(contractRows.map((r) => [r.application_id, { c: Number(r.c), first_name: r.first_name }]));
    }

    if (include.has('structure') && pageIds.length > 0) {
      const suiteRows: Array<{ application_id: string; c: string; first_name: string | null }> = await mg.query(
        `SELECT l.application_id, COUNT(*)::text as c, MIN(sa.name) as first_name
         FROM application_suites l
         JOIN applications sa ON sa.id = l.suite_id AND sa.tenant_id = l.tenant_id
         WHERE l.application_id = ANY($1)
         GROUP BY l.application_id`,
        [pageIds],
      );
      const componentRows: Array<{ application_id: string; c: string; first_name: string | null }> = await mg.query(
        `SELECT l.suite_id as application_id, COUNT(*)::text as c, MIN(ca.name) as first_name
         FROM application_suites l
         JOIN applications ca ON ca.id = l.application_id AND ca.tenant_id = l.tenant_id
         WHERE l.suite_id = ANY($1)
         GROUP BY l.suite_id`,
        [pageIds],
      );
      suitesAgg = Object.fromEntries(suiteRows.map((r) => [r.application_id, { c: Number(r.c), first_name: r.first_name }]));
      componentsAgg = Object.fromEntries(componentRows.map((r) => [r.application_id, { c: Number(r.c), first_name: r.first_name }]));
    }

    return { ownersByApp, residencyByApp, hostingByApp, instancesByApp, spendAgg, capexAgg, contractAgg, suitesAgg, componentsAgg };
  }

  /**
   * Lightweight projection for map side panels.
   */
  async mapSummary(id: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const resolvedAppId = await this.resolveApplicationIdentifier(id, mg);
    await this.assertVisible(resolvedAppId, opts?.accessScope, mg);
    const app = await mg.getRepository(Application).findOne({ where: { id: resolvedAppId } });
    if (!app) throw new NotFoundException('Application not found');

    const ownerRows: Array<{ owner_type: string; user_id: string; first_name: string | null; last_name: string | null; email: string | null }> =
      await mg.query(
        `SELECT ao.owner_type, ao.user_id, u.first_name, u.last_name, u.email
         FROM application_owners ao
         JOIN users u ON u.id = ao.user_id AND u.tenant_id = ao.tenant_id
         WHERE ao.application_id = $1
         ORDER BY ao.owner_type ASC, u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST`,
        [resolvedAppId],
      );

    const owners = ownerRows.map((row) => ({
      owner_type: row.owner_type,
      user_id: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.email || row.user_id,
      email: row.email,
    }));

    // Import support contacts helper
    const { ApplicationSupportContact } = await import('../application-support-contact.entity');
    const { ExternalContact } = await import('../../contacts/external-contact.entity');
    const scRows = await mg.query(
      `SELECT sc.id, sc.contact_id, sc.role, c.first_name, c.last_name, c.email, c.phone, c.mobile
       FROM application_support_contacts sc
       JOIN contacts c ON c.id = sc.contact_id
       WHERE sc.application_id = $1
       ORDER BY sc.created_at ASC, sc.id ASC`,
      [resolvedAppId],
    );
    const support_contacts = scRows.map((r: any) => ({
      id: r.id,
      contact_id: r.contact_id,
      role: r.role,
      contact: {
        id: r.contact_id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        phone: r.phone,
        mobile: r.mobile,
      },
    }));

    const assetRows: Array<{ asset_id: string; asset_name: string; environment: string }> = await mg.query(
      `SELECT s.id AS asset_id, s.name AS asset_name, ai.environment
       FROM app_asset_assignments asa
       JOIN app_instances ai ON ai.id = asa.app_instance_id
       JOIN assets s ON s.id = asa.asset_id
       WHERE ai.application_id = $1
         AND s.status <> 'retired'
       ORDER BY array_position(ARRAY['prod','pre_prod','qa','test','dev','sandbox'], ai.environment), s.name ASC`,
      [resolvedAppId],
    );

    const assigned_servers = assetRows.map((row) => ({
      id: row.asset_id,
      name: row.asset_name,
      environment: row.environment,
    }));

    const reviewState = classificationReadState(app);

    return {
      id: app.id,
      name: app.name,
      description: app.description,
      editor: app.editor,
      criticality: app.criticality,
      cyber_criticality: app.cyber_criticality,
      recovery_wave: app.recovery_wave,
      rto_minutes: app.rto_minutes,
      rpo_minutes: app.rpo_minutes,
      classification_justification: app.classification_justification,
      classification_revision: app.classification_revision,
      classification_review: app.classification_review,
      classification_review_state: reviewState.classification_review_state,
      classification_reviewed_at: reviewState.classification_reviewed_at,
      assigned_servers,
      business_owners: owners.filter((o) => o.owner_type === 'business'),
      it_owners: owners.filter((o) => o.owner_type === 'it'),
      support_contacts,
    };
  }

  /**
   * List applications with server assignments for Connection Map filtering.
   */
  async listWithServerAssignments(opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const params: unknown[] = [];
    const accessScopeSql = opts?.accessScope
      ? (() => {
        params.push(opts.accessScope.userId);
        return `AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
      })()
      : '';

    const rows: Array<{
      id: string;
      name: string;
      lifecycle: string;
      environment: string;
    }> = await mg.query(`
      SELECT DISTINCT
        a.id,
        a.name,
        a.lifecycle,
        ai.environment
      FROM applications a
      INNER JOIN app_instances ai ON ai.application_id = a.id
      INNER JOIN app_asset_assignments asa ON asa.app_instance_id = ai.id
      WHERE (a.disabled_at IS NULL OR a.disabled_at > NOW())
        AND a.lifecycle <> 'retired'
        ${accessScopeSql}
      ORDER BY a.name ASC, ai.environment ASC
    `, params);

    const appMap = new Map<string, { id: string; name: string; lifecycle: string; environments: string[] }>();
    for (const row of rows) {
      if (!appMap.has(row.id)) {
        appMap.set(row.id, {
          id: row.id,
          name: row.name,
          lifecycle: row.lifecycle,
          environments: [],
        });
      }
      const app = appMap.get(row.id)!;
      if (!app.environments.includes(row.environment)) {
        app.environments.push(row.environment);
      }
    }

    return { items: Array.from(appMap.values()) };
  }
}
