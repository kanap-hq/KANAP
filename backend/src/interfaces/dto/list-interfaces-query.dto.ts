import { z } from 'zod';
import { ListQuerySchema, ListQuery } from '../../common/dto/list-query.dto';

/**
 * Query for listing interfaces: the common list query plus `filters`, the grid's filter model
 * as a JSON string. InterfacesListService compiles it column by column; there are no
 * per-column query parameters.
 */
export const ListInterfacesQuerySchema = ListQuerySchema.extend({
  /** Grid filter model (JSON), keyed by column. */
  filters: z.string().optional(),
});

export type ListInterfacesQueryInput = z.input<typeof ListInterfacesQuerySchema>;
export type ListInterfacesQuery = z.output<typeof ListInterfacesQuerySchema>;

/**
 * Parse and validate list interfaces query parameters.
 */
export function parseListInterfacesQuery(input: unknown): ListInterfacesQuery {
  return ListInterfacesQuerySchema.parse(input);
}

/**
 * DTO class for list interfaces query.
 */
export class ListInterfacesQueryDto implements ListInterfacesQuery {
  offset!: number;
  limit!: number;
  sort!: { field: string; direction: 'ASC' | 'DESC' };
  filter?: Record<string, unknown>;
  include!: string[];
  q?: string;
  status?: 'enabled' | 'disabled';
  filters?: string;

  static parse(input: unknown): ListInterfacesQuery {
    return ListInterfacesQuerySchema.parse(input);
  }

  static safeParse(input: unknown): z.SafeParseReturnType<ListInterfacesQueryInput, ListInterfacesQuery> {
    return ListInterfacesQuerySchema.safeParse(input);
  }

  static from(input: unknown): ListInterfacesQueryDto {
    const parsed = ListInterfacesQuerySchema.parse(input);
    const dto = new ListInterfacesQueryDto();
    Object.assign(dto, parsed);
    return dto;
  }
}
