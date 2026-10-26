import { z } from 'zod';
import { ListQuerySchema, ListQuery } from '../../common/dto/list-query.dto';
import { ApplicationLifecycles, CriticalityLevels } from './create-application.dto';

/**
 * Extended query schema for listing applications.
 * Extends the common ListQuerySchema with application-specific filters.
 */
export const ListApplicationsQuerySchema = ListQuerySchema.extend({
  /** Filter by category */
  category: z.string().trim().min(1).optional(),

  /** Filter by lifecycle (comma-separated for multiple) */
  lifecycle: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    })
    .optional(),

  /** Filter by criticality */
  criticality: z.string().optional(),

  /** Filter by supplier ID */
  supplier_id: z.string().uuid().optional(),

  /** Filter by external facing */
  external_facing: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true';
    })
    .optional(),

  /** Filter by suite status */
  is_suite: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true';
    })
    .optional(),

  /** Filter by SSO enabled */
  sso_enabled: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true';
    })
    .optional(),

  /** Filter by MFA supported */
  mfa_supported: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true';
    })
    .optional(),

  /** Filter by contains PII */
  contains_pii: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true';
    })
    .optional(),

  /** Scope by owner user ID (My apps) */
  ownerUserId: z.string().uuid().optional(),

  /** Scope by team ID + owner user fallback (My team's apps) */
  ownerTeamId: z.string().uuid().optional(),
});

export type ListApplicationsQueryInput = z.input<typeof ListApplicationsQuerySchema>;
export type ListApplicationsQuery = z.output<typeof ListApplicationsQuerySchema>;

/**
 * Parse and validate list applications query parameters.
 */
export function parseListApplicationsQuery(input: unknown): ListApplicationsQuery {
  return ListApplicationsQuerySchema.parse(input);
}

/**
 * DTO class for list applications query.
 */
export class ListApplicationsQueryDto implements ListApplicationsQuery {
  offset!: number;
  limit!: number;
  sort!: { field: string; direction: 'ASC' | 'DESC' };
  filter?: Record<string, unknown>;
  include!: string[];
  q?: string;
  status?: 'enabled' | 'disabled';
  category?: string;
  lifecycle?: string[];
  criticality?: string;
  supplier_id?: string;
  external_facing?: boolean;
  is_suite?: boolean;
  sso_enabled?: boolean;
  mfa_supported?: boolean;
  contains_pii?: boolean;
  ownerUserId?: string;
  ownerTeamId?: string;

  static parse(input: unknown): ListApplicationsQuery {
    return ListApplicationsQuerySchema.parse(input);
  }

  static safeParse(input: unknown): z.ZodSafeParseResult<ListApplicationsQuery> {
    return ListApplicationsQuerySchema.safeParse(input);
  }

  static from(input: unknown): ListApplicationsQueryDto {
    const parsed = ListApplicationsQuerySchema.parse(input);
    const dto = new ListApplicationsQueryDto();
    Object.assign(dto, parsed);
    return dto;
  }
}
