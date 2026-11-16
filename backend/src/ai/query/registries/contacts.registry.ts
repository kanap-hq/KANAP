import { AiEntityFilterRegistry } from '../ai-filter.types';

export const contactsRegistry: AiEntityFilterRegistry = {
  entityType: 'contacts',
  fields: {
    // The list's reference column (`item_number`, shown `CTCT-12`): `ContactsService.list` compares
    // each value's number whole (`compileReferenceFilter`).
    reference: {
      ai: 'reference',
      grid: 'item_number',
      type: 'set',
      description: 'Contact reference, such as CTCT-12.',
      acceptedValueKind: 'CTCT-n reference',
      examples: ['CTCT-12'],
      sortable: true,
      groupable: false,
    },
    country: {
      ai: 'country',
      grid: 'country',
      type: 'set',
      description: 'Contact country code.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    supplier: {
      ai: 'supplier',
      grid: 'supplier_name',
      type: 'text',
      description: 'Primary supplier name.',
      sortable: true,
      groupable: true,
    },
    email: {
      ai: 'email',
      grid: 'email',
      type: 'text',
      description: 'Contact email.',
      sortable: true,
      groupable: false,
    },
  },
  sortFields: {
    reference: 'item_number',
    label: 'last_name',
    first_name: 'first_name',
    last_name: 'last_name',
    email: 'email',
    country: 'country',
    supplier: 'supplier_name',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'last_name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'contacts',
    alias: 'ct',
    groupFields: {
      country: { expression: 'ct.country' },
      supplier: {
        expression: 'sup.name',
        joins: ['LEFT JOIN suppliers sup ON sup.id = ct.supplier_id AND sup.tenant_id = ct.tenant_id'],
      },
    },
  },
};
