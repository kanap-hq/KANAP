import { z } from 'zod';
import { ListQuerySchema, ListQuery } from '../../common/dto/list-query.dto';
import { PpeTypes, InvestmentTypes, PriorityLevels } from './create-capex-item.dto';

/**
 * Extended query schema for listing CAPEX items.
 * Extends the common ListQuerySchema with CAPEX-specific filters.
 */
export const ListCapexQuerySchema = ListQuerySchema.extend({
  /** Filter by PPE type */
  ppe_type: z.enum(PpeTypes).optional(),

  /** Filter by investment type */
  investment_type: z.enum(InvestmentTypes).optional(),

  /** Filter by priority */
  priority: z.enum(PriorityLevels).optional(),

  /** Filter by paying company ID */
  paying_company_id: z.string().uuid().optional(),

  /** Filter by supplier ID */
  supplier_id: z.string().uuid().optional(),

  /** Filter by project ID */
  project_id: z.string().uuid().optional(),

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

export type ListCapexQueryInput = z.input<typeof ListCapexQuerySchema>;
export type ListCapexQuery = z.output<typeof ListCapexQuerySchema>;

/**
 * Parse and validate list CAPEX query parameters.
 */
export function parseListCapexQuery(input: unknown): ListCapexQuery {
  return ListCapexQuerySchema.parse(input);
}

/**
 * DTO class for list CAPEX query.
 */
export class ListCapexQueryDto implements ListCapexQuery {
  offset!: number;
  limit!: number;
  sort!: { field: string; direction: 'ASC' | 'DESC' };
  filter?: Record<string, unknown>;
  include!: string[];
  q?: string;
  status?: 'enabled' | 'disabled';
  ppe_type?: (typeof PpeTypes)[number];
  investment_type?: (typeof InvestmentTypes)[number];
  priority?: (typeof PriorityLevels)[number];
  paying_company_id?: string;
  supplier_id?: string;
  project_id?: string;
  account_id?: string;
  owner_it_id?: string;
  owner_business_id?: string;
  year?: number;

  static parse(input: unknown): ListCapexQuery {
    return ListCapexQuerySchema.parse(input);
  }

  static safeParse(input: unknown): z.SafeParseReturnType<ListCapexQueryInput, ListCapexQuery> {
    return ListCapexQuerySchema.safeParse(input);
  }

  static from(input: unknown): ListCapexQueryDto {
    const parsed = ListCapexQuerySchema.parse(input);
    const dto = new ListCapexQueryDto();
    Object.assign(dto, parsed);
    return dto;
  }
}
