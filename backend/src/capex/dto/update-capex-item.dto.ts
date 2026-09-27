import { z } from 'zod';
import { PpeTypes, InvestmentTypes, PriorityLevels } from './create-capex-item.dto';

/**
 * Zod schema for updating a CAPEX item.
 * All fields are optional for partial updates.
 */
export const UpdateCapexItemSchema = z.object({
  /** Description of the CAPEX item */
  description: z.string().min(1).optional(),

  /** PPE type: hardware or software */
  ppe_type: z.enum(PpeTypes).optional(),

  /** Investment type */
  investment_type: z.enum(InvestmentTypes).optional(),

  /** Priority level */
  priority: z.enum(PriorityLevels).optional(),

  /** Currency code (3 characters) */
  currency: z.string().length(3, 'Currency must be a 3-character code').optional(),

  /** Effective start date (YYYY-MM-DD) */
  effective_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),

  /** @deprecated Alias of disabled_at for one release: fills an empty end of validity (YYYY-MM-DD), never stored. */
  effective_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Paying company ID */
  paying_company_id: z.string().uuid().nullable().optional(),

  /** Legacy company_id field - maps to paying_company_id */
  company_id: z.string().uuid().nullable().optional(),

  /** Account ID */
  account_id: z.string().uuid().nullable().optional(),

  /** Supplier ID */
  supplier_id: z.string().uuid().nullable().optional(),

  /** Project ID */
  project_id: z.string().uuid().nullable().optional(),

  /** IT owner user ID */
  owner_it_id: z.string().uuid().nullable().optional(),

  /** Business owner user ID */
  owner_business_id: z.string().uuid().nullable().optional(),

  /** Analytics category ID */
  analytics_category_id: z.string().uuid().nullable().optional(),

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

export type UpdateCapexItemInput = z.input<typeof UpdateCapexItemSchema>;
export type UpdateCapexItemDto = z.output<typeof UpdateCapexItemSchema>;

/**
 * Parse and validate update CAPEX item input.
 */
export function parseUpdateCapexItem(input: unknown): UpdateCapexItemDto {
  return UpdateCapexItemSchema.parse(input);
}
