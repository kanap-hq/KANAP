import { z } from 'zod';
import {
  CriticalityLevels,
  DataClassifications,
  EnvironmentTypes,
  HostingModels,
  UsersModes,
} from './create-application.dto';

/**
 * Zod schema for updating an application.
 * All fields are optional for partial updates.
 */
export const UpdateApplicationSchema = z.object({
  /** Application name */
  name: z.string().min(1).max(255).optional(),

  /** Supplier ID */
  supplier_id: z.string().uuid().nullable().optional(),

  /** Application category code or label. Tenant settings validate allowed values. */
  category: z.string().trim().min(1).optional(),

  /** Description */
  description: z.string().nullable().optional(),

  /** Editor/Publisher name */
  editor: z.string().nullable().optional(),

  /** Version string */
  version: z.string().nullable().optional(),

  /** Date when support ends */
  end_of_support_date: z.string().nullable().optional(),

  /** Go-live date */
  go_live_date: z.string().nullable().optional(),

  /** Predecessor application ID for version lineage */
  predecessor_id: z.string().uuid().nullable().optional(),

  /** Lifecycle stage */
  lifecycle: z.string().optional(),

  /** Environment type (deprecated, use AppInstance.environment) */
  environment: z.enum(EnvironmentTypes).optional(),

  /** Criticality level */
  criticality: z.string().nullable().optional(),

  /** Data classification level */
  data_class: z.string().nullable().optional(),

  rto_minutes: z.number().int().min(1).max(2147483647).nullable().optional(),
  rpo_minutes: z.number().int().min(0).max(2147483647).nullable().optional(),
  cyber_criticality: z.string().nullable().optional(),
  recovery_wave: z.string().nullable().optional(),
  classification_justification: z.string().nullable().optional(),

  /** Hosting model (deprecated, use AppInstance) */
  hosting_model: z.enum(HostingModels).optional(),

  /** Whether the app is externally facing */
  external_facing: z.boolean().optional(),

  /** Whether this application is a suite containing other apps */
  is_suite: z.boolean().optional(),

  /** Retired date */
  retired_date: z.string().nullable().optional(),

  /** Last disaster recovery test date */
  last_dr_test: z.string().nullable().optional(),

  /** SSO enabled (deprecated, use AppInstance) */
  sso_enabled: z.boolean().optional(),

  /** MFA supported (deprecated, use AppInstance) */
  mfa_supported: z.boolean().optional(),

  /** ETL enabled */
  etl_enabled: z.boolean().optional(),

  /** Access methods available */
  access_methods: z.array(z.string()).max(1000).optional(),

  /** Contains personally identifiable information */
  contains_pii: z.boolean().optional(),

  /** Licensing information */
  licensing: z.string().nullable().optional(),

  /** General notes */
  notes: z.string().nullable().optional(),

  /** Support notes */
  support_notes: z.string().nullable().optional(),

  /** Method for calculating user count */
  users_mode: z.enum(UsersModes).optional(),

  /** Year for users calculation */
  users_year: z.number().int().optional(),

  /** Manual override for user count */
  users_override: z.number().int().nullable().optional(),

  /** Status (enabled/disabled) */
  status: z.enum(['enabled', 'disabled']).optional(),

  /** When the application was disabled */
  disabled_at: z.string().nullable().optional(),
});

export type UpdateApplicationInput = z.input<typeof UpdateApplicationSchema>;
export type UpdateApplicationDto = z.output<typeof UpdateApplicationSchema>;

/**
 * Parse and validate update application input.
 */
export function parseUpdateApplication(input: unknown): UpdateApplicationDto {
  return UpdateApplicationSchema.parse(input);
}
