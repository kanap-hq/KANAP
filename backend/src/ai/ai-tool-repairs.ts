import { HttpException } from '@nestjs/common';
import { dataAccessRefusalMessage } from '../common/filters/database-error.mapping';

/**
 * A failed tool call that a later call of the same tool repairs, in the same turn, is part of the
 * model's work: the chat does not show it as a failure (point 16 of the quality pass, P2-10). The
 * server decides it, the screen follows: the successful call's `tool_result` names the calls it
 * repaired (`repairs`).
 *
 * Only an input error repairs: a value the tool refused or could not resolve (a reference, a name,
 * a missing field, arguments that are not JSON). A refused right or a server error stays a failure,
 * and so does a failure on another target (another record, another title).
 */

/** `input`: a value the call can fix; `denied`: a right; `server`: anything else. */
export type AiToolFailureKind = 'input' | 'denied' | 'server';

const INPUT_STATUSES = new Set([400, 404, 409, 422]);
const DENIED_STATUSES = new Set([401, 403]);

export function toolFailureKind(error: unknown): AiToolFailureKind {
  if (dataAccessRefusalMessage(error)) return 'denied';
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (DENIED_STATUSES.has(status)) return 'denied';
    if (INPUT_STATUSES.has(status)) return 'input';
  }
  return 'server';
}

export type AiRepairableToolFailure = {
  /** The provider's tool call id, as the chat shows it. */
  id: string;
  name: string;
  /** The target of the call (`toolCallTargets`); null when its arguments could not be read: any target. */
  targets: string[] | null;
};

const normalized = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * The record a call is about: its reference or id, else the title or name of the record it
 * creates, else the family it reads. A call with none of them is about the tool itself (`''`).
 */
export function toolCallTargets(args: unknown): string[] {
  const input = asRecord(args) ?? {};
  const fields = asRecord(input.fields) ?? {};
  for (const value of [input.ref, input.entity_id, input.id, input.title, input.name, fields.name, fields.title, fields.product_name]) {
    const target = normalized(value);
    if (target) return [target];
  }
  return [normalized(input.entity_type) ?? ''];
}

/**
 * What a successful result says it is about, by reference, name or id: the target of its
 * preview(s), or the record a detail or context read returned.
 */
function resultTargets(result: unknown): string[] {
  const record = asRecord(result);
  if (!record) return [];
  const previews = Array.isArray(record.previews) ? record.previews : [record];
  const targets: string[] = [];
  const add = (...values: unknown[]) => {
    for (const value of values) {
      const text = normalized(value);
      if (text) targets.push(text);
    }
  };
  for (const preview of previews) {
    const target = asRecord(asRecord(preview)?.target);
    add(target?.ref, target?.title, target?.entity_id);
  }
  const entity = asRecord(record.entity);
  add(entity?.ref, entity?.label, entity?.id);
  return targets;
}

export function isToolErrorResult(result: unknown): boolean {
  return !!asRecord(result) && 'error' in (result as Record<string, unknown>);
}

/**
 * The failures a successful call repairs, taken out of `failures`: the earlier input errors of the
 * same tool on the same target in this turn.
 */
export function takeRepairedToolFailures(
  failures: AiRepairableToolFailure[],
  success: { name: string; args: unknown; result: unknown },
): string[] {
  if (isToolErrorResult(success.result)) return [];
  const targets = new Set([...toolCallTargets(success.args), ...resultTargets(success.result)]);
  const repaired: string[] = [];
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    const failure = failures[index];
    if (failure.name !== success.name) continue;
    if (failure.targets && !failure.targets.some((target) => targets.has(target))) continue;
    repaired.unshift(failure.id);
    failures.splice(index, 1);
  }
  return repaired;
}
