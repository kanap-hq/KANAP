import { AiEntityFilterRegistry } from '../ai-filter.types';
import { AI_EXCHANGE_RATE_SOURCES } from '../ai-exchange-rates.query';

/**
 * The exchange rates of the Currency settings screen, read through its services
 * (`query/ai-exchange-rates.query.ts`): one row per year and currency of the screen's matrix, the
 * reporting currency included. Every response carries the currency settings and the pairs in use
 * without a rate (`exchange_rates`). Listed, filtered, grouped, sorted and paged in memory; the
 * `aggregate` block is descriptive and never reads its empty base table. A rate has no detail, no
 * reference and no page link: the Currency settings screen is an administration setting. Read with
 * the budget right at reader level, limited access included.
 */
export const exchangeRatesRegistry: AiEntityFilterRegistry = {
  entityType: 'exchange_rates',
  fields: {
    year: {
      ai: 'year',
      grid: 'year',
      type: 'number',
      description: 'The year of the rate (a column of the screen\'s matrix), from 1900 to 3000. Each year reads its latest set of rates.',
      sortable: true,
      groupable: true,
    },
    currency: {
      ai: 'currency',
      grid: 'currency',
      type: 'set',
      description: 'The currency of the row, a 3-letter ISO code compared exactly (USD). Its rate is in the reporting currency for 1 unit of it. A currency not in use and without a manual rate has no row.',
      examples: ['USD', 'CHF'],
      sortable: true,
      groupable: true,
    },
    source: {
      ai: 'source',
      grid: 'source',
      type: 'set',
      description: 'Where the rate comes from: world-bank-annual (annual average), exchangerateapi-spot (current rate), world-bank-forward (forward estimate), estimate, identity (the reporting currency, 1 by definition) or manual (entered by hand on the Currency settings screen; a manual rate wins over every download). null: no rate for that year.',
      values: [...AI_EXCHANGE_RATE_SOURCES, null],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    manual: {
      ai: 'manual',
      grid: 'manual',
      type: 'set',
      description: 'true: the rate was entered by hand (source manual); false: downloaded, the reporting currency, or no rate.',
      values: ['true', 'false'],
      discoverable: true,
      sortable: false,
      groupable: true,
    },
    against: {
      ai: 'against',
      grid: 'against',
      type: 'set',
      description: 'One currency code (CHF): each row then carries cross_rate, the units of that currency for 1 unit of the row\'s currency, computed by the server from the two rates of the same year, and cross_rate_note for a year where either rate is missing. It keeps every row: combine it with currency and year for one pair ("USD in CHF in 2026": currency USD, against CHF, year 2026).',
      examples: ['CHF'],
      sortable: false,
      groupable: false,
    },
  },
  sortFields: {
    year: 'year',
    currency: 'currency',
    source: 'source',
  },
  defaultSort: {
    field: 'year',
    direction: 'asc',
  },
  aggregate: {
    baseTable: '',
    alias: 'fx',
    groupFields: {
      year: { expression: 'year' },
      currency: { expression: 'currency' },
      source: { expression: 'source' },
      manual: { expression: 'manual' },
    },
  },
};
