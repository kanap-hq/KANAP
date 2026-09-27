import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

@Entity('spend_items')
@Index(['tenant_id', 'item_number'], { unique: true })
export class SpendItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  // Per-tenant sequential business reference (rendered as OPX-N). Assigned on create.
  @Column('int')
  item_number!: number;

  @Column('uuid', { nullable: true })
  paying_company_id!: string | null;

  @Column('text')
  product_name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('uuid', { nullable: true })
  supplier_id!: string | null;

  @Column('uuid', { nullable: true })
  account_id!: string | null;

  @Column('char', { length: 3 })
  currency!: string;

  @Column('date')
  effective_start!: string; // YYYY-MM-DD

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState;

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('uuid', { nullable: true })
  owner_it_id!: string | null;

  @Column('uuid', { nullable: true })
  owner_business_id!: string | null;

  @Column('uuid', { nullable: true })
  analytics_category_id!: string | null;

  @Column('uuid', { nullable: true })
  project_id!: string | null;

  @Column('uuid', { nullable: true })
  contract_id!: string | null;

  // A cost center of this tenant (never a group); the database enforces the tenant match.
  @Column('uuid', { nullable: true })
  cost_center_id!: string | null;

  @Column({ type: 'enum', enum: ['run', 'build'], enumName: 'run_build', nullable: true })
  run_build!: 'run' | 'build' | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
