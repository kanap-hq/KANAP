import { z } from 'zod';

/**
 * Valid PPE (Property, Plant & Equipment) types.
 */
export const PpeTypes = ['hardware', 'software'] as const;

/**
 * Valid investment types for CAPEX items.
 */
export const InvestmentTypes = [
  'replacement',
  'capacity',
  'productivity',
  'security',
  'conformity',
  'business_growth',
  'other',
] as const;

/**
 * Valid priority levels.
 */
export const PriorityLevels = ['mandatory', 'high', 'medium', 'low'] as const;

/**
 * Zod schema for creating a CAPEX item.
 */
export const CreateCapexItemSchema = z.object({
  /** Description of the CAPEX item (required) */
  description: z.string().min(1, 'Description is required'),

  /** PPE type: hardware or software */
  ppe_type: z.enum(PpeTypes),

  /** Investment type */
  investment_type: z.enum(InvestmentTypes),

  /** Priority level */
  priority: z.enum(PriorityLevels).optional().default('medium'),

  /** Currency code (3 characters) */
  currency: z.string().length(3, 'Currency must be a 3-character code'),

  /** Effective start date (YYYY-MM-DD) */
  effective_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),

  /** @deprecated Alias of disabled_at for one release: fills an empty end of validity (YYYY-MM-DD), never stored. */
  effective_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Paying company ID (optional) */
  paying_company_id: z.string().uuid().nullable().optional(),

  /** Legacy company_id field - maps to paying_company_id */
  company_id: z.string().uuid().nullable().optional(),

  /** Account ID (optional) */
  account_id: z.string().uuid().nullable().optional(),

  /** Supplier ID (optional) */
  supplier_id: z.string().uuid().nullable().optional(),

  /** Project ID (optional) */
  project_id: z.string().uuid().nullable().optional(),

  /** IT owner user ID (optional) */
  owner_it_id: z.string().uuid().nullable().optional(),

  /** Business owner user ID (optional) */
  owner_business_id: z.string().uuid().nullable().optional(),

  /** Analytics values by dimension id: a value id, or null to clear; omitted dimensions are untouched */
  analytics_values: z.record(z.string().uuid(), z.string().uuid().nullable()).optional(),

  /** Legacy: the default dimension's value (refused when analytics_values names another one for it) */
  analytics_category_id: z.string().uuid().nullable().optional(),

  /** Cost center ID (a cost center, not a group); an empty paying company takes its company */
  cost_center_id: z.string().uuid().nullable().optional(),

  /** Run or build */
  run_build: z.enum(['run', 'build']).nullable().optional(),

  /** Notes (optional) */
  notes: z.string().nullable().optional(),

  /** End of validity (optional, ISO date or datetime): the last day the item is in service */
  disabled_at: z.string().nullable().optional(),
});

export type CreateCapexItemInput = z.input<typeof CreateCapexItemSchema>;
export type CreateCapexItemDto = z.output<typeof CreateCapexItemSchema>;

/**
 * Parse and validate create CAPEX item input.
 */
export function parseCreateCapexItem(input: unknown): CreateCapexItemDto {
  return CreateCapexItemSchema.parse(input);
}
