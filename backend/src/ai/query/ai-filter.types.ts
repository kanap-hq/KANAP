import type { BudgetNature } from '../../spend/budget-nature';
import { AiEntitySummaryDto, AiQueryScope } from '../ai.types';

export type AiFilterFieldType = 'set' | 'text' | 'number' | 'date';
export type AiQueryEntityType =
  | 'accounts'
  | 'analytics_categories'
  | 'applications'
  | 'assets'
  | 'budget_lines'
  | 'business_processes'
  | 'chart_of_accounts'
  | 'companies'
  | 'connections'
  | 'contacts'
  | 'contracts'
  | 'data_access'
  | 'departments'
  | 'documents'
  | 'incidents'
  | 'interfaces'
  | 'locations'
  | 'projects'
  | 'requests'
  | 'role_permissions'
  | 'roles'
  | 'suppliers'
  | 'support_deadlines'
  | 'support_gaps'
  | 'tasks'
  | 'technologies'
  | 'technology_versions'
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
  /** An analytics dimension that applies to one nature only: the field is blank for the other. */
  nature?: BudgetNature;
  lookupEntity?: AiQueryEntityType;
  examples?: string[];
  doesNotAccept?: string[];
  /**
   * A family of generated keys (`<year>_<column>_staff_cost`): describe_entity_filters lists the
   * family once, with its keys, instead of one entry per key.
   */
  family?: string;
};

export type AiAggregateGroupDef = {
  expression: string;
  joins?: string[];
  /**
   * Counts the distinct base rows of the group instead of every joined row: a many-to-many group
   * whose links can repeat the same name (two IT owners named alike) counts the record once.
   */
  countDistinct?: boolean;
  /**
   * A many-to-many group narrowed to the caller's participation on one linked family (a Business
   * Contributor's applications): the join that names `table` as `alias` also carries the
   * participant condition, so the group lists only the linked records the caller takes part in.
   */
  participation?: {
    entityType: 'applications';
    table: string;
    alias: string;
  };
};

export type AiAggregateMetricType = 'number' | 'date';

export type AiAggregateMetricDef = {
  expression: string;
  joins?: string[];
  type: AiAggregateMetricType;
  /** The decimal places the server keeps in a group's value (an exact definition, a readable figure). */
  round?: number;
};

export type AiAggregateConfig = {
  baseTable: string;
  alias: string;
  /**
   * A predicate every statement on `baseTable` carries besides the tenant, written here only,
   * never from a request. Budget lines name the two natures: the family reads both.
   */
  baseWhere?: string;
  idColumn?: string;
  /**
   * The record a row stands for, when a family has several rows per record (vulnerabilities: one
   * row per technology version of a CVE). A count then gives each group `distinct_count`, the
   * distinct `expression` among its rows, and the result `distinct_total` over every row the
   * filters keep, named by `distinct_label`. `expression` reads the base alias only.
   */
  distinctRecord?: { name: string; expression: string };
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
  /** Metrics aggregate_entities computes that are not fields (budget lines: the cost per FTE and the day rate). */
  metricFamilies?: AiMetricFamilyDescription[];
  /** The fields left out for this person for lack of a right, each with the reason (`withoutUnreadableLinkedCounts`). */
  withheldFields?: AiWithheldField[];
};

/** A group (or the others row) of an aggregate of budget lines with `metrics`: its line count and one value per metric. */
export type AiBudgetMetricsRow = {
  count: number;
  values: Record<string, number | null>;
  /** The FTE metrics only: the lines without an FTE, left out of the value. */
  unknown?: Record<string, number>;
};

/** A field of a family the person may not read, and why: describe_entity_filters and the refusals say it. */
export type AiWithheldField = {
  field: string;
  reason: string;
};

/**
 * The staff figures of a group of budget lines in one year and column, as the "Cost per FTE"
 * report shows them: the people and days lines' FTE and cost, the cost per FTE, the days the
 * per-day lines buy, their cost and the day rate. Amounts in the reporting currency.
 */
export type AiBudgetStaffFigures = {
  staff_fte: number | null;
  staff_cost: number | null;
  cost_per_fte: number | null;
  days: number | null;
  day_cost: number | null;
  day_rate: number | null;
};

/** A family of aggregate-only metrics, as describe_entity_filters lists it. */
export type AiMetricFamilyDescription = {
  family: string;
  description: string;
  /** Every key of the family, when it lists them. */
  metrics?: string[];
  /** A few keys, for a family that combines two (a change between any two columns). */
  examples?: string[];
};

/** A family of generated fields, as describe_entity_filters lists it: one entry for its keys. */
export type AiFieldFamilyDescription = {
  family: string;
  type: AiFilterFieldType;
  description: string;
  accepted_value_kind: string;
  examples: string[];
  sortable: boolean;
  groupable: boolean;
  aggregable: boolean;
  fields: string[];
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
  /**
   * Budget lines: each amount field (`y_budget`, `y_minus1_actual`...) and each line total
   * (`y_budget_staff_cost`, `y_budget_staff_fte`, `y_budget_day_cost`, `y_budget_days`) summed over
   * the records; a staff FTE or days total is null when no record has one.
   */
  values?: Record<string, number | null>;
  /** Contracts: the yearly amounts summed per contract currency. */
  by_currency?: Array<{ currency: string | null; yearly_amount: number | null; contracts: number; without_amount: number }>;
  /** Budget lines: the currencies and years without an exchange rate, left out of `values`. */
  fx_missing?: Array<{ currency: string; year: number; lines: number }>;
  note: string;
};

export type AiQueryResult = {
  /** `invalid_filter_value`: every filter not applied is a known field given values it does not take. */
  status?: 'ok' | 'invalid_filter' | 'invalid_filter_value';
  /**
   * `support_gaps` and `support_deadlines`: false when the caller does not read applications. The
   * application rows are then left out and the application counts are null (`applications_visible_note`).
   */
  applications_visible?: boolean;
  applications_visible_note?: string;
  /**
   * `data_access`: whether limiting data access works on the database, what is missing in the
   * screen's words, the screen's counters and what the mode covers (the budget and the contracts).
   */
  available?: boolean;
  missing?: string[];
  unavailable_note?: string;
  counters?: { limited_persons: number; lines_without_company: number };
  coverage_note?: string;
  items: AiEntitySummaryDto[];
  total: number;
  /** Vulnerabilities: the distinct CVE among the `total` rows (`distinct_label`), as the page's total. */
  distinct_total?: number;
  distinct_label?: string;
  /** Vulnerabilities: how fresh each feed is, as the page's feed line. */
  feeds?: AiVulnerabilityFeed[];
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
  /** The same amounts summed over the items returned only: the total of the records listed (a top N). */
  page_amount_totals?: AiAmountTotals;
  /** `limited`: a person with limited data access; the items and figures cover their access only. */
  data_access?: 'limited';
  data_access_note?: string;
  scope: {
    requested: AiQueryScope;
    resolved: boolean;
    team_name?: string | null;
  } | null;
};

/**
 * One vulnerability feed as the vulnerabilities page shows it (`GET /vulnerabilities/sources`): the
 * feeds that are on, their last success and whether the last attempt failed. Never the error text.
 */
export type AiVulnerabilityFeed = {
  source: 'nvd' | 'cve_org';
  name: string;
  /** ISO 8601; null: never read. */
  last_success_at: string | null;
  failing: boolean;
};

export type AiAggregateResult = {
  status?: 'ok' | 'invalid_filter' | 'invalid_filter_value';
  /**
   * `support_gaps` and `support_deadlines`: false when the caller does not read applications. The
   * application rows are then left out and the application counts are null (`applications_visible_note`).
   */
  applications_visible?: boolean;
  applications_visible_note?: string;
  /**
   * `data_access`: whether limiting data access works on the database, what is missing in the
   * screen's words, the screen's counters and what the mode covers (the budget and the contracts).
   */
  available?: boolean;
  missing?: string[];
  unavailable_note?: string;
  counters?: { limited_persons: number; lines_without_company: number };
  coverage_note?: string;
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
  /** Budget lines: the second group field; each group then carries `then_key`. */
  then_by?: string;
  metric?: string | null;
  /** Budget lines: the metrics measured together (2 to 8, one function); each group then carries `values`. */
  metrics?: string[];
  /**
   * `ratio`: a budget ratio metric (cost per FTE, day rate); `delta`: a change between two budget
   * columns; `by_month`: the FTE of each month of a budget column. Each computed by the server.
   */
  function?: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'ratio' | 'delta' | 'by_month';
  /** Budget lines, a change between two columns: the groups that rise (`increase`) or fall (`decrease`). */
  direction?: 'increase' | 'decrease';
  groups: Array<
    // `distinct_count`: a family with `distinctRecord` (vulnerabilities: the distinct CVE of the group).
    // `then_key`: budget lines with `then_by`, the group's value of the second field (null: the lines without one).
    // `title`: budget lines grouped by line, the line's title (its `key` is its reference, BL-12).
    | { key: string | null; title?: string | null; then_key?: string | null; count: number; distinct_count?: number }
    // `unknown`: FTE metrics only, the lines of the group without an FTE (left out of the value).
    | { key: string | null; title?: string | null; then_key?: string | null; value: number | string | null; unknown?: number }
    | ({ key: string | null; title?: string | null; count: number; value: number | null } & AiBudgetStaffFigures)
    // Budget lines with `metrics`: one value per metric; `unknown` per FTE metric.
    | AiBudgetMetricsRow & { key: string | null; title?: string | null; then_key?: string | null }
    // Budget lines, a change between two columns: the source, the destination and the change (pct_increase null when the source is 0 or less).
    | { key: string | null; title?: string | null; count: number; previous: number | null; current: number | null; delta: number; pct_increase: number | null }
    // Budget lines, the FTE by month: January to December (null: no line of the group details the month), the average (÷ 12) and the peak.
    | { key: string | null; title?: string | null; months: Array<number | null>; average: number | null; peak: number | null }
  >;
  /**
   * Budget lines with a metric: the same measure over every line the filters keep (all groups
   * together), computed by the server. A ratio's overall figures are the ratios of the totals.
   * With `metrics`, `values` and `unknown` per metric in place of `value` and `unknown`.
   */
  overall?: {
    count: number;
    value?: number | null;
    values?: Record<string, number | null>;
    unknown?: number | Record<string, number>;
  } & Partial<AiBudgetStaffFigures> & {
    fte_without_line_detail?: number;
    fte_amount_not_following_lines?: number;
    staff_cost_not_in_day_rate?: number;
    /** A change between two columns, over every line: the sources, the destinations, the net change and its rises and falls (the falls as a positive figure). */
    previous?: number | null;
    current?: number | null;
    net?: number | null;
    gross_increase?: number | null;
    gross_decrease?: number | null;
    /** The FTE by month, over every line, and the FTE declared without monthly detail (in no month). */
    months?: Array<number | null>;
    average?: number | null;
    peak?: number | null;
    fte_without_monthly_detail?: number;
  };
  /**
   * Budget lines with `limit` (by default with `then_by`): the groups past it as one row, absent
   * when there are none; `group_count` counts every group, these included.
   */
  others?: { count: number; value?: number | null; values?: Record<string, number | null>; unknown?: number | Record<string, number>; groups: number };
  group_count?: number;
  /** Budget lines: the number of groups returned at most, when one applies. */
  limit?: number;
  /** Budget ratio metrics: how the figures are computed and what they leave out. */
  ratio_note?: string;
  /** Budget lines, the FTE by month: how the figures are computed and what they leave out. */
  monthly_fte_note?: string;
  total: number;
  /**
   * A family with `distinctRecord`: the distinct records (`distinct_label`, vulnerabilities: cve)
   * among every row the filters keep. Not the sum of the groups' `distinct_count`.
   */
  distinct_total?: number;
  distinct_label?: string;
  /** Vulnerabilities: how fresh each feed is, as the page's feed line. */
  feeds?: AiVulnerabilityFeed[];
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
  /** The requested fields this person may not read, with the reason (also in `fields_ignored`). */
  fields_withheld?: AiWithheldField[];
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
  /** Generated fields listed once per family (budget lines: the staff cost, staff FTE, day cost and days of each year and column). */
  field_families?: AiFieldFamilyDescription[];
  /** Metrics of aggregate_entities that are not fields (budget lines: the cost per FTE and the day rate). */
  metric_families?: AiMetricFamilyDescription[];
  /** The fields of the family this person may not read, each with the reason. */
  fields_withheld?: AiWithheldField[];
  /** Every `sort.field` query_entities takes for this family (the sortable fields, label, created_at, updated_at...), the keys of `field_families` aside. */
  sort_fields: string[];
  default_sort: { field: string; direction: 'asc' | 'desc' };
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};
