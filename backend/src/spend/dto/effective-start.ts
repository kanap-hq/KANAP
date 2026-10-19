import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Shared by the OPEX and CAPEX create schemas, and by the service create gate. */
export const EFFECTIVE_START_MESSAGE = 'Date must be in YYYY-MM-DD format';

/**
 * A required start date. A missing key uses the same sentence as a bad value,
 * so the 400 names the field instead of saying only "Required".
 */
export const EffectiveStartSchema = z.string({
  required_error: EFFECTIVE_START_MESSAGE,
  invalid_type_error: EFFECTIVE_START_MESSAGE,
}).regex(/^\d{4}-\d{2}-\d{2}$/, EFFECTIVE_START_MESSAGE);

/**
 * Validates `body` and throws 400 `{ message, field }` on the first issue.
 * The caller keeps the original body: a successful parse does not replace it,
 * so keys the schema does not know (for example `status`) stay.
 */
export function refuseSchema(schema: z.ZodTypeAny, body: unknown): void {
  const parsed = schema.safeParse(body);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  const head = issue?.path?.[0];
  const field = typeof head === 'string' || typeof head === 'number' ? String(head) : '';
  const detail = issue?.message || 'Invalid value';
  throw new BadRequestException({
    message: field ? `${field}: ${detail}` : detail,
    ...(field ? { field } : {}),
  });
}

/** Create-only: the column is NOT NULL and a missing date used to surface as a 500. */
export function assertEffectiveStart(value: unknown): void {
  if (EffectiveStartSchema.safeParse(value).success) return;
  throw new BadRequestException({
    message: `effective_start: ${EFFECTIVE_START_MESSAGE}`,
    field: 'effective_start',
  });
}
