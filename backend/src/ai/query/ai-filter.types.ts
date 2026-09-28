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
  | 'users';

export type AiSetFilterValue = Array<string | null>;
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
  scope: {
    requested: AiQueryScope;
    resolved: boolean;
    team_name?: string | null;
  } | null;
};

export type AiAggregateResult = {
  status?: 'ok' | 'invalid_filter';
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
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};
