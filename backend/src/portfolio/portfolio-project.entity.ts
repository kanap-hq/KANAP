import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ProjectStatus =
  | 'waiting_list'
  | 'planned'
  | 'in_progress'
  | 'in_testing'
  | 'on_hold'
  | 'done'
  | 'cancelled';

export type ProjectOrigin = 'standard' | 'fast_track' | 'legacy';

export type EffortAllocationMode = 'auto' | 'manual';
export type ProjectSchedulingMode = 'independent' | 'collaborative';

@Entity('portfolio_projects')
@Index(['tenant_id', 'name'])
@Index(['tenant_id', 'status'])
@Index(['tenant_id', 'company_id'])
@Index(['tenant_id', 'item_number'], { unique: true })
export class PortfolioProject {
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
  source_id!: string | null;

  @Column('uuid', { nullable: true })
  category_id!: string | null;

  @Column('uuid', { nullable: true })
  stream_id!: string | null;

  @Column('uuid', { nullable: true })
  company_id!: string | null;

  @Column('uuid', { nullable: true })
  department_id!: string | null;

  @Column('text', { default: 'standard' })
  origin!: ProjectOrigin;

  @Column('text', { default: 'waiting_list' })
  status!: ProjectStatus;

  @Column('text', { default: 'independent' })
  scheduling_mode!: ProjectSchedulingMode;

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

  @Column('numeric', { precision: 5, scale: 2, default: 0 })
  execution_progress!: number;

  // === Timeline Section ===
  @Column('date', { nullable: true })
  planned_start!: Date | null;

  @Column('date', { nullable: true })
  planned_end!: Date | null;

  @Column('date', { nullable: true })
  actual_start!: Date | null;

  @Column('date', { nullable: true })
  actual_end!: Date | null;

  // === Baseline Section ===
  @Column('date', { nullable: true })
  baseline_start_date!: Date | null;

  @Column('date', { nullable: true })
  baseline_end_date!: Date | null;

  @Column('numeric', { precision: 10, scale: 2, nullable: true })
  baseline_effort_it!: number | null;

  @Column('numeric', { precision: 10, scale: 2, nullable: true })
  baseline_effort_business!: number | null;

  // === Effort Section ===
  @Column('numeric', { precision: 10, scale: 2, nullable: true })
  estimated_effort_it!: number | null;

  @Column('numeric', { precision: 10, scale: 2, nullable: true })
  estimated_effort_business!: number | null;

  @Column('numeric', { precision: 10, scale: 2, nullable: true })
  actual_effort_it!: number | null;

  @Column('numeric', { precision: 10, scale: 2, nullable: true })
  actual_effort_business!: number | null;

  // === Effort Allocation Mode ===
  @Column('text', { default: 'auto' })
  it_effort_allocation_mode!: 'auto' | 'manual';

  @Column('text', { default: 'auto' })
  business_effort_allocation_mode!: 'auto' | 'manual';

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
  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  /** Kept by the database (migration 1856270000000): never written by TypeORM, see touchUpdatedAt. */
  @Column({ type: 'timestamptz', default: () => 'now()', update: false })
  updated_at!: Date;
}
