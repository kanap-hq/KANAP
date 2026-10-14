import { AiEntityFilterRegistry } from '../ai-filter.types';

export const suppliersRegistry: AiEntityFilterRegistry = {
  entityType: 'suppliers',
  fields: {
    status: {
      ai: 'status',
      grid: 'status',
      type: 'set',
      description: 'Supplier lifecycle status.',
      values: ['enabled', 'disabled'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    erp_supplier_id: {
      ai: 'erp_supplier_id',
      grid: 'erp_supplier_id',
      type: 'set',
      description: 'ERP supplier identifier.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: false,
    },
  },
  sortFields: {
    label: 'name',
    name: 'name',
    status: 'status',
    erp_supplier_id: 'erp_supplier_id',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'suppliers',
    alias: 's',
    groupFields: {
      status: { expression: 's.status' },
    },
  },
};
