import { z } from 'zod';

/**
 * Valid application lifecycles.
 */
export const ApplicationLifecycles = [
  'active',
  'planning',
  'development',
  'pilot',
  'production',
  'sunset',
  'retired',
] as const;

/**
 * Valid criticality levels.
 */
export const CriticalityLevels = ['business_critical', 'high', 'medium', 'low'] as const;

/**
 * Valid data classification levels.
 */
export const DataClassifications = ['public', 'internal', 'confidential', 'restricted'] as const;

/**
 * Valid hosting models.
 */
export const HostingModels = ['on_premise', 'saas', 'public_cloud', 'private_cloud'] as const;

/**
 * Valid environment types.
 */
export const EnvironmentTypes = ['prod', 'dev', 'test', 'qa', 'pre_prod', 'sandbox'] as const;

/**
 * Valid users mode values.
 */
export const UsersModes = ['manual', 'it_users', 'headcount'] as const;

/**
 * Zod schema for creating an application.
 */
export const CreateApplicationSchema = z.object({
  /** Application name (required) */
  name: z.string().min(1, 'Name is required').max(255),

  /** Supplier ID (optional) */
  supplier_id: z.string().uuid().nullable().optional(),

  /** Application category code or label. Tenant settings validate allowed values. */
  category: z.string().trim().min(1).optional(),

  /** Description (optional) */
  description: z.string().nullable().optional(),

  /** Editor/Publisher name (optional) */
  editor: z.string().nullable().optional(),

  /** Version string (optional) */
  version: z.string().nullable().optional(),

  /** Date when support ends (optional) */
  end_of_support_date: z.string().nullable().optional(),

  /** Go-live date (optional) */
  go_live_date: z.string().nullable().optional(),

  /** Predecessor application ID for version lineage (optional) */
  predecessor_id: z.string().uuid().nullable().optional(),

  /** Lifecycle stage */
  lifecycle: z.string().optional().default('active'),

  /** Environment type (deprecated, use AppInstance.environment) */
  environment: z.enum(EnvironmentTypes).optional().default('prod'),

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
  hosting_model: z.enum(HostingModels).nullable().optional(),

  /** Whether the app is externally facing */
  external_facing: z.boolean().optional().default(false),

  /** Whether this application is a suite containing other apps */
  is_suite: z.boolean().optional().default(false),

  /** Retired date (optional) */
  retired_date: z.string().nullable().optional(),

  /** Last disaster recovery test date */
  last_dr_test: z.string().nullable().optional(),

  /** SSO enabled (deprecated, use AppInstance) */
  sso_enabled: z.boolean().optional().default(false),

  /** MFA supported (deprecated, use AppInstance) */
  mfa_supported: z.boolean().optional().default(false),

  /** ETL enabled */
  etl_enabled: z.boolean().optional().default(false),

  /** Access methods available */
  access_methods: z.array(z.string()).max(1000).optional().default([]),

  /** Contains personally identifiable information */
  contains_pii: z.boolean().optional().default(false),

  /** Licensing information */
  licensing: z.string().nullable().optional(),

  /** General notes */
  notes: z.string().nullable().optional(),

  /** Support notes */
  support_notes: z.string().nullable().optional(),

  /** Method for calculating user count */
  users_mode: z.enum(UsersModes).optional().default('it_users'),

  /** Year for users calculation */
  users_year: z.number().int().optional(),

  /** Manual override for user count */
  users_override: z.number().int().nullable().optional(),
});

export type CreateApplicationInput = z.input<typeof CreateApplicationSchema>;
export type CreateApplicationDto = z.output<typeof CreateApplicationSchema>;

/**
 * Parse and validate create application input.
 */
export function parseCreateApplication(input: unknown): CreateApplicationDto {
  return CreateApplicationSchema.parse(input);
}
