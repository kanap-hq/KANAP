import { z } from 'zod';
import { ListQuerySchema, ListQuery } from '../../common/dto/list-query.dto';

/**
 * Extended query schema for listing spend items.
 * Extends the common ListQuerySchema with spend-specific filters.
 */
export const ListSpendQuerySchema = ListQuerySchema.extend({
  /** Filter by paying company ID */
  paying_company_id: z.string().uuid().optional(),

  /** Filter by supplier ID */
  supplier_id: z.string().uuid().optional(),

  /** Filter by project ID */
  project_id: z.string().uuid().optional(),

  /** Filter by contract ID */
  contract_id: z.string().uuid().optional(),

  /** Filter by account ID */
  account_id: z.string().uuid().optional(),

  /** Filter by IT owner ID */
  owner_it_id: z.string().uuid().optional(),

  /** Filter by business owner ID */
  owner_business_id: z.string().uuid().optional(),

  /** Filter by year (for budget summary) */
  year: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      const num = typeof val === 'number' ? val : parseInt(val, 10);
      return isNaN(num) ? undefined : num;
    }),
});

export type ListSpendQueryInput = z.input<typeof ListSpendQuerySchema>;
export type ListSpendQuery = z.output<typeof ListSpendQuerySchema>;

/**
 * Parse and validate list spend query parameters.
 */
export function parseListSpendQuery(input: unknown): ListSpendQuery {
  return ListSpendQuerySchema.parse(input);
}

/**
 * DTO class for list spend query.
 */
export class ListSpendQueryDto implements ListSpendQuery {
  offset!: number;
  limit!: number;
  sort!: { field: string; direction: 'ASC' | 'DESC' };
  filter?: Record<string, unknown>;
  include!: string[];
  q?: string;
  status?: 'enabled' | 'disabled';
  paying_company_id?: string;
  supplier_id?: string;
  project_id?: string;
  contract_id?: string;
  account_id?: string;
  owner_it_id?: string;
  owner_business_id?: string;
  year?: number;

  static parse(input: unknown): ListSpendQuery {
    return ListSpendQuerySchema.parse(input);
  }

  static safeParse(input: unknown): z.SafeParseReturnType<ListSpendQueryInput, ListSpendQuery> {
    return ListSpendQuerySchema.safeParse(input);
  }

  static from(input: unknown): ListSpendQueryDto {
    const parsed = ListSpendQuerySchema.parse(input);
    const dto = new ListSpendQueryDto();
    Object.assign(dto, parsed);
    return dto;
  }
}
