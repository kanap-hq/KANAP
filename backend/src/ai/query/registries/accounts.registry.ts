import { AiEntityFilterRegistry } from '../ai-filter.types';

export const accountsRegistry: AiEntityFilterRegistry = {
  entityType: 'accounts',
  fields: {
    status: {
      ai: 'status',
      grid: 'status',
      type: 'set',
      description: 'Account lifecycle status.',
      values: ['enabled', 'disabled'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    coa_code: {
      ai: 'coa_code',
      grid: 'coa_code',
      type: 'text',
      description: 'Chart of accounts code.',
      sortable: true,
      groupable: true,
    },
    account_number: {
      ai: 'account_number',
      grid: 'account_number',
      type: 'text',
      description: 'Account number.',
      sortable: true,
      groupable: true,
    },
    account_name: {
      ai: 'account_name',
      grid: 'account_name',
      type: 'text',
      description: 'Account name.',
      sortable: true,
      groupable: false,
    },
    nature: {
      ai: 'nature',
      grid: 'nature',
      type: 'set',
      description: 'The budget lines that may use the account: opex (OPEX lines only), capex (CAPEX lines only). null is an account for both OPEX and CAPEX lines.',
      values: ['opex', 'capex', null],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
  },
  sortFields: {
    label: 'account_name',
    status: 'status',
    coa_code: 'coa_code',
    account_number: 'account_number',
    account_name: 'account_name',
    nature: 'nature',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'account_name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'accounts',
    alias: 'a',
    groupFields: {
      status: { expression: 'a.status' },
      coa_code: {
        expression: 'coa.code',
        joins: ['LEFT JOIN chart_of_accounts coa ON coa.id = a.coa_id AND coa.tenant_id = a.tenant_id'],
      },
      account_number: { expression: 'a.account_number' },
      nature: { expression: 'a.nature' },
    },
  },
};
