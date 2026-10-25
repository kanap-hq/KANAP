import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  name!: string;

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState; // enabled|disabled

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('uuid')
  company_id!: string;

  @Column('uuid')
  supplier_id!: string;

  /** The node of the tree that manages the contract (a group or a cost center), or none. */
  @Column('uuid', { nullable: true })
  cost_center_id!: string | null;

  @Column('uuid', { nullable: true })
  owner_user_id!: string | null;

  @Column('date')
  start_date!: string; // YYYY-MM-DD

  @Column('int', { default: 12 })
  duration_months!: number;

  @Column('boolean', { default: true })
  auto_renewal!: boolean;

  @Column('int', { default: 1 })
  notice_period_months!: number;

  @Column('numeric', { precision: 18, scale: 2, default: 0 })
  yearly_amount_at_signature!: string | number;

  @Column('char', { length: 3, default: 'EUR' })
  currency!: string;

  @Column('text', { default: 'annual' })
  billing_frequency!: string; // monthly|quarterly|annual|other

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
