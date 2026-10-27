/**
 * "Copy budget columns": the rows of the table and the rule of its statuses, for the screen
 * (`CopyBudgetPage.tsx`) and for the API's export of the preview
 * (`GET /budget-lines/budget-operations/copy/export`). The backend cannot import the frontend tree: it
 * holds a byte-identical copy in `backend/src/spend/budget-operations-export/shared/`, checked by
 * `backend/src/spend/reports/__tests__/report-shared-copies.spec.ts`.
 *
 * Pure functions and self-contained types, without a single import. Each side words the statuses in
 * its language: the key names `operations.copyBudget.status.<key>` in `ops.json`, `year` and `method`
 * (an allocation method code, worded as the allocation tab does) fill its placeholders.
 */

/** A line of the aggregate window (`readOperationLines`): the source and destination amounts by id. */
export type CopyWindowLine = {
  id: string;
  name: string;
  itemNumber: number | null;
  nature: 'opex' | 'capex' | null;
  values: Record<string, number>;
};

/** What the copy answers for the amounts of a line. */
export type CopyAmountsAnswer = {
  sourceValue: number;
  currentDestinationValue: number;
  newValue: number;
  skipped: boolean;
  skip: string | null;
};

/** What the copy answers for the allocations of a line. */
export type CopyAllocationsAnswer = {
  sourceMethod: string | null;
  destinationMethod: string | null;
  resultMethod: string | null;
  action: string;
  message?: string | null;
};

/** One line of the copy's answer. */
export type CopyLineAnswer<A extends CopyAmountsAnswer, L extends CopyAllocationsAnswer> = {
  itemId: string;
  itemNumber: number;
  nature: 'opex' | 'capex';
  itemName: string;
  amounts?: A;
  allocations?: L;
};

/** One budget line of the table: what the aggregate reads, and what the copy answered for it. */
export type CopyRow<A extends CopyAmountsAnswer, L extends CopyAllocationsAnswer> = {
  id: string;
  itemNumber: number | null;
  nature: 'opex' | 'capex' | null;
  name: string;
  /** The source and current destination columns in the line's own currency. */
  sourceValue: number;
  destinationValue: number;
  amounts?: A;
  allocations?: L;
  /** The copy lists the line: a line it leaves out is not valid in the destination year. */
  answered: boolean;
};

/**
 * The rows of the table: the lines of the window in its order (amounts `source` and `destination`),
 * each with the copy's answer when there is one, then the lines the copy lists and the window does not
 * hold. Without an answer (no preview yet), the window's lines alone.
 */
export function copyBudgetRows<A extends CopyAmountsAnswer, L extends CopyAllocationsAnswer>(
  lines: ReadonlyArray<CopyWindowLine>,
  results: ReadonlyArray<CopyLineAnswer<A, L>> | undefined,
): Array<CopyRow<A, L>> {
  const answers = new Map((results ?? []).map((line) => [line.itemId, line]));
  const known = new Set(lines.map((line) => line.id));
  const fromLines: Array<CopyRow<A, L>> = lines.map((line) => {
    const answer = answers.get(line.id);
    return {
      id: line.id,
      itemNumber: line.itemNumber ?? answer?.itemNumber ?? null,
      nature: line.nature ?? answer?.nature ?? null,
      name: line.name,
      sourceValue: line.values.source ?? 0,
      destinationValue: line.values.destination ?? 0,
      amounts: answer?.amounts,
      allocations: answer?.allocations,
      answered: !!answer,
    };
  });
  // A line the copy lists and the window does not hold still shows.
  const extra: Array<CopyRow<A, L>> = (results ?? []).filter((answer) => !known.has(answer.itemId)).map((answer) => ({
    id: answer.itemId,
    itemNumber: answer.itemNumber,
    nature: answer.nature,
    name: answer.itemName,
    sourceValue: answer.amounts?.sourceValue ?? 0,
    destinationValue: answer.amounts?.currentDestinationValue ?? 0,
    amounts: answer.amounts,
    allocations: answer.allocations,
    answered: true,
  }));
  return [...fromLines, ...extra];
}

/** The destination column after the copy: the copy's new value, else (a line it leaves out) the current one. */
export function copyAfterValue(row: CopyRow<CopyAmountsAnswer, CopyAllocationsAnswer>): number {
  return row.answered && row.amounts ? row.amounts.newValue : row.destinationValue;
}

export type CopyStatusKey =
  | 'toCopy'
  | 'copied'
  | 'replaces'
  | 'replaced'
  | 'notValid'
  | 'noSource'
  | 'sourceEmpty'
  | 'destinationFilled'
  | 'noSourceAllocation'
  | 'destinationAllocation'
  | 'error';

/**
 * A status of a line: the key of its words, what fills them (`year`; `method`, an allocation method code;
 * `message`, the server's error) and its tone (written, left as it is, or failed).
 */
export type CopyStatus = {
  key: CopyStatusKey;
  tone: 'copy' | 'skip' | 'error';
  year?: number;
  method?: string | null;
  message?: string;
};

/** The parameters a status reads: the years, and whether the copy ran (`done`) or is a preview. */
export type CopyStatusContext = { done: boolean; sourceYear: number; destinationYear: number };

/** The status of a line's amounts; null when the copy did not answer the amounts. */
export function copyAmountsStatus(
  row: CopyRow<CopyAmountsAnswer, CopyAllocationsAnswer>,
  context: CopyStatusContext,
): CopyStatus | null {
  if (!row.answered) return { key: 'notValid', tone: 'skip', year: context.destinationYear };
  const part = row.amounts;
  if (!part) return null;
  switch (part.skip) {
    case 'no_source': return { key: 'noSource', tone: 'skip', year: context.sourceYear };
    case 'source_empty': return { key: 'sourceEmpty', tone: 'skip' };
    case 'destination_filled': return { key: 'destinationFilled', tone: 'skip' };
    default: return { key: context.done ? 'copied' : 'toCopy', tone: 'copy' };
  }
}

/** The status of a line's allocations; null when the copy did not answer the allocations. */
export function copyAllocationsStatus(
  row: CopyRow<CopyAmountsAnswer, CopyAllocationsAnswer>,
  context: CopyStatusContext,
): CopyStatus | null {
  if (!row.answered) return { key: 'notValid', tone: 'skip', year: context.destinationYear };
  const part = row.allocations;
  if (!part) return null;
  switch (part.action) {
    case 'copy': {
      // A destination that follows another method takes the source's: an allocation without rows typed by hand counts as empty.
      const replaced = part.destinationMethod != null && part.destinationMethod !== part.resultMethod;
      if (replaced) return { key: context.done ? 'replaced' : 'replaces', tone: 'copy', method: part.destinationMethod };
      return { key: context.done ? 'copied' : 'toCopy', tone: 'copy' };
    }
    case 'skip_missing_source_version': return { key: 'noSource', tone: 'skip', year: context.sourceYear };
    case 'skip_no_source_allocations': return { key: 'noSourceAllocation', tone: 'skip', year: context.sourceYear };
    case 'skip_destination_has_data': return { key: 'destinationAllocation', tone: 'skip', year: context.destinationYear };
    default: return { key: 'error', tone: 'error', message: part.message ?? '' };
  }
}
