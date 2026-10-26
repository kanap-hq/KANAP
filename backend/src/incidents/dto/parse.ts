import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { legacyIssueMessage } from '../../common/zod-error';

/**
 * Parse a body with a zod schema, surfacing validation failures as 400s.
 */
export function parseWith<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input ?? {}, { reportInput: true });
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new BadRequestException(`${where}${issue ? legacyIssueMessage(issue) : 'Invalid input'}`);
  }
  return result.data;
}

/** ISO date-time string (any offset), kept as a string until the service converts it. */
export const DateTimeString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date-time');
