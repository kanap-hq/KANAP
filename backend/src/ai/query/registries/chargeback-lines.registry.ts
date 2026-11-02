import { AiEntityFilterRegistry } from '../ai-filter.types';
import { AI_CHARGEBACK_ALLOCATION_METHODS } from '../ai-chargeback.query';
import { CHARGEBACK_PARAMETER_FIELDS } from './chargeback.registry';

/**
 * Reporting › Company chargeback, read through the screen's service (`query/ai-chargeback.query.ts`):
 * the budget lines charged to one company (`company`, required), each with its nature, allocation
 * method, amount and share of the company's consumed amount; the result's `chargeback.company` gives
 * the company's figures and departments. A person in limited access reads it for the companies of
 * their company nodes only, every line charged to it listed, those outside their access by their BL
 * reference and title, as the screen (`readable` false, no link, no id). Listed, filtered, grouped, sorted and paged in memory;
 * the `aggregate` block is descriptive and never reads its empty base table. Read with the reporting
 * right, as the screen.
 */
export const chargebackLinesRegistry: AiEntityFilterRegistry = {
  entityType: 'chargeback_lines',
  fields: {
    ...CHARGEBACK_PARAMETER_FIELDS,
    company: {
      ai: 'company',
      grid: 'company',
      type: 'text',
      description: 'Required: the company of the report, by its exact name (without case) or the one name that contains it. Several matching names are refused with the names.',
      sortable: false,
      groupable: false,
    },
    line: {
      ai: 'line',
      grid: 'line',
      type: 'text',
      description: 'A budget line: its BL reference (BL-12, compared exactly) or a part of its name.',
      sortable: true,
      groupable: false,
    },
    allocation_method: {
      ai: 'allocation_method',
      grid: 'allocation_method',
      type: 'set',
      description: 'How the line is spread: headcount, it_users, turnover (the year\'s rule or the line\'s driver), manual_company, manual_department or manual_pct.',
      values: [...AI_CHARGEBACK_ALLOCATION_METHODS],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    amount: {
      ai: 'amount',
      grid: 'amount',
      type: 'number',
      description: 'The share of the line charged to the company, in the reporting currency.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    share_pct: {
      ai: 'share_pct',
      grid: 'share_pct',
      type: 'number',
      description: 'That amount as a percentage of the company\'s consumed amount (12.5 is 12.5 %).',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
  },
  sortFields: {
    amount: 'amount',
    line: 'line',
    allocation_method: 'allocation_method',
    share_pct: 'share_pct',
  },
  defaultSort: {
    field: 'amount',
    direction: 'desc',
  },
  aggregate: {
    baseTable: '',
    alias: 'cbl',
    groupFields: {
      nature: { expression: 'nature' },
      allocation_method: { expression: 'allocation_method' },
    },
  },
};
