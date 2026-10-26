import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Shared by the OPEX and CAPEX create schemas, and by the create gate of `resolveItemWrite`. */
export const EFFECTIVE_START_MESSAGE = 'Date must be in YYYY-MM-DD format';

/**
 * A required start date. A missing key uses the same sentence as a bad value,
 * so the 400 names the field instead of saying only "Required".
 */
export const EffectiveStartSchema = z.string({ error: EFFECTIVE_START_MESSAGE })
  .regex(/^\d{4}-\d{2}-\d{2}$/, EFFECTIVE_START_MESSAGE);

/** Create-only: the column is NOT NULL and a missing date used to surface as a 500. */
export function assertEffectiveStart(value: unknown): void {
  if (EffectiveStartSchema.safeParse(value).success) return;
  throw new BadRequestException({
    message: `effective_start: ${EFFECTIVE_START_MESSAGE}`,
    field: 'effective_start',
  });
}
