import { AiEntityFilterRegistry } from '../ai-filter.types';

// The dimension of a value, joined on the tenant; the default dimension without a name reads as the product label.
const AXIS_JOIN = 'LEFT JOIN analytics_axes ax ON ax.id = ac.axis_id AND ax.tenant_id = ac.tenant_id';

export const analyticsCategoriesRegistry: AiEntityFilterRegistry = {
  entityType: 'analytics_categories',
  fields: {
    status: {
      ai: 'status',
      grid: 'status',
      type: 'set',
      description: 'Analytics category lifecycle status.',
      values: ['enabled', 'disabled'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    name: {
      ai: 'name',
      grid: 'name',
      type: 'text',
      description: 'Analytics category name.',
      sortable: true,
      groupable: true,
    },
    axis: {
      ai: 'axis',
      grid: 'axis_name',
      type: 'set',
      description: 'Name of the analytics dimension the value belongs to ("Analytics dimension" for the default one while it has no name). Each value belongs to one dimension.',
      dynamic: true,
      discoverable: true,
      groupable: true,
    },
    axis_code: {
      ai: 'axis_code',
      grid: 'axis_code',
      type: 'set',
      description: 'Code of the analytics dimension the value belongs to: the analytics:<code> field of OPEX and CAPEX items.',
      dynamic: true,
      discoverable: true,
      groupable: true,
    },
  },
  sortFields: {
    label: 'name',
    name: 'name',
    status: 'status',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'analytics_categories',
    alias: 'ac',
    groupFields: {
      status: { expression: 'ac.status' },
      name: { expression: 'ac.name' },
      axis: { expression: `COALESCE(NULLIF(BTRIM(ax.name), ''), 'Analytics dimension')`, joins: [AXIS_JOIN] },
      axis_code: { expression: 'ax.code', joins: [AXIS_JOIN] },
    },
  },
};
