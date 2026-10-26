import { BadRequestException } from '@nestjs/common';

/** Inclusive bounds of a companies year (list, totals, export, import). */
export const COMPANY_YEAR_MIN = 1900;
export const COMPANY_YEAR_MAX = 2999;

export const COMPANY_YEAR_MESSAGE = `Year must be a four-digit year from ${COMPANY_YEAR_MIN} to ${COMPANY_YEAR_MAX}.`;

/**
 * `Number("2")` is finite, and `new Date("2-12-31T23:59:59.999Z")` is an invalid
 * date. The list then sends that date to PostgreSQL and the request fails.
 * Only four digits inside the bounds are accepted. An absent value stays absent,
 * so each caller keeps its own default.
 */
export function parseCompanyYear(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const text = String(raw).trim();
  if (text === '') return undefined;
  if (!/^\d{4}$/.test(text)) throw new BadRequestException(COMPANY_YEAR_MESSAGE);
  const year = Number(text);
  if (year < COMPANY_YEAR_MIN || year > COMPANY_YEAR_MAX) throw new BadRequestException(COMPANY_YEAR_MESSAGE);
  return year;
}

/** The year's window. The year is already checked: this never builds an invalid date. */
export function companyYearPeriod(year: number): { start: Date; end: Date } {
  if (!Number.isInteger(year) || year < COMPANY_YEAR_MIN || year > COMPANY_YEAR_MAX) {
    throw new BadRequestException(COMPANY_YEAR_MESSAGE);
  }
  const start = new Date(`${year}-01-01`);
  const end = new Date(`${year}-12-31T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException(COMPANY_YEAR_MESSAGE);
  }
  return { start, end };
}
