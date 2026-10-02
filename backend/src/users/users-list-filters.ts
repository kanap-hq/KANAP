import {
  compileAgFilterCondition,
  createParamNameGenerator,
  normalizeAgFilterModel,
  type CompiledCondition,
  type FilterTargetConfig,
  type ParamNameFactory,
  assertSetFilterModes,
} from '../common/ag-grid-filtering';

export const USER_LIST_FILTER_TARGETS: Record<string, FilterTargetConfig> = {
  email: { expression: 'u.email', dataType: 'string' },
  first_name: { expression: 'u.first_name', dataType: 'string' },
  last_name: { expression: 'u.last_name', dataType: 'string' },
  job_title: { expression: 'u.job_title', dataType: 'string' },
  business_phone: { expression: 'u.business_phone', dataType: 'string' },
  mobile_phone: { expression: 'u.mobile_phone', dataType: 'string' },
  company: {
    expression: 'company.id',
    textExpression: `COALESCE(company.name, '')`,
    dataType: 'string',
  },
  department: {
    expression: 'department.id',
    textExpression: `COALESCE(department.name, '')`,
    dataType: 'string',
  },
  created_at: {
    expression: 'u.created_at',
    textExpression: 'CAST(u.created_at AS TEXT)',
    dataType: 'string',
  },
  last_login_at: {
    expression: 'u.last_login_at',
    textExpression: 'CAST(u.last_login_at AS TEXT)',
    dataType: 'string',
  },
  mfa_enabled: { expression: 'u.mfa_enabled', dataType: 'boolean' },
};

/**
 * A user "has access" when any of their roles (primary role_id or user_roles)
 * is named Administrator or has at least one role_permissions row.
 * Mirrors the pending_access flag computed after pagination in list().
 */
export const USER_HAS_ACCESS_SQL = `(
  EXISTS (
    SELECT 1 FROM roles r
    WHERE (r.id = u.role_id OR EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
    ))
    AND (
      LOWER(r.role_name) = 'administrator'
      OR EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id)
    )
  )
)`;

function readSetValues(model: any): { values: string[]; isEmptySet: boolean; isSet: boolean } {
  const normalized = normalizeAgFilterModel(model);
  const isSet = Boolean(normalized && (normalized.filterType === 'set' || Array.isArray(normalized?.values)));
  if (!isSet) {
    return { values: [], isEmptySet: false, isSet: false };
  }
  const raw = Array.isArray(normalized.values) ? normalized.values : [];
  return {
    values: raw.filter((v: any) => v !== null && v !== undefined && v !== '').map((v: any) => String(v)),
    isEmptySet: raw.length === 0,
    isSet: true,
  };
}

export function compileStatusFilter(model: any, nextParam: ParamNameFactory): CompiledCondition | null {
  const { values, isEmptySet, isSet } = readSetValues(model);
  if (isEmptySet) return { sql: '1=0', params: {} };
  if (!isSet) {
    return compileAgFilterCondition(model, { expression: 'u.status', dataType: 'string' }, nextParam);
  }
  if (values.length === 0) return null;

  const wantEnabledDisplay = values.includes('enabled');
  const wantPending = values.includes('pending_access');
  const dbStatuses = values.filter((v) => v !== 'pending_access' && v !== 'enabled');

  const branches: string[] = [];
  const params: Record<string, any> = {};
  if (wantEnabledDisplay && wantPending) {
    branches.push(`u.status = 'enabled'`);
  } else if (wantEnabledDisplay) {
    branches.push(`(u.status = 'enabled' AND ${USER_HAS_ACCESS_SQL})`);
  } else if (wantPending) {
    branches.push(`(u.status = 'enabled' AND NOT ${USER_HAS_ACCESS_SQL})`);
  }
  if (dbStatuses.length > 0) {
    const param = nextParam();
    branches.push(`u.status IN (:...${param})`);
    params[param] = dbStatuses;
  }
  if (branches.length === 0) return { sql: '1=0', params: {} };
  return { sql: `(${branches.join(' OR ')})`, params };
}

export function compileRolesFilter(model: any, nextParam: ParamNameFactory): CompiledCondition | null {
  const { values, isEmptySet, isSet } = readSetValues(model);
  if (isEmptySet) return { sql: '1=0', params: {} };
  if (!isSet || values.length === 0) return null;
  const param = nextParam();
  return {
    sql: `(u.role_id IN (:...${param}) OR EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id IN (:...${param})
    ))`,
    params: { [param]: values },
  };
}

export function compileAccountTypeFilter(model: any, nextParam: ParamNameFactory): CompiledCondition | null {
  const { values, isEmptySet, isSet } = readSetValues(model);
  if (isEmptySet) return { sql: '1=0', params: {} };
  if (!isSet || values.length === 0) return null;
  const hasLocal = values.includes('local');
  const hasEntra = values.includes('entra');
  if (hasLocal && hasEntra) {
    return {
      sql: `(u.external_auth_provider IS NULL OR u.external_auth_provider = 'entra')`,
      params: {},
    };
  }
  if (hasLocal) return { sql: 'u.external_auth_provider IS NULL', params: {} };
  if (hasEntra) {
    const param = nextParam();
    return { sql: `u.external_auth_provider = :${param}`, params: { [param]: 'entra' } };
  }
  return { sql: '1=0', params: {} };
}

export function compileUserListFilters(
  filters: Record<string, any> | undefined,
  nextParam: ParamNameFactory = createParamNameGenerator('uf'),
): CompiledCondition[] {
  if (!filters || typeof filters !== 'object') return [];
  const conditions: CompiledCondition[] = [];
  assertSetFilterModes(filters, (field) => !['status', 'roles', 'account_type'].includes(field));
  for (const [field, model] of Object.entries(filters)) {
    let compiled: CompiledCondition | null = null;
    if (field === 'status') compiled = compileStatusFilter(model, nextParam);
    else if (field === 'roles') compiled = compileRolesFilter(model, nextParam);
    else if (field === 'account_type') compiled = compileAccountTypeFilter(model, nextParam);
    else {
      const target = USER_LIST_FILTER_TARGETS[field];
      if (!target) continue;
      compiled = compileAgFilterCondition(model, target, nextParam);
    }
    if (compiled) conditions.push(compiled);
  }
  return conditions;
}
