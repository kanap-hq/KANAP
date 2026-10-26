import { z } from 'zod';
import { ProjectStatuses, ProjectOrigins, ProjectSchedulingModes } from './create-project.dto';

/**
 * Zod schema for updating a portfolio project.
 * All fields are optional for partial updates.
 */
export const UpdateProjectSchema = z.object({
  /** Project name */
  name: z.string().min(1).max(255).optional(),

  /** Project purpose */
  purpose: z.string().nullable().optional(),

  /** Project source ID */
  source_id: z.string().uuid().nullable().optional(),

  /** Project category ID */
  category_id: z.string().uuid().nullable().optional(),

  /** Project stream ID */
  stream_id: z.string().uuid().nullable().optional(),

  /** Company ID */
  company_id: z.string().uuid().nullable().optional(),

  /** Department ID */
  department_id: z.string().uuid().nullable().optional(),

  /** Project origin */
  origin: z.enum(ProjectOrigins).optional(),

  /** Project status */
  status: z.enum(ProjectStatuses).optional(),

  /** Scheduling mode */
  scheduling_mode: z.enum(ProjectSchedulingModes).optional(),

  /** Priority score */
  priority_score: z.number().nullable().optional(),

  /** Priority override flag */
  priority_override: z.boolean().optional(),

  /** Override justification */
  override_justification: z.string().nullable().optional(),

  /** Override value */
  override_value: z.number().nullable().optional(),

  /** Criteria values (JSON object) */
  criteria_values: z.record(z.string(), z.string()).optional(),

  /** Execution progress percentage */
  execution_progress: z.number().min(0).max(100).optional(),

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

  /** Baseline IT effort */
  baseline_effort_it: z.number().nullable().optional(),

  /** Baseline business effort */
  baseline_effort_business: z.number().nullable().optional(),

  /** Estimated IT effort */
  estimated_effort_it: z.number().nullable().optional(),

  /** Estimated business effort */
  estimated_effort_business: z.number().nullable().optional(),

  /** Actual IT effort */
  actual_effort_it: z.number().nullable().optional(),

  /** Actual business effort */
  actual_effort_business: z.number().nullable().optional(),

  /** Business sponsor ID */
  business_sponsor_id: z.string().uuid().nullable().optional(),

  /** Business lead ID */
  business_lead_id: z.string().uuid().nullable().optional(),

  /** IT sponsor ID */
  it_sponsor_id: z.string().uuid().nullable().optional(),

  /** IT lead ID */
  it_lead_id: z.string().uuid().nullable().optional(),
});

export type UpdateProjectInput = z.input<typeof UpdateProjectSchema>;
export type UpdateProjectDto = z.output<typeof UpdateProjectSchema>;

/**
 * Parse and validate update project input.
 */
export function parseUpdateProject(input: unknown): UpdateProjectDto {
  return UpdateProjectSchema.parse(input);
}
