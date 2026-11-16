import {
  compileAgFilterCondition,
  compileReferenceFilter,
  type CompiledCondition,
  type ParamNameFactory,
} from '../common/ag-grid-filtering';
import { isPaddedReferenceNumber, parseItemNumber } from '../common/parse-item-number';

/** The prefix of a contract's business reference (`CTR-12`), numbered by the database (`item_number`). */
export const CONTRACT_REFERENCE_PREFIX = 'CTR';

/** `CTR-12`, or null without a number. */
export function contractReference(itemNumber: number | string | null | undefined): string | null {
  const number = Number(itemNumber);
  return itemNumber != null && Number.isSafeInteger(number) && number > 0 ? `${CONTRACT_REFERENCE_PREFIX}-${number}` : null;
}

/**
 * The number `text` names as a contract reference: `CTR-12` (any case), and the bare `12` when
 * `bare` is set. A number written with a leading zero (`CTR-013`) is text, never a reference
 * (`isPaddedReferenceNumber`). Null otherwise.
 */
export function contractReferenceNumber(text: string | null | undefined, opts: { bare?: boolean } = {}): number | null {
  const match = String(text ?? '').trim().match(opts.bare ? /^(?:CTR-)?(\d+)$/i : /^CTR-(\d+)$/i);
  if (!match || isPaddedReferenceNumber(CONTRACT_REFERENCE_PREFIX, match[1])) return null;
  return parseItemNumber(match[1]);
}

/**
 * How a contract is named outside its own page: `CTR-12 · Name`, as an incident is `INC-12 · Title`.
 * `alias` is a contract row joined under the person's access: a contract out of reach joins no row,
 * and the label is null (the caller says "outside your access").
 */
export function contractLabelSql(alias: string): string {
  return `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE '${CONTRACT_REFERENCE_PREFIX}-' || ${alias}.item_number::text || ' · ' || ${alias}.name END`;
}

/** The label of `contractLabelSql`, for a row already read. */
export function contractLabel(itemNumber: number | string | null | undefined, name: string | null | undefined): string {
  const reference = contractReference(itemNumber);
  const text = String(name ?? '').trim();
  return reference ? (text ? `${reference} · ${text}` : reference) : text;
}

/**
 * The filter of the list's reference column (`item_number`), which shows `CTR-12`: a text or
 * number model through `compileReferenceFilter` ("CTR-12" and "12" find CTR-12); a set model
 * (the assistant's `reference` filter) matches the references it lists exactly, `CTR-12` or `12`.
 */
export function contractReferenceFilter(model: any, expression: string, nextParam: ParamNameFactory): CompiledCondition | null {
  if (model && typeof model === 'object' && model.filterType === 'set' && Array.isArray(model.values)) {
    const numbers = model.values
      .map((value: unknown) => (typeof value === 'string' || typeof value === 'number' ? contractReferenceNumber(String(value), { bare: true }) : null))
      .filter((value: number | null): value is number => value !== null);
    const values = model.values.some((value: unknown) => value === null) ? [...numbers, null] : numbers;
    return compileAgFilterCondition({ ...model, values }, { expression, dataType: 'number' }, nextParam);
  }
  return compileReferenceFilter(model, expression, CONTRACT_REFERENCE_PREFIX, nextParam);
}
