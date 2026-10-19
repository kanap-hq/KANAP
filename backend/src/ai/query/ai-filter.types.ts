import { AiEntitySummaryDto, AiQueryScope } from '../ai.types';

export type AiFilterFieldType = 'set' | 'text' | 'number' | 'date';
export type AiQueryEntityType =
  | 'accounts'
  | 'analytics_categories'
  | 'applications'
  | 'assets'
  | 'business_processes'
  | 'capex_items'
  | 'chart_of_accounts'
  | 'companies'
  | 'connections'
  | 'contacts'
  | 'contracts'
  | 'departments'
  | 'documents'
  | 'incidents'
  | 'interfaces'
  | 'locations'
  | 'projects'
  | 'requests'
  | 'spend_items'
  | 'suppliers'
  | 'tasks'
  | 'technologies'
  | 'users';

export type AiSetFilterValue = Array<string | null>;
/** Every value of a set field but these (exclude mode): a value created later is kept. */
export type AiSetExcludeFilterValue = { not: Array<string | null> };
export type AiTextFilterValue = string;
export type AiNumberFilterValue = {
  op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between';
  value: number;
  valueTo?: number;
};
export type AiDateFilterValue = {
  op: 'eq' | 'before' | 'after' | 'between';
  value: string;
  valueTo?: string;
};
export type AiFilterValue =
  | AiSetFilterValue
  | AiSetExcludeFilterValue
  | AiTextFilterValue
  | AiNumberFilterValue
  | AiDateFilterValue;

export type AiFilterFieldDef = {
  ai: string;
  grid: string;
  type: AiFilterFieldType;
  description: string;
  values?: Array<string | null>;
  dynamic?: boolean;
  discoverable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  aggregable?: boolean;
  aliases?: string[];
  acceptedValueKind?: string;
  /** Date field that also takes `[null]`: rows with no date. */
  blankable?: boolean;
  lookupEntity?: AiQueryEntityType;
  examples?: string[];
  doesNotAccept?: string[];
};

export type AiAggregateGroupDef = {
  expression: string;
  joins?: string[];
};

export type AiAggregateMetricType = 'number' | 'date';

export type AiAggregateMetricDef = {
  expression: string;
  joins?: string[];
  type: AiAggregateMetricType;
};

export type AiAggregateConfig = {
  baseTable: string;
  alias: string;
  /**
   * A predicate every statement on `baseTable` carries besides the tenant: the OPEX lines of
   * `spend_items` (`si.nature = 'opex'`, `spend/budget-nature.ts`). Written here only, never
   * from a request.
   */
  baseWhere?: string;
  idColumn?: string;
  groupFields: Record<string, AiAggregateGroupDef>;
  metricFields?: Record<string, AiAggregateMetricDef>;
};

export type AiEntityFilterRegistry = {
  entityType: AiQueryEntityType;
  fields: Record<string, AiFilterFieldDef>;
  sortFields: Record<string, string>;
  defaultSort: {
    field: string;
    direction: 'asc' | 'desc';
  };
  aggregate: AiAggregateConfig;
};

export type AiAdaptedFilters = {
  filters: Record<string, any>;
  applied: string[];
  ignored: string[];
};

export type AiQueryResult = {
  status?: 'ok' | 'invalid_filter';
  items: AiEntitySummaryDto[];
  total: number;
  page: number;
  limit: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
  filters_applied: string[];
  filters_ignored: string[];
  suggested_repairs?: AiFilterRepairSuggestion[];
  /** The order of `items`: the requested sort, or the family's default one when `sort_ignored` names it. */
  sort?: { field: string; direction: 'asc' | 'desc' };
  /** A requested sort field the family cannot sort on; `sortable_fields` then lists the ones it can. */
  sort_ignored?: string[];
  sortable_fields?: string[];
  /** A `limit` above the family's maximum: the page size asked and the one applied (`limit`). */
  limit_capped?: { requested: number; applied: number };
  /** The currency of the amounts, on the families that carry some (`ai-amounts-currency.util.ts`). */
  amounts_currency?: string | null;
  amounts_currency_note?: string;
  scope: {
    requested: AiQueryScope;
    resolved: boolean;
    team_name?: string | null;
  } | null;
};

export type AiAggregateResult = {
  status?: 'ok' | 'invalid_filter';
  amounts_currency?: string | null;
  amounts_currency_note?: string;
  /**
   * Budget lines, with a measure: the line currencies and years without an exchange rate whose
   * amounts the values leave out, with the number of lines (`[]` when none).
   */
  amounts_fx_missing?: Array<{ currency: string; year: number; lines: number }>;
  group_by: string;
  metric?: string | null;
  function?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  groups: Array<
    | { key: string | null; count: number }
    // `unknown`: FTE metrics only, the lines of the group without an FTE (left out of the value).
    | { key: string | null; value: number | string | null; unknown?: number }
  >;
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
  filters_applied: string[];
  filters_ignored: string[];
  suggested_repairs?: AiFilterRepairSuggestion[];
  scope: {
    requested: AiQueryScope;
    resolved: boolean;
    team_name?: string | null;
  } | null;
};

export type AiFilterValuesResult = {
  values: Record<string, Array<string | boolean | null>>;
  fields_ignored: string[];
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};

export type AiFilterRepairSuggestion = {
  field: string;
  reason: string;
};

export type AiFilterDescription = {
  field: string;
  type: AiFilterFieldType;
  description: string;
  accepted_value_kind: string;
  aliases: string[];
  lookup_entity: AiQueryEntityType | null;
  examples: string[];
  does_not_accept: string[];
  discoverable: boolean;
  sortable: boolean;
  groupable: boolean;
  aggregable: boolean;
  values?: Array<string | null>;
};

export type AiFilterDescriptionResult = {
  entity_type: AiQueryEntityType;
  fields: AiFilterDescription[];
  /** Every `sort.field` query_entities takes for this family (the sortable fields, label, created_at, updated_at...). */
  sort_fields: string[];
  default_sort: { field: string; direction: 'asc' | 'desc' };
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};
