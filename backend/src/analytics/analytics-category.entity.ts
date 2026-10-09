import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';
import { AxisAppliesTo } from './analytics-axis.entity';

@Entity('analytics_categories')
export class AnalyticsCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { default: () => 'app_current_tenant()' })
  tenant_id!: string;

  /** The dimension this value belongs to; set on create, never changed. */
  @Column('uuid')
  axis_id!: string;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  /**
   * The budget lines that may choose the value: OPEX only, CAPEX only, or both (null). Never the
   * type its dimension excludes. A line already holding it keeps it.
   */
  @Column('text', { nullable: true })
  applies_to!: AxisAppliesTo | null;

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState;

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}
