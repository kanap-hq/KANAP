import { AiEntityFilterRegistry, AiFilterFieldDef } from '../ai-filter.types';
import { AI_CHARGEBACK_COLUMNS, AI_CHARGEBACK_LEVELS, AI_CHARGEBACK_NATURES } from '../ai-chargeback.query';

/** The report parameters both chargeback families take, as filters. */
export const CHARGEBACK_PARAMETER_FIELDS: Record<'year' | 'column' | 'nature', AiFilterFieldDef> = {
  year: {
    ai: 'year',
    grid: 'year',
    type: 'number',
    description: 'The year of the report, one year only, as {"op": "eq", "value": 2026}; the current year by default (the year argument of query_entities also sets it). The result\'s `chargeback.warnings` says in words what the report could not count (a line it could not spread, a line without a paying company, amounts or turnovers without an exchange rate): say each one in the answer.',
    sortable: false,
    groupable: false,
  },
  column: {
    ai: 'column',
    grid: 'column',
    type: 'set',
    description: 'The budget column the report spreads, one column: budget, review, forecast, actual or landing, the columns in their order whatever the workspace names them (describe_entity_filters on budget_lines gives their names). The workspace\'s default column when not given.',
    values: [...AI_CHARGEBACK_COLUMNS],
    discoverable: true,
    sortable: false,
    groupable: false,
  },
  nature: {
    ai: 'nature',
    grid: 'nature',
    type: 'set',
    description: 'The budget lines the report spreads: opex or capex. None or both: the two natures, which `chargeback.nature` says (the chargeback screens open on OPEX only).',
    values: [...AI_CHARGEBACK_NATURES],
    discoverable: true,
    sortable: false,
    groupable: true,
  },
};

const amountField = (description: string, sortable = true): AiFilterFieldDef => ({
  ai: '', grid: '', type: 'number', description, sortable, groupable: false, aggregable: true,
});

function field(name: string, definition: AiFilterFieldDef): AiFilterFieldDef {
  return { ...definition, ai: name, grid: name };
}

/**
 * Reporting › Global chargeback, read through the screen's service (`query/ai-chargeback.query.ts`):
 * the rows of its "Detailed allocations" table, each beneficiary company (`level` company, with its
 * paid, net and indicators), then its departments (`level` department) and its costs without a
 * department (`level` common). Amounts in the reporting currency, rounded to the cent. Listed,
 * filtered, grouped, sorted and paged in memory; the `aggregate` block is descriptive and never reads
 * its empty base table. A row has no detail of its own: the lines charged to a company are the family
 * `chargeback_lines`. Read with the reporting right, as the screen.
 */
export const chargebackRegistry: AiEntityFilterRegistry = {
  entityType: 'chargeback',
  fields: {
    ...CHARGEBACK_PARAMETER_FIELDS,
    company: {
      ai: 'company',
      grid: 'company',
      type: 'text',
      description: 'The beneficiary company (the company charged). A part of the name matches. A department row carries its company, so two departments of the same name in two companies stay apart.',
      sortable: true,
      groupable: true,
    },
    department: {
      ai: 'department',
      grid: 'department',
      type: 'text',
      description: 'The beneficiary department. A part of the name matches. null on a company row and on the costs without a department (`level` common). Grouped by department, a group is one department of one company, keyed "company › department", and the costs of a company without a department are "company › common costs".',
      sortable: true,
      groupable: true,
    },
    level: {
      ai: 'level',
      grid: 'level',
      type: 'set',
      description: 'company: the company\'s total row (its consumed amount, paid, net and indicators); department: one of its departments; common: its costs without a department. A company\'s department and common rows add up to its company row: a group adds up the company rows, or the department and common rows when grouped by department, when a department is filtered or when the filters keep no company row; a group by level gives each level once. The count of a group is a count of these rows, not of budget lines.',
      values: [...AI_CHARGEBACK_LEVELS],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    amount: field('amount', amountField('The amount charged to the company or department (consumed), in the reporting currency.')),
    share: field('share', amountField('The amount as a fraction of the report total (0.125 is 12.5 %).')),
    paid: field('paid', amountField('Company rows: what the company pays as paying company of the lines, in the reporting currency. A line without a paying company is in no paid total.')),
    net: field('net', amountField('Company rows: consumed minus paid. Positive: the company is charged more than it pays.')),
    headcount: field('headcount', amountField('The headcount of the year (of the company on its company and common rows, of the department on a department row).')),
    cost_per_user: field('cost_per_user', amountField('The amount divided by the headcount.')),
    it_users: field('it_users', amountField('Company rows: the IT users of the year.', false)),
    turnover: field('turnover', amountField('Company rows: the turnover of the year, in the reporting currency (not in millions).', false)),
    cost_per_it_user: field('cost_per_it_user', amountField('Company rows: the amount divided by the IT users.', false)),
    cost_vs_turnover_pct: field('cost_vs_turnover_pct', amountField('Company rows: the amount as a percentage of the turnover (2.5 is 2.5 %).', false)),
  },
  sortFields: {
    amount: 'amount',
    company: 'company',
    department: 'department',
    level: 'level',
    share: 'share',
    paid: 'paid',
    net: 'net',
    headcount: 'headcount',
    cost_per_user: 'cost_per_user',
  },
  defaultSort: {
    field: 'amount',
    direction: 'desc',
  },
  aggregate: {
    baseTable: '',
    alias: 'cb',
    groupFields: {
      company: { expression: 'company' },
      department: { expression: 'department' },
      level: { expression: 'level' },
      nature: { expression: 'nature' },
    },
  },
};
