import { z } from 'zod';

/**
 * Schema for common list/pagination query parameters.
 * Supports offset-based pagination, sorting, filtering, and include fields.
 */
export const ListQuerySchema = z.object({
  /** Number of items to skip (offset-based pagination) */
  offset: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return 0;
      const num = typeof val === 'number' ? val : parseInt(val, 10);
      return isNaN(num) || num < 0 ? 0 : num;
    }),

  /** Maximum number of items to return */
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return 20;
      const num = typeof val === 'number' ? val : parseInt(val, 10);
      if (isNaN(num) || num < 1) return 20;
      return Math.min(num, 100);
    }),

  /** Sort specification: field:direction (e.g., "created_at:DESC") */
  sort: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return { field: 'created_at', direction: 'DESC' as const };
      const [field, dirRaw] = val.split(':');
      const direction = dirRaw?.toUpperCase() === 'ASC' ? ('ASC' as const) : ('DESC' as const);
      return { field: field || 'created_at', direction };
    }),

  /** JSON-encoded filter object for AG Grid or similar filtering */
  filter: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      try {
        const parsed = JSON.parse(val);
        return typeof parsed === 'object' ? parsed : undefined;
      } catch {
        return undefined;
      }
    })
    .optional(),

  /** Comma-separated list of relations to include */
  include: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return [];
      return val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }),

  /** Quick text search query */
  q: z.string().optional(),

  /** Status filter: enabled/disabled */
  status: z.enum(['enabled', 'disabled']).optional(),
});

export type ListQueryInput = z.input<typeof ListQuerySchema>;
export type ListQuery = z.output<typeof ListQuerySchema>;

/**
 * ListQueryDto class for use with NestJS controllers.
 * Can be used with manual validation via ListQuerySchema.parse()
 * or ListQuerySchema.safeParse().
 *
 * Example usage in a controller:
 * ```
 * @Get()
 * list(@Query() query: ListQueryInput) {
 *   const parsed = ListQuerySchema.parse(query);
 *   // Use parsed.offset, parsed.limit, parsed.sort, etc.
 * }
 * ```
 */
export class ListQueryDto implements ListQuery {
  offset!: number;
  limit!: number;
  sort!: { field: string; direction: 'ASC' | 'DESC' };
  filter?: Record<string, unknown>;
  include!: string[];
  q?: string;
  status?: 'enabled' | 'disabled';

  /**
   * Parse and validate query parameters using Zod.
   */
  static parse(input: unknown): ListQuery {
    return ListQuerySchema.parse(input);
  }

  /**
   * Safely parse query parameters, returning success/error result.
   */
  static safeParse(input: unknown): z.ZodSafeParseResult<ListQuery> {
    return ListQuerySchema.safeParse(input);
  }

  /**
   * Create a ListQueryDto instance from raw input.
   */
  static from(input: unknown): ListQueryDto {
    const parsed = ListQuerySchema.parse(input);
    const dto = new ListQueryDto();
    Object.assign(dto, parsed);
    return dto;
  }
}
