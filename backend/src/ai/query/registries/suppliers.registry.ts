import { AiEntityFilterRegistry } from '../ai-filter.types';

export const suppliersRegistry: AiEntityFilterRegistry = {
  entityType: 'suppliers',
  fields: {
    // The list's reference column (`item_number`, shown `SUP-12`): `SuppliersService.list` compares
    // each value's number whole (`compileReferenceFilter`).
    reference: {
      ai: 'reference',
      grid: 'item_number',
      type: 'set',
      description: 'Supplier reference, such as SUP-12. Distinct from the ERP supplier identifier.',
      acceptedValueKind: 'SUP-n reference',
      examples: ['SUP-12'],
      sortable: true,
      groupable: false,
    },
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
    reference: 'item_number',
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
