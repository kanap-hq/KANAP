import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum TenantStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
  DELETING = 'deleting',
  DELETED = 'deleted',
}

export type TenantBranding = {
  logo_storage_path?: string;
  /** Logo shown in dark mode, when the tenant has one. */
  logo_dark_storage_path?: string;
  logo_version?: number;
  use_logo_in_dark?: boolean;
  primary_color_light?: string | null;
  primary_color_dark?: string | null;
};

/** Every stored logo of a tenant's branding: what a purge deletes and the orphan cleanup keeps. */
export function brandingLogoPaths(branding: TenantBranding | Record<string, any> | null | undefined): string[] {
  if (!branding || typeof branding !== 'object') return [];
  return [branding.logo_storage_path, branding.logo_dark_storage_path]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('citext')
  slug!: string;

  @Column('text')
  name!: string;

  @Column('boolean', { default: false })
  is_system_tenant!: boolean;

  @Column({ type: 'enum', enum: TenantStatus, enumName: 'tenant_status', default: TenantStatus.ACTIVE })
  status!: TenantStatus;

  @Column('timestamptz', { nullable: true })
  frozen_at!: Date | null;

  @Column('uuid', { nullable: true })
  frozen_by!: string | null;

  @Column('timestamptz', { nullable: true })
  deletion_requested_at!: Date | null;

  @Column('uuid', { nullable: true })
  deletion_requested_by!: string | null;

  @Column('timestamptz', { nullable: true })
  deletion_confirmed_at!: Date | null;

  @Column('timestamptz', { nullable: true })
  deleted_at!: Date | null;

  @Column('text', { nullable: true })
  deletion_reason!: string | null;

  @Column('uuid', { nullable: true })
  deletion_token!: string | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('text', { nullable: true })
  stripe_customer_id!: string | null;

  @Column('text', { nullable: true })
  billing_email!: string | null;

  @Column('text', { nullable: true })
  billing_company_name!: string | null;

  @Column('text', { nullable: true })
  billing_phone!: string | null;

  @Column('text', { nullable: true })
  billing_tax_id!: string | null;

  @Column('jsonb', { nullable: true, default: () => `'{}'::jsonb` })
  billing_address!: Record<string, any> | null;

  @Column('jsonb', { nullable: true, default: () => `'{}'::jsonb` })
  billing_customer_info!: Record<string, any> | null;

  @Column('jsonb', { nullable: true, default: () => `'{}'::jsonb` })
  billing_invoice_info!: Record<string, any> | null;

  @Column('jsonb', { default: () => `'{}'::jsonb` })
  metadata!: Record<string, any>;

  @Column('text', { default: 'none' })
  sso_provider!: 'none' | 'entra';

  @Column('text', { nullable: true })
  entra_tenant_id!: string | null;

  @Column('boolean', { default: false })
  sso_enabled!: boolean;

  @Column('jsonb', { nullable: true, default: () => `'{}'::jsonb` })
  entra_metadata!: Record<string, any> | null;

  @Column('jsonb', { default: () => `'{"logo_version":0,"use_logo_in_dark":true}'::jsonb` })
  branding!: TenantBranding;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
