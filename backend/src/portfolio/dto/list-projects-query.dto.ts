import { z } from 'zod';
import { ListQuerySchema, ListQuery } from '../../common/dto/list-query.dto';
import { ProjectStatuses, ProjectOrigins } from './create-project.dto';

/**
 * Extended query schema for listing portfolio projects.
 * Extends the common ListQuerySchema with project-specific filters.
 */
export const ListProjectsQuerySchema = ListQuerySchema.extend({
  /** Filter by status (comma-separated for multiple) */
  status: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const statuses = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return statuses.length > 0 ? statuses : undefined;
    })
    .optional(),

  /** Filter by origin */
  origin: z.enum(ProjectOrigins).optional(),

  /** Filter by company ID */
  company_id: z.string().uuid().optional(),

  /** Filter by department ID */
  department_id: z.string().uuid().optional(),

  /** Filter by source ID */
  source_id: z.string().uuid().optional(),

  /** Filter by category ID */
  category_id: z.string().uuid().optional(),

  /** Filter by stream ID */
  stream_id: z.string().uuid().optional(),

  /** Filter by business sponsor ID */
  business_sponsor_id: z.string().uuid().optional(),

  /** Filter by business lead ID */
  business_lead_id: z.string().uuid().optional(),

  /** Filter by IT sponsor ID */
  it_sponsor_id: z.string().uuid().optional(),

  /** Filter by IT lead ID */
  it_lead_id: z.string().uuid().optional(),

  /** Scope to projects involving this user */
  involvedUserId: z.string().uuid().optional(),

  /** Scope to projects involving users in this team */
  involvedTeamId: z.string().uuid().optional(),

  /** `contributor`: only the projects the user may write to (time entries) */
  access: z.enum(['reader', 'contributor']).optional(),

  /** Filter by year (for timeline views) */
  year: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      const num = typeof val === 'number' ? val : parseInt(val, 10);
      return isNaN(num) ? undefined : num;
    })
    .optional(),

  /** Filter by month (for timeline views) */
  month: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      const num = typeof val === 'number' ? val : parseInt(val, 10);
      return isNaN(num) || num < 1 || num > 12 ? undefined : num;
    })
    .optional(),
});

export type ListProjectsQueryInput = z.input<typeof ListProjectsQuerySchema>;
export type ListProjectsQuery = z.output<typeof ListProjectsQuerySchema>;

/**
 * Parse and validate list projects query parameters.
 */
export function parseListProjectsQuery(input: unknown): ListProjectsQuery {
  return ListProjectsQuerySchema.parse(input);
}

/**
 * DTO class for list projects query.
 */
export class ListProjectsQueryDto implements ListProjectsQuery {
  offset!: number;
  limit!: number;
  sort!: { field: string; direction: 'ASC' | 'DESC' };
  filter?: Record<string, unknown>;
  include!: string[];
  q?: string;
  status?: string[];
  origin?: (typeof ProjectOrigins)[number];
  company_id?: string;
  department_id?: string;
  source_id?: string;
  category_id?: string;
  stream_id?: string;
  business_sponsor_id?: string;
  business_lead_id?: string;
  it_sponsor_id?: string;
  it_lead_id?: string;
  involvedUserId?: string;
  involvedTeamId?: string;
  access?: 'reader' | 'contributor';
  year?: number;
  month?: number;

  static parse(input: unknown): ListProjectsQuery {
    return ListProjectsQuerySchema.parse(input);
  }

  static safeParse(input: unknown): z.ZodSafeParseResult<ListProjectsQuery> {
    return ListProjectsQuerySchema.safeParse(input);
  }

  static from(input: unknown): ListProjectsQueryDto {
    const parsed = ListProjectsQuerySchema.parse(input);
    const dto = new ListProjectsQueryDto();
    Object.assign(dto, parsed);
    return dto;
  }
}
