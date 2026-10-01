export type FilterDataType = 'string' | 'number' | 'boolean';

export type FilterTargetConfig = {
  expression: string;
  numericExpression?: string;
  textExpression?: string;
  dataType?: FilterDataType;
};

export type CompiledCondition = {
  sql: string;
  params: Record<string, any>;
};

export type ParamNameFactory = () => string;

export function createParamNameGenerator(prefix = 'p'): ParamNameFactory {
  let idx = 0;
  return () => `${prefix}${idx++}`;
}

export function normalizeAgFilterModel(rawModel: any): any {
  if (!rawModel || typeof rawModel !== 'object') return rawModel;
  if (rawModel.operator && Array.isArray(rawModel.conditions) && rawModel.conditions.length > 0) {
    return rawModel.conditions[0];
  }
  return rawModel;
}

function parseBoolean(value: any): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  return null;
}

const numericComparableTypes = new Set([
  'equals',
  'notEqual',
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'inRange',
]);

/**
 * A set model in exclude mode (`mode: 'exclude'`): the user started from
 * "all" and unticked `values`, so the list keeps every other value, including
 * values created later. It matches exactly the rows the include model of the
 * same values does not match (a row whose include condition is NULL counts as
 * not matched).
 */
export function isExcludeSetModel(model: any): boolean {
  return !!model && typeof model === 'object' && model.mode === 'exclude' && model.filterType === 'set' && Array.isArray(model.values);
}

export function compileAgFilterCondition(
  rawModel: any,
  target: FilterTargetConfig,
  nextParam: ParamNameFactory,
): CompiledCondition | null {
  const model = normalizeAgFilterModel(rawModel);
  if (!model || typeof model !== 'object') return null;
  if (isExcludeSetModel(model)) {
    const { mode: _mode, ...include } = model;
    const compiled = compileAgFilterCondition(include, target, nextParam);
    return compiled ? { sql: `NOT COALESCE((${compiled.sql}), FALSE)`, params: compiled.params } : null;
  }

  const dataType: FilterDataType = target.dataType ?? 'string';
  const filterCategory = String(model.filterType ?? (dataType === 'number' ? 'number' : 'text'));
  const type = String(model.type ?? (filterCategory === 'set' ? 'set' : 'contains'));
  const baseExpr = target.expression;
  const numericExpr = target.numericExpression ?? target.expression;
  const textExpr = target.textExpression ?? target.numericExpression ?? target.expression;

  if (filterCategory === 'set' && Array.isArray(model.values)) {
    const rawValues = model.values.filter((v: any) => v !== null && v !== undefined && v !== '');
    const hasNull = model.values.some((v: any) => v === null || v === undefined);
    if (rawValues.length === 0) {
      if (hasNull) {
        return { sql: `${baseExpr} IS NULL`, params: {} };
      }
      return { sql: '1=0', params: {} };
    }

    let values: any[] = rawValues;
    if (dataType === 'number') {
      values = rawValues
        .map((v: any) => Number(v))
        .filter((v: number) => Number.isFinite(v));
    } else if (dataType === 'boolean') {
      values = rawValues
        .map((v: any) => parseBoolean(v))
        .filter((v: boolean | null): v is boolean => v !== null);
    }

    if (values.length === 0) {
      if (hasNull) {
        return { sql: `${baseExpr} IS NULL`, params: {} };
      }
      return { sql: '1=0', params: {} };
    }
    const param = nextParam();
    // Use textExpr for set filters when filtering by text values (e.g., lookup column names)
    // This allows filtering task_type_name by ['Task', 'Bug'] using the subquery
    const setExpr = dataType === 'string' ? textExpr : numericExpr;
    if (hasNull) {
      return { sql: `(${setExpr} IN (:...${param}) OR ${baseExpr} IS NULL)`, params: { [param]: values } };
    }
    return { sql: `${setExpr} IN (:...${param})`, params: { [param]: values } };
  }

  if (filterCategory === 'date') {
    if (type === 'blank' || type === 'empty') {
      return { sql: `${baseExpr} IS NULL`, params: {} };
    }
    if (type === 'notBlank' || type === 'notEmpty') {
      return { sql: `${baseExpr} IS NOT NULL`, params: {} };
    }
    const fromRaw = model.dateFrom ?? model.filter ?? model.value;
    const toRaw = model.dateTo ?? model.filterTo ?? model.valueTo;
    const expr = `CAST(${baseExpr} AS DATE)`;
    const castParam = (param: string) => `CAST(:${param} AS DATE)`;

    if (type === 'inRange') {
      if (!fromRaw || !toRaw) return null;
      const fromParam = nextParam();
      const toParam = nextParam();
      return {
        sql: `${expr} BETWEEN ${castParam(fromParam)} AND ${castParam(toParam)}`,
        params: { [fromParam]: fromRaw, [toParam]: toRaw },
      };
    }

    if (!fromRaw) return null;
    const param = nextParam();
    switch (type) {
      case 'equals':
        return { sql: `${expr} = ${castParam(param)}`, params: { [param]: fromRaw } };
      case 'notEqual':
        return { sql: `${expr} <> ${castParam(param)}`, params: { [param]: fromRaw } };
      case 'lessThan':
        return { sql: `${expr} < ${castParam(param)}`, params: { [param]: fromRaw } };
      case 'lessThanOrEqual':
        return { sql: `${expr} <= ${castParam(param)}`, params: { [param]: fromRaw } };
      case 'greaterThan':
        return { sql: `${expr} > ${castParam(param)}`, params: { [param]: fromRaw } };
      case 'greaterThanOrEqual':
        return { sql: `${expr} >= ${castParam(param)}`, params: { [param]: fromRaw } };
      default:
        return null;
    }
  }

  if (type === 'blank') {
    if (dataType === 'number' || dataType === 'boolean') {
      return { sql: `${baseExpr} IS NULL`, params: {} };
    }
    // Cast to text to avoid invalid input errors for UUID and other non-text types.
    return { sql: `NULLIF((${baseExpr})::text, '') IS NULL`, params: {} };
  }

  if (type === 'notBlank') {
    if (dataType === 'number' || dataType === 'boolean') {
      return { sql: `${baseExpr} IS NOT NULL`, params: {} };
    }
    return { sql: `NULLIF((${baseExpr})::text, '') IS NOT NULL`, params: {} };
  }

  if (dataType === 'number' && numericComparableTypes.has(type)) {
    const fromRaw = model.filter ?? model.value;
    const from = Number(fromRaw);
    if (!Number.isFinite(from)) return null;

    const expr = numericExpr;
    if (type === 'inRange') {
      const toRaw = model.filterTo ?? model.valueTo;
      const to = Number(toRaw);
      if (!Number.isFinite(to)) return null;
      const fromParam = nextParam();
      const toParam = nextParam();
      return {
        sql: `${expr} BETWEEN :${fromParam} AND :${toParam}`,
        params: { [fromParam]: from, [toParam]: to },
      };
    }

    const param = nextParam();
    switch (type) {
      case 'equals':
        return { sql: `${expr} = :${param}`, params: { [param]: from } };
      case 'notEqual':
        return { sql: `${expr} <> :${param}`, params: { [param]: from } };
      case 'lessThan':
        return { sql: `${expr} < :${param}`, params: { [param]: from } };
      case 'lessThanOrEqual':
        return { sql: `${expr} <= :${param}`, params: { [param]: from } };
      case 'greaterThan':
        return { sql: `${expr} > :${param}`, params: { [param]: from } };
      case 'greaterThanOrEqual':
        return { sql: `${expr} >= :${param}`, params: { [param]: from } };
      default:
        break;
    }
  }

  if (dataType === 'boolean') {
    const rawVal = model.filter ?? model.value ?? (Array.isArray(model.values) ? model.values[0] : undefined);
    const parsed = parseBoolean(rawVal);
    if (parsed === null) return null;
    const param = nextParam();
    if (type === 'notEqual') {
      return { sql: `${baseExpr} <> :${param}`, params: { [param]: parsed } };
    }
    return { sql: `${baseExpr} = :${param}`, params: { [param]: parsed } };
  }

  const rawValue = model.filter ?? model.value ?? (Array.isArray(model.values) ? model.values[0] : undefined);
  if (rawValue == null || rawValue === '') return null;
  const value = String(rawValue);
  const param = nextParam();
  switch (type) {
    case 'equals':
      return { sql: `${textExpr} = :${param}`, params: { [param]: value } };
    case 'notEqual':
      return { sql: `${textExpr} <> :${param}`, params: { [param]: value } };
    case 'startsWith':
      return { sql: `${textExpr} ILIKE :${param}`, params: { [param]: `${value}%` } };
    case 'endsWith':
      return { sql: `${textExpr} ILIKE :${param}`, params: { [param]: `%${value}` } };
    case 'notContains':
      return { sql: `${textExpr} NOT ILIKE :${param}`, params: { [param]: `%${value}%` } };
    case 'contains':
    default:
      return { sql: `${textExpr} ILIKE :${param}`, params: { [param]: `%${value}%` } };
  }
}

export function buildQuickSearchConditions(
  search: string,
  expressions: string[],
  nextParam: ParamNameFactory,
): CompiledCondition[] {
  if (!search || typeof search !== 'string') return [];
  const trimmed = search.trim();
  if (!trimmed) return [];
  const sanitized = trimmed.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const likeValue = `%${sanitized}%`;

  return expressions.map((expr) => {
    const param = nextParam();
    return {
      sql: `${expr} ILIKE :${param} ESCAPE '\\'`,
      params: { [param]: likeValue },
    };
  });
}
