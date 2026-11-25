import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RequestStatus =
  | 'pending_review'
  | 'candidate'
  | 'approved'
  | 'on_hold'
  | 'rejected'
  | 'converted';

export const FEASIBILITY_REVIEW_KEYS = [
  'technical_feasibility',
  'integration_compatibility',
  'infrastructure_needs',
  'security_compliance',
  'resource_skills',
  'delivery_constraints',
  'change_management',
] as const;

export type FeasibilityReviewKey = typeof FEASIBILITY_REVIEW_KEYS[number];

export const FEASIBILITY_REVIEW_STATUSES = [
  'not_assessed',
  'no_concerns',
  'minor_concerns',
  'major_concerns',
  'blocker',
] as const;

export type FeasibilityReviewStatus = typeof FEASIBILITY_REVIEW_STATUSES[number];

export type FeasibilityReviewEntry = {
  status: FeasibilityReviewStatus;
  comment: string;
};

export type FeasibilityReview = Record<FeasibilityReviewKey, FeasibilityReviewEntry>;

@Entity('portfolio_requests')
@Index(['tenant_id', 'name'])
@Index(['tenant_id', 'status'])
@Index(['tenant_id', 'company_id'])
@Index(['tenant_id', 'item_number'], { unique: true })
export class PortfolioRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('int')
  item_number!: number;

  // === Overview Section ===
  @Column('text')
  name!: string;

  // Managed via integrated docs after cutover; retained as a transient property for API/CSV inputs.
  purpose?: string | null;

  @Column('uuid', { nullable: true })
  requestor_id!: string | null;

  @Column('uuid', { nullable: true })
  source_id!: string | null;

  @Column('uuid', { nullable: true })
  category_id!: string | null;

  @Column('uuid', { nullable: true })
  stream_id!: string | null;

  @Column('uuid', { nullable: true })
  company_id!: string | null;

  @Column('uuid', { nullable: true })
  department_id!: string | null;

  @Column('uuid', { nullable: true })
  origin_task_id!: string | null;

  @Column('date', { nullable: true })
  target_delivery_date!: Date | null;

  @Column('text', { default: 'pending_review' })
  status!: RequestStatus;

  // === Scoring Section ===
  @Column('numeric', { precision: 5, scale: 2, nullable: true })
  priority_score!: number | null;

  @Column('boolean', { default: false })
  priority_override!: boolean;

  @Column('text', { nullable: true })
  override_justification!: string | null;

  @Column('numeric', { precision: 5, scale: 2, nullable: true })
  override_value!: number | null;

  @Column('jsonb', { default: '{}' })
  criteria_values!: Record<string, string>;

  // Note: Effort estimation is now derived from Time estimation criteria values
  // See portfolio-criteria.service.ts calculateEffortFromCriteria()

  // === Analysis Section ===
  @Column('text', { nullable: true })
  current_situation!: string | null;

  @Column('text', { nullable: true })
  expected_benefits!: string | null;

  // Managed via integrated docs after cutover; retained as a transient property for API/CSV inputs.
  risks?: string | null;

  @Column('jsonb', { default: () => "'{}'::jsonb" })
  feasibility_review!: FeasibilityReview;

  // === Team Section ===
  @Column('uuid', { nullable: true })
  business_sponsor_id!: string | null;

  @Column('uuid', { nullable: true })
  business_lead_id!: string | null;

  @Column('uuid', { nullable: true })
  it_sponsor_id!: string | null;

  @Column('uuid', { nullable: true })
  it_lead_id!: string | null;

  // === Metadata ===
  @Column('uuid', { nullable: true })
  created_by_id!: string | null;

  @Column('timestamptz', { nullable: true })
  converted_date!: Date | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  /** Kept by the database (migration 1856270000000): never written by TypeORM, see touchUpdatedAt. */
  @Column({ type: 'timestamptz', default: () => 'now()', update: false })
  updated_at!: Date;
}
