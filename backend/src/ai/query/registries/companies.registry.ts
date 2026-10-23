import { AiEntityFilterRegistry } from '../ai-filter.types';

/**
 * Metric year of `aggregate_entities`. The tool takes no year, so the join uses
 * the database's current date, the same year headcount and IT users aggregate.
 */
export const COMPANY_AGGREGATE_METRIC_YEAR_SQL = 'EXTRACT(YEAR FROM CURRENT_DATE)::int';

const COMPANY_METRIC_JOIN =
  `LEFT JOIN company_metrics m ON m.company_id = c.id AND m.tenant_id = c.tenant_id AND m.fiscal_year = ${COMPANY_AGGREGATE_METRIC_YEAR_SQL}`;

export const companiesRegistry: AiEntityFilterRegistry = {
  entityType: 'companies',
  fields: {
    status: {
      ai: 'status',
      grid: 'status',
      type: 'set',
      description: 'Company lifecycle status.',
      values: ['enabled', 'disabled'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    country: {
      ai: 'country',
      grid: 'country_iso',
      type: 'set',
      description: 'Company country code.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    country_iso: {
      ai: 'country_iso',
      grid: 'country_iso',
      type: 'set',
      description: 'Company country code.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    city: {
      ai: 'city',
      grid: 'city',
      type: 'set',
      description: 'Company city.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    state: {
      ai: 'state',
      grid: 'state',
      type: 'set',
      description: 'Company state or region.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    base_currency: {
      ai: 'base_currency',
      grid: 'base_currency',
      type: 'set',
      description: 'Company base currency.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    headcount_year: {
      ai: 'headcount_year',
      grid: 'headcount_year',
      type: 'number',
      description: 'Company headcount for the selected metric year. Query year defaults to the current year.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    it_users_year: {
      ai: 'it_users_year',
      grid: 'it_users_year',
      type: 'number',
      description: 'Company IT users for the selected metric year. Query year defaults to the current year.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    turnover_year: {
      ai: 'turnover_year',
      grid: 'turnover_year',
      type: 'number',
      description: 'Company turnover for the selected metric year, in millions of the company\'s base currency (turnover_currency on each row). Query year defaults to the current year. aggregate_entities converts the values into the reporting currency named by amounts_currency, at the year\'s rate. A company whose currency has no rate is left out and named in turnover_fx_missing.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    metrics_frozen: {
      ai: 'metrics_frozen',
      grid: 'metrics_frozen',
      type: 'set',
      description: 'Whether company metrics are frozen for the selected metric year.',
      values: ['true', 'false'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
  },
  sortFields: {
    label: 'name',
    name: 'name',
    status: 'status',
    country: 'country_iso',
    country_iso: 'country_iso',
    city: 'city',
    state: 'state',
    base_currency: 'base_currency',
    headcount_year: 'headcount_year',
    it_users_year: 'it_users_year',
    turnover_year: 'turnover_year',
    metrics_frozen: 'metrics_frozen',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'companies',
    alias: 'c',
    groupFields: {
      status: { expression: 'c.status' },
      country: { expression: 'c.country_iso' },
      country_iso: { expression: 'c.country_iso' },
      city: { expression: 'c.city' },
      state: { expression: 'c.state' },
      base_currency: { expression: 'c.base_currency' },
      metrics_frozen: {
        expression: `CASE WHEN COALESCE(m.is_frozen, false) THEN 'true' ELSE 'false' END`,
        joins: [COMPANY_METRIC_JOIN],
      },
    },
    metricFields: {
      headcount_year: {
        expression: 'm.headcount',
        type: 'number',
        joins: [COMPANY_METRIC_JOIN],
      },
      it_users_year: {
        expression: 'm.it_users',
        type: 'number',
        joins: [COMPANY_METRIC_JOIN],
      },
      turnover_year: {
        expression: 'm.turnover',
        type: 'number',
        joins: [COMPANY_METRIC_JOIN],
      },
    },
  },
};
