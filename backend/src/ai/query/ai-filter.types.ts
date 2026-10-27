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
  | 'users'
  | 'vulnerabilities';

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

/** A set filter given values its field does not take, with the ones it does. */
export type AiInvalidFilterValue = {
  field: string;
  rejected: Array<string | null>;
  accepted: Array<string | null>;
};

export type AiAdaptedFilters = {
  filters: Record<string, any>;
  applied: string[];
  /** Every filter not applied: unknown fields, malformed values and `invalid_values`. */
  ignored: string[];
  invalid_values: AiInvalidFilterValue[];
};

/**
 * The amounts of every record the filters keep, all pages included, computed by the server
 * (query_entities on budget lines and contracts). A total in an answer is quoted from here or
 * from aggregate_entities, never added up from the items.
 */
export type AiAmountTotals = {
  /** Records counted (the result's `total`). */
  records: number;
  /** Budget lines: the reporting currency of every value. Contracts: null (one row per currency). */
  currency: string | null;
  /** Budget lines: each amount field (`y_budget`, `y_minus1_actual`...) summed over the records. */
  values?: Record<string, number>;
  /** Contracts: the yearly amounts summed per contract currency. */
  by_currency?: Array<{ currency: string | null; yearly_amount: number | null; contracts: number; without_amount: number }>;
  /** Budget lines: the currencies and years without an exchange rate, left out of `values`. */
  fx_missing?: Array<{ currency: string; year: number; lines: number }>;
  note: string;
};

export type AiQueryResult = {
  /** `invalid_filter_value`: every filter not applied is a known field given values it does not take. */
  status?: 'ok' | 'invalid_filter' | 'invalid_filter_value';
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
  /** The set filters given values their field does not take, with the accepted values. */
  invalid_filter_values?: AiInvalidFilterValue[];
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
  amount_totals?: AiAmountTotals;
  /** `limited`: a person with limited data access; the items and figures cover their access only. */
  data_access?: 'limited';
  data_access_note?: string;
  scope: {
    requested: AiQueryScope;
    resolved: boolean;
    team_name?: string | null;
  } | null;
};

export type AiAggregateResult = {
  status?: 'ok' | 'invalid_filter' | 'invalid_filter_value';
  amounts_currency?: string | null;
  amounts_currency_note?: string;
  /**
   * Budget lines, with a measure: the line currencies and years without an exchange rate whose
   * amounts the values leave out, with the number of lines (`[]` when none).
   */
  amounts_fx_missing?: Array<{ currency: string; year: number; lines: number }>;
  /**
   * Company turnover (sum, avg, min, max): the companies left out of the values because their
   * base currency has no rate for the metric year. Absent when every turnover was converted.
   * Shape of `TurnoverFxMissingItem`.
   */
  turnover_fx_missing?: Array<{ companyId: string; companyName: string; currency: string; year: number }>;
  data_access?: 'limited';
  data_access_note?: string;
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
  invalid_filter_values?: AiInvalidFilterValue[];
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
