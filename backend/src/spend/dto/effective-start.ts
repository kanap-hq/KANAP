import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Shared by the OPEX and CAPEX create schemas, and by the write gate of `resolveItemWrite`. */
export const EFFECTIVE_START_MESSAGE = 'Date must be in YYYY-MM-DD format';

/**
 * A required start date. A missing key uses the same sentence as a bad value,
 * so the 400 names the field instead of saying only "Required".
 */
export const EffectiveStartSchema = z.string({ error: EFFECTIVE_START_MESSAGE })
  .regex(/^\d{4}-\d{2}-\d{2}$/, EFFECTIVE_START_MESSAGE)
  // A day the calendar has (2026-02-30 is not one): PostgreSQL would refuse it with a 500.
  .refine((value) => {
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
  }, EFFECTIVE_START_MESSAGE);

/** A create, or an update that names the date: the column is NOT NULL and a bad date used to surface as a 500. */
export function assertEffectiveStart(value: unknown): void {
  if (EffectiveStartSchema.safeParse(value).success) return;
  throw new BadRequestException({
    message: `effective_start: ${EFFECTIVE_START_MESSAGE}`,
    field: 'effective_start',
  });
}
