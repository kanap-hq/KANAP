import { BadRequestException } from '@nestjs/common';
import type { AiAggregateMetricDef, AiEntityFilterRegistry } from '../../../ai/query/ai-filter.types';
import { formatCents, toCents } from '../../../common/amount';
import { Decimal, divRoundHalfAway } from '../../../common/decimal';
import { resolveFteField } from '../../spend-summary.builder';
import { getSummaryFieldValue as getSpendSummaryFieldValue } from './summary-field-value.oracle';

/**
 * THE ORACLE of the AI aggregates of the OPEX and CAPEX lists (lot 2B, PR D):
 * the former in-memory path of `ai-aggregate.executor.ts` (before the list
 * engine's `aggregate()`), unchanged. The executor collected the ids of the
 * list state (`summaryIds` with `includeDisabled`), built the row of every
 * id (`summaryRowsByIds`), then grouped and measured the rows with
 * `getSpendSummaryFieldValue`: the functions below are its
 * `sortValueGroups`, `aggregateFteGroups` and `aggregateBudgetSummaryByIds`,
 * copied verbatim. The only change: the method reads the rows through the
 * `rowsOf` it is given (so a test can build each line's row once) instead of
 * the item service.
 */

type AiAggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';

type BudgetValueGroup = { key: string | null; value: number | null; unknown?: number };

/** Largest value first (smallest for min), groups without a value last, then by key. */
function sortValueGroups<T extends BudgetValueGroup>(groups: T[], fn: AiAggregateFunction): T[] {
  return groups.sort((a, b) => {
    const av = a.value;
    const bv = b.value;
    if (av == null && bv == null) return (a.key ?? '').localeCompare(b.key ?? '');
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) {
      return fn === 'min' ? av - bv : bv - av;
    }
    return (a.key ?? '').localeCompare(b.key ?? '');
  });
}

/**
 * An FTE metric of the OPEX and CAPEX aggregates: exact decimal arithmetic on
 * the lines' FTE (2 decimals each, never through cents of money), and per group
 * `unknown`, the lines whose column has no quantity × price lines, left out of the value. A group
 * of unknown lines only has a null value.
 */
function aggregateFteGroups(rows: any[], groupGrid: string, metricGrid: string, fn: AiAggregateFunction): BudgetValueGroup[] {
  type FteBucket = { key: string | null; sum: Decimal; count: number; unknown: number; min: Decimal | null; max: Decimal | null };
  const buckets = new Map<string, FteBucket>();
  for (const row of rows) {
    const rawKey = getSpendSummaryFieldValue(row, groupGrid);
    const key = rawKey == null || rawKey === '' ? null : String(rawKey);
    const bucketKey = key ?? '__NULL__';
    const bucket = buckets.get(bucketKey) ?? { key, sum: Decimal.ZERO, count: 0, unknown: 0, min: null, max: null };
    buckets.set(bucketKey, bucket);
    const raw = getSpendSummaryFieldValue(row, metricGrid);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      bucket.unknown += 1;
      continue;
    }
    const value = Decimal.from(raw);
    bucket.sum = bucket.sum.add(value);
    bucket.count += 1;
    if (bucket.min == null || value.cmp(bucket.min) < 0) bucket.min = value;
    if (bucket.max == null || value.cmp(bucket.max) > 0) bucket.max = value;
  }
  const toNumber = (value: Decimal | null) => (value == null ? null : Number(value.toString()));
  return Array.from(buckets.values()).map((bucket) => {
    let value: number | null = null;
    if (bucket.count > 0) {
      switch (fn) {
        case 'sum':
          value = toNumber(bucket.sum);
          break;
        case 'avg':
          // Rounded once to 2 decimals, like the line values.
          value = toNumber(bucket.sum.divRound(bucket.count, 2));
          break;
        case 'min':
          value = toNumber(bucket.min);
          break;
        case 'max':
          value = toNumber(bucket.max);
          break;
        default:
          value = null;
      }
    }
    return { key: bucket.key, value, unknown: bucket.unknown };
  });
}

/** OPEX and CAPEX: rows of every id (no page cap), grouped and measured with the list engine's field values. */
export async function aggregateBudgetSummaryByIds(
  rowsOf: (ids: string[]) => Promise<any[]>,
  registry: AiEntityFilterRegistry,
  groupBy: string,
  ids: string[],
  fn: AiAggregateFunction,
  metric: { key: string; def: AiAggregateMetricDef } | null,
): Promise<Array<{ key: string | null; count: number } | BudgetValueGroup>> {
  const groupField = registry.fields[groupBy];
  if (!groupField) {
    throw new BadRequestException('Unsupported group_by field.');
  }

  // ORACLE: the executor read `items.summaryRowsByIds(ids, {}, { manager })`; the caller passes that read.
  const rows = await rowsOf(ids);

  if (fn === 'count' || !metric) {
    const counts = new Map<string, { key: string | null; count: number }>();
    for (const row of rows) {
      const rawKey = getSpendSummaryFieldValue(row, groupField.grid);
      const key = rawKey == null || rawKey === '' ? null : String(rawKey);
      const bucketKey = key ?? '__NULL__';
      const current = counts.get(bucketKey) ?? { key, count: 0 };
      current.count += 1;
      counts.set(bucketKey, current);
    }
    return Array.from(counts.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (a.key ?? '').localeCompare(b.key ?? '');
    });
  }

  const metricField = registry.fields[metric.key];
  if (!metricField) {
    throw new BadRequestException('Unsupported metric field.');
  }
  if (resolveFteField(metricField.grid)) {
    return sortValueGroups(aggregateFteGroups(rows, groupField.grid, metricField.grid, fn), fn);
  }

  // Amounts are summed in cents and converted once: never money in binary floating point.
  type AggregateBucket = {
    key: string | null;
    sum: bigint;
    count: number;
    min: bigint | null;
    max: bigint | null;
  };
  const buckets = new Map<string, AggregateBucket>();

  for (const row of rows) {
    const rawKey = getSpendSummaryFieldValue(row, groupField.grid);
    const key = rawKey == null || rawKey === '' ? null : String(rawKey);
    const rawMetric = getSpendSummaryFieldValue(row, metricField.grid);
    const number = rawMetric == null || rawMetric === '' ? null : Number(rawMetric);
    if (number == null || !Number.isFinite(number)) continue;
    const cents = toCents(number);

    const bucketKey = key ?? '__NULL__';
    const bucket = buckets.get(bucketKey) ?? {
      key,
      sum: 0n,
      count: 0,
      min: null,
      max: null,
    };
    bucket.sum += cents;
    bucket.count += 1;
    bucket.min = bucket.min == null || cents < bucket.min ? cents : bucket.min;
    bucket.max = bucket.max == null || cents > bucket.max ? cents : bucket.max;
    buckets.set(bucketKey, bucket);
  }

  const toAmount = (cents: bigint | null) => (cents == null ? null : Number(formatCents(cents)));
  const values = Array.from(buckets.values()).map((bucket) => {
    let value: number | null = null;
    switch (fn) {
      case 'sum':
        value = toAmount(bucket.sum);
        break;
      case 'avg':
        value = bucket.count > 0 ? toAmount(divRoundHalfAway(bucket.sum, BigInt(bucket.count))) : null;
        break;
      case 'min':
        value = toAmount(bucket.min);
        break;
      case 'max':
        value = toAmount(bucket.max);
        break;
      default:
        value = null;
    }
    return {
      key: bucket.key,
      value,
    };
  });

  return sortValueGroups(values, fn);
}

