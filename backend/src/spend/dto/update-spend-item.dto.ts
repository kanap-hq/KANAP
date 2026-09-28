import { z } from 'zod';

/**
 * Zod schema for updating a spend item.
 * All fields are optional for partial updates.
 */
export const UpdateSpendItemSchema = z.object({
  /** Product name */
  product_name: z.string().min(1).optional(),

  /** Description */
  description: z.string().nullable().optional(),

  /** Currency code (3 characters) */
  currency: z.string().length(3, 'Currency must be a 3-character code').optional(),

  /** Effective start date (YYYY-MM-DD) */
  effective_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),

  /** @deprecated Alias of disabled_at for one release: fills an empty end of validity (YYYY-MM-DD), never stored. */
  effective_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Paying company ID */
  paying_company_id: z.string().uuid().nullable().optional(),

  /** Account ID */
  account_id: z.string().uuid().nullable().optional(),

  /** Supplier ID */
  supplier_id: z.string().uuid().nullable().optional(),

  /** IT Owner ID */
  owner_it_id: z.string().uuid().nullable().optional(),

  /** Business Owner ID */
  owner_business_id: z.string().uuid().nullable().optional(),

  /** Analytics values by dimension id: a value id, or null to clear; omitted dimensions are untouched */
  analytics_values: z.record(z.string().uuid(), z.string().uuid().nullable()).optional(),

  /** Legacy: the default dimension's value (refused when analytics_values names another one for it) */
  analytics_category_id: z.string().uuid().nullable().optional(),

  /** Project ID */
  project_id: z.string().uuid().nullable().optional(),

  /** Contract ID */
  contract_id: z.string().uuid().nullable().optional(),

  /** Cost center ID (a cost center, not a group); an empty paying company takes its company */
  cost_center_id: z.string().uuid().nullable().optional(),

  /** Run or build */
  run_build: z.enum(['run', 'build']).nullable().optional(),

  /** Notes */
  notes: z.string().nullable().optional(),

  /** Status (enabled/disabled) */
  status: z.enum(['enabled', 'disabled']).optional(),

  /** When the item was disabled */
  disabled_at: z.string().nullable().optional(),
});

export type UpdateSpendItemInput = z.input<typeof UpdateSpendItemSchema>;
export type UpdateSpendItemDto = z.output<typeof UpdateSpendItemSchema>;

/**
 * Parse and validate update spend item input.
 */
export function parseUpdateSpendItem(input: unknown): UpdateSpendItemDto {
  return UpdateSpendItemSchema.parse(input);
}
