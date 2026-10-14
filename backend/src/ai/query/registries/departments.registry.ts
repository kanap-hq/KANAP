import { AiEntityFilterRegistry } from '../ai-filter.types';

export const departmentsRegistry: AiEntityFilterRegistry = {
  entityType: 'departments',
  fields: {
    status: {
      ai: 'status',
      grid: 'status',
      type: 'set',
      description: 'Department lifecycle status.',
      values: ['enabled', 'disabled'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    company: {
      ai: 'company',
      grid: 'company_name',
      type: 'set',
      description: 'Parent company name.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    headcount_year: {
      ai: 'headcount_year',
      grid: 'headcount_year',
      type: 'number',
      description: 'Department headcount for the selected metric year. Query year defaults to the current year.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    metrics_frozen: {
      ai: 'metrics_frozen',
      grid: 'metrics_frozen',
      type: 'set',
      description: 'Whether department metrics are frozen for the selected metric year.',
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
    company: 'company_name',
    headcount_year: 'headcount_year',
    metrics_frozen: 'metrics_frozen',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'departments',
    alias: 'd',
    groupFields: {
      status: { expression: 'd.status' },
      company: {
        expression: 'c.name',
        joins: [
          `LEFT JOIN companies c ON c.id = d.company_id AND c.tenant_id = d.tenant_id`,
        ],
      },
      metrics_frozen: {
        expression: `CASE WHEN COALESCE(m.is_frozen, false) THEN 'true' ELSE 'false' END`,
        joins: [
          `LEFT JOIN department_metrics m ON m.department_id = d.id AND m.tenant_id = d.tenant_id AND m.fiscal_year = EXTRACT(YEAR FROM CURRENT_DATE)::int`,
        ],
      },
    },
    metricFields: {
      headcount_year: {
        expression: 'm.headcount',
        type: 'number',
        joins: [
          `LEFT JOIN department_metrics m ON m.department_id = d.id AND m.tenant_id = d.tenant_id AND m.fiscal_year = EXTRACT(YEAR FROM CURRENT_DATE)::int`,
        ],
      },
    },
  },
};
