import { z } from 'zod';

/**
 * Valid project status values.
 */
export const ProjectStatuses = [
  'waiting_list',
  'planned',
  'in_progress',
  'in_testing',
  'on_hold',
  'done',
  'cancelled',
] as const;

/**
 * Valid project origin values.
 */
export const ProjectOrigins = ['standard', 'fast_track', 'legacy'] as const;
export const ProjectSchedulingModes = ['independent', 'collaborative'] as const;

/**
 * Zod schema for creating a portfolio project.
 */
export const CreateProjectSchema = z.object({
  /** Project name (required) */
  name: z.string().min(1, 'Name is required').max(255),

  /** Project purpose (optional) */
  purpose: z.string().nullable().optional(),

  /** Project source ID (optional) */
  source_id: z.string().uuid().nullable().optional(),

  /** Project category ID (optional) */
  category_id: z.string().uuid().nullable().optional(),

  /** Project stream ID (optional) */
  stream_id: z.string().uuid().nullable().optional(),

  /** Company ID (optional) */
  company_id: z.string().uuid().nullable().optional(),

  /** Department ID (optional) */
  department_id: z.string().uuid().nullable().optional(),

  /** Project origin */
  origin: z.enum(ProjectOrigins).optional().default('standard'),

  /** Project status */
  status: z.enum(ProjectStatuses).optional().default('waiting_list'),

  /** Scheduling mode */
  scheduling_mode: z.enum(ProjectSchedulingModes).optional().default('independent'),

  /** Priority score (optional) */
  priority_score: z.number().nullable().optional(),

  /** Priority override flag */
  priority_override: z.boolean().optional().default(false),

  /** Override justification (optional) */
  override_justification: z.string().nullable().optional(),

  /** Override value (optional) */
  override_value: z.number().nullable().optional(),

  /** Criteria values (JSON object) */
  criteria_values: z.record(z.string(), z.string()).optional().default({}),

  /** Execution progress percentage */
  execution_progress: z.number().min(0).max(100).optional().default(0),

  /** Planned start date (YYYY-MM-DD) */
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Planned end date (YYYY-MM-DD) */
  planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Actual start date (YYYY-MM-DD) */
  actual_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Actual end date (YYYY-MM-DD) */
  actual_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Baseline start date (YYYY-MM-DD) */
  baseline_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Baseline end date (YYYY-MM-DD) */
  baseline_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').nullable().optional(),

  /** Baseline IT effort (optional) */
  baseline_effort_it: z.number().nullable().optional(),

  /** Baseline business effort (optional) */
  baseline_effort_business: z.number().nullable().optional(),

  /** Estimated IT effort (optional) */
  estimated_effort_it: z.number().nullable().optional(),

  /** Estimated business effort (optional) */
  estimated_effort_business: z.number().nullable().optional(),

  /** Actual IT effort (optional) */
  actual_effort_it: z.number().nullable().optional(),

  /** Actual business effort (optional) */
  actual_effort_business: z.number().nullable().optional(),

  /** Business sponsor ID (optional) */
  business_sponsor_id: z.string().uuid().nullable().optional(),

  /** Business lead ID (optional) */
  business_lead_id: z.string().uuid().nullable().optional(),

  /** IT sponsor ID (optional) */
  it_sponsor_id: z.string().uuid().nullable().optional(),

  /** IT lead ID (optional) */
  it_lead_id: z.string().uuid().nullable().optional(),
});

export type CreateProjectInput = z.input<typeof CreateProjectSchema>;
export type CreateProjectDto = z.output<typeof CreateProjectSchema>;

/**
 * Parse and validate create project input.
 */
export function parseCreateProject(input: unknown): CreateProjectDto {
  return CreateProjectSchema.parse(input);
}
